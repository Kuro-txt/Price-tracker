import { getDb, ensureTablesExist } from "./lib/db.js";
import { fetchLiveMarketPrices } from "./lib/collectibles.js";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const FORTY_FIVE_MIN_MS = 45 * 60 * 1000;
const EIGHTEEN_HOURS_MS = 18 * 60 * 60 * 1000;

export default async function handler(req, res) {
  try {
    const db = getDb();
    await ensureTablesExist(db);

    // 1. Fetch live prices from official Sunflower Land Marketplace API (0 DB reads)
    const latestPrices = await fetchLiveMarketPrices();

    if (latestPrices.length === 0) {
      return res.status(200).json({ message: "No prices returned from source." });
    }

    // 2. Batch insert new prices for time-series charts (write only - 0 reads)
    const batchStatements = latestPrices.map(item => ({
      sql: `INSERT INTO resource_prices (item_name, price, recorded_at)
            VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));`,
      args: [item.name, parseFloat(item.price)],
    }));

    if (batchStatements.length > 0) {
      await db.batch(batchStatements);
    }

    // Current price lookup dictionary
    const currentPriceMap = {};
    latestPrices.forEach(item => {
      currentPriceMap[item.name.toLowerCase()] = parseFloat(item.price);
    });

    // 3. Ultra-Lean 12H Movers Engine (EXACTLY 1 DB READ via market_cache)
    // Avoids scanning 35,000+ rows with window functions in resource_prices.
    let hourlySnapshots = [];
    let pastMap = {};

    try {
      const snapRes = await db.execute(
        "SELECT payload FROM market_cache WHERE key = 'hourly_snapshots';"
      );
      if (snapRes.rows.length > 0 && snapRes.rows[0].payload) {
        hourlySnapshots = JSON.parse(snapRes.rows[0].payload);
      }
    } catch (_) {}

    const now = Date.now();

    if (Array.isArray(hourlySnapshots) && hourlySnapshots.length > 0) {
      // Find the snapshot closest to 12 hours ago
      const targetTime = now - TWELVE_HOURS_MS;
      let closestSnap = null;
      let minDiff = Infinity;

      for (const snap of hourlySnapshots) {
        const diff = Math.abs(snap.timestamp - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestSnap = snap;
        }
      }

      if (closestSnap && closestSnap.prices) {
        pastMap = closestSnap.prices;
      }
    }

    // Append new hourly snapshot if >= 45 minutes have elapsed since the last one
    const lastSnapTime = hourlySnapshots.length > 0
      ? hourlySnapshots[hourlySnapshots.length - 1].timestamp
      : 0;

    if (now - lastSnapTime >= FORTY_FIVE_MIN_MS) {
      hourlySnapshots.push({
        timestamp: now,
        prices: currentPriceMap
      });

      // Keep only snapshots within the last 18 hours
      hourlySnapshots = hourlySnapshots.filter(s => (now - s.timestamp) <= EIGHTEEN_HOURS_MS);

      // Save snapshots back to market_cache (write only - 0 reads)
      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at)
              VALUES ('hourly_snapshots', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE
                SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(hourlySnapshots)],
      });
    }

    // Compute gainers, losers, and changesMap against the 12H baseline
    const gainers = [];
    const losers  = [];
    const changesMap = {};

    latestPrices.forEach(item => {
      const lower = item.name.toLowerCase();
      const pastPrice = (pastMap[lower] !== undefined && pastMap[lower] !== null)
        ? pastMap[lower]
        : item.price;
      const changeAmt = item.price - pastPrice;
      const changePct = pastPrice > 0
        ? parseFloat(((changeAmt / pastPrice) * 100).toFixed(2))
        : 0;

      const moverItem = {
        name: item.name,
        price: item.price,
        pastPrice: pastPrice,
        changePct: changePct,
        changeAmt: parseFloat(changeAmt.toFixed(8))
      };

      changesMap[lower] = moverItem;

      if (changePct > 0.001) {
        gainers.push(moverItem);
      } else if (changePct < -0.001) {
        losers.push(moverItem);
      }
    });

    gainers.sort((a, b) => b.changePct - a.changePct);
    losers.sort((a, b) => a.changePct - b.changePct);

    const moversPayload = { gainers, losers, changesMap };

    // 4. Update market_cache with 'prices' and 'movers' (write only - 0 reads)
    await db.batch([
      {
        sql: `INSERT INTO market_cache (key, payload, updated_at)
              VALUES ('prices', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE
                SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(latestPrices)],
      },
      {
        sql: `INSERT INTO market_cache (key, payload, updated_at)
              VALUES ('movers', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE
                SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(moversPayload)],
      }
    ]);

    return res.status(200).json({
      success: true,
      window: "12h",
      inserted: batchStatements.length,
      gainers: gainers.length,
      losers: losers.length,
      reads_used: 1
    });

  } catch (error) {
    console.error("[cron] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}
