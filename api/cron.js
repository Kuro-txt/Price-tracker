import { getDb, ensureTablesExist } from "./lib/db.js";
import { fetchLiveMarketPrices } from "./lib/collectibles.js";

const TWELVE_HOURS_MS      = 12 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const FORTY_FIVE_MIN_MS    = 45 * 60 * 1000;
const THIRTY_HOURS_MS      = 30 * 60 * 60 * 1000;

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

    // 2b. Upsert into hourly + daily rollup tables (write only - 0 reads)
    // price_hourly: one row per (item, UTC hour) — updated on each cron run within the same hour
    // price_daily:  one row per (item, UTC date) — updated on each cron run within the same day
    const hourlySql = `
      INSERT INTO price_hourly (item_name, avg_price, hour_at)
      VALUES (?, ?, strftime('%Y-%m-%dT%H:00:00Z', 'now'))
      ON CONFLICT(item_name, hour_at) DO UPDATE SET avg_price = excluded.avg_price;`;
    const dailySql = `
      INSERT INTO price_daily (item_name, avg_price, day_at)
      VALUES (?, ?, strftime('%Y-%m-%d', 'now'))
      ON CONFLICT(item_name, day_at) DO UPDATE SET avg_price = excluded.avg_price;`;

    const rollupStatements = latestPrices.flatMap(item => [
      { sql: hourlySql, args: [item.name, parseFloat(item.price)] },
      { sql: dailySql,  args: [item.name, parseFloat(item.price)] },
    ]);

    if (rollupStatements.length > 0) {
      await db.batch(rollupStatements);
    }

    // Current price lookup dictionary
    const currentPriceMap = {};
    latestPrices.forEach(item => {
      currentPriceMap[item.name.toLowerCase()] = parseFloat(item.price);
    });

    // 3. Ultra-Lean 12H & 24H Movers Engine (reads from cached snapshots buffer)
    let hourlySnapshots = [];
    let pastMap12 = {};
    let pastMap24 = {};
    let readsUsed = 1;
    let snapshotsChanged = false;

    try {
      const snapRes = await db.execute(
        "SELECT payload FROM market_cache WHERE key = 'hourly_snapshots';"
      );
      if (snapRes.rows.length > 0 && snapRes.rows[0].payload) {
        hourlySnapshots = JSON.parse(snapRes.rows[0].payload);
      }
    } catch (_) {}

    const now = Date.now();

    // Look for snapshots around 12h and 24h old in the ring buffer
    if (Array.isArray(hourlySnapshots) && hourlySnapshots.length > 0) {
      const targetTime12 = now - TWELVE_HOURS_MS;
      let closestSnap12 = null;
      let minDiff12 = Infinity;

      const targetTime24 = now - TWENTY_FOUR_HOURS_MS;
      let closestSnap24 = null;
      let minDiff24 = Infinity;

      for (const snap of hourlySnapshots) {
        const age = now - snap.timestamp;
        // Accept 12h snapshots between 6h and 18h old
        if (age >= 6 * 3600 * 1000 && age <= 18 * 3600 * 1000) {
          const diff = Math.abs(snap.timestamp - targetTime12);
          if (diff < minDiff12) {
            minDiff12 = diff;
            closestSnap12 = snap;
          }
        }
        // Accept 24h snapshots between 18h and 30h old
        if (age >= 18 * 3600 * 1000 && age <= 30 * 3600 * 1000) {
          const diff = Math.abs(snap.timestamp - targetTime24);
          if (diff < minDiff24) {
            minDiff24 = diff;
            closestSnap24 = snap;
          }
        }
      }

      if (closestSnap12 && closestSnap12.prices) {
        pastMap12 = closestSnap12.prices;
      }
      if (closestSnap24 && closestSnap24.prices) {
        pastMap24 = closestSnap24.prices;
      }
    }

    // Fallback: If 12H baseline is missing, seed once from DB
    if (Object.keys(pastMap12).length === 0) {
      try {
        const seedRes12 = await db.execute(`
          SELECT item_name, avg_price
          FROM price_hourly
          WHERE hour_at >= datetime('now', '-14 hours')
            AND hour_at <= datetime('now', '-10 hours')
          GROUP BY item_name;
        `);
        readsUsed += (seedRes12.rows ? seedRes12.rows.length : 0);

        if (seedRes12.rows && seedRes12.rows.length > 0) {
          seedRes12.rows.forEach(r => {
            pastMap12[r.item_name.toLowerCase()] = parseFloat(r.avg_price);
          });
          hourlySnapshots.unshift({
            timestamp: now - TWELVE_HOURS_MS,
            prices: pastMap12
          });
          snapshotsChanged = true;
        }
      } catch (seedErr) {
        console.warn("[cron] Seed 12h baseline error:", seedErr.message);
      }
    }

    // Fallback: If 24H baseline is missing, seed once from price_hourly
    if (Object.keys(pastMap24).length === 0) {
      try {
        const seedRes24 = await db.execute(`
          SELECT item_name, avg_price
          FROM price_hourly
          WHERE hour_at >= datetime('now', '-26 hours')
            AND hour_at <= datetime('now', '-22 hours')
          GROUP BY item_name;
        `);
        readsUsed += (seedRes24.rows ? seedRes24.rows.length : 0);

        if (seedRes24.rows && seedRes24.rows.length > 0) {
          seedRes24.rows.forEach(r => {
            pastMap24[r.item_name.toLowerCase()] = parseFloat(r.avg_price);
          });
          hourlySnapshots.unshift({
            timestamp: now - TWENTY_FOUR_HOURS_MS,
            prices: pastMap24
          });
          snapshotsChanged = true;
        }
      } catch (seedErr24) {
        console.warn("[cron] Seed 24h baseline error:", seedErr24.message);
      }
    }

    // Fallback for any newly added item
    latestPrices.forEach(item => {
      const k = item.name.toLowerCase();
      if (pastMap12[k] === undefined) pastMap12[k] = parseFloat(item.price);
      if (pastMap24[k] === undefined) pastMap24[k] = pastMap12[k] || parseFloat(item.price);
    });

    // Append new hourly snapshot if >= 45 minutes have elapsed since the last one
    const lastSnapTime = hourlySnapshots.length > 0
      ? hourlySnapshots[hourlySnapshots.length - 1].timestamp
      : 0;

    if (now - lastSnapTime >= FORTY_FIVE_MIN_MS) {
      hourlySnapshots.push({
        timestamp: now,
        prices: currentPriceMap
      });
      snapshotsChanged = true;
    }

    if (snapshotsChanged) {
      // Keep only snapshots within the last 30 hours
      hourlySnapshots = hourlySnapshots.filter(s => (now - s.timestamp) <= THIRTY_HOURS_MS);

      // Save snapshots back to market_cache (write only - 0 reads)
      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at)
              VALUES ('hourly_snapshots', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE
                SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(hourlySnapshots)],
      });
    }

    // Helper to calculate gainers, losers, and changesMap against a baseline
    function calculateMovers(pastMap) {
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

      return { gainers, losers, changesMap };
    }

    const movers12h = calculateMovers(pastMap12);
    const movers24h = calculateMovers(pastMap24);

    const moversPayload = {
      // Legacy top-level keys for backward compatibility:
      gainers:    movers12h.gainers,
      losers:     movers12h.losers,
      changesMap: movers12h.changesMap,
      // Dedicated window properties:
      "12h":      movers12h,
      "24h":      movers24h,
    };

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
      window: "12h & 24h",
      inserted: batchStatements.length,
      gainers12h: movers12h.gainers.length,
      losers12h:  movers12h.losers.length,
      gainers24h: movers24h.gainers.length,
      losers24h:  movers24h.losers.length,
      reads_used: readsUsed
    });

  } catch (error) {
    console.error("[cron] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}

