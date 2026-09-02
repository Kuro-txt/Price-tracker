import { getDb, ensureTablesExist } from "./lib/db.js";
import { fetchLiveMarketPrices } from "./lib/collectibles.js";

export default async function handler(req, res) {
  try {
    const db = getDb();
    await ensureTablesExist(db);

    // 1. Fetch live prices from official Sunflower Land Marketplace API
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

    // 3. Update market_cache with latest prices (write only - 0 reads)
    await db.execute({
      sql: `INSERT INTO market_cache (key, payload, updated_at)
            VALUES ('prices', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
              SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(latestPrices)],
    });

    // 4. Strictly 12H Movers: Query baseline recorded between 12 and 16 hours ago
    // Narrow time window minimizes database read scans
    let pastQuery = await db.execute(`
      SELECT item_name, price
      FROM (
        SELECT item_name, price,
               ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at DESC) as rn
        FROM resource_prices
        WHERE recorded_at <= datetime('now', '-12 hours')
          AND recorded_at >= datetime('now', '-16 hours')
      )
      WHERE rn = 1;
    `);

    // Fallback if there was a recording gap at exactly 12-16h ago
    if (!pastQuery.rows || pastQuery.rows.length === 0) {
      pastQuery = await db.execute(`
        SELECT item_name, price
        FROM (
          SELECT item_name, price,
                 ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at DESC) as rn
          FROM resource_prices
          WHERE recorded_at <= datetime('now', '-12 hours')
        )
        WHERE rn = 1;
      `);
    }

    const pastMap = {};
    if (pastQuery.rows && pastQuery.rows.length > 0) {
      pastQuery.rows.forEach(r => {
        pastMap[r.item_name.toLowerCase()] = parseFloat(r.price);
      });
    }

    const gainers = [];
    const losers  = [];
    const changesMap = {};

    latestPrices.forEach(item => {
      const lower = item.name.toLowerCase();
      const pastPrice = (pastMap[lower] !== undefined && pastMap[lower] !== null) ? pastMap[lower] : item.price;
      const changeAmt = item.price - pastPrice;
      const changePct = pastPrice > 0 ? parseFloat(((changeAmt / pastPrice) * 100).toFixed(2)) : 0;

      const moverItem = {
        name: item.name,
        price: item.price,
        pastPrice: pastPrice,
        changePct: changePct,
        changeAmt: parseFloat(changeAmt.toFixed(8))
      };

      changesMap[lower] = moverItem;

      // Strictly 12H movers: only positive gains in gainers, negative in losers
      if (changePct > 0.001) {
        gainers.push(moverItem);
      } else if (changePct < -0.001) {
        losers.push(moverItem);
      }
    });

    gainers.sort((a, b) => b.changePct - a.changePct);
    losers.sort((a, b) => a.changePct - b.changePct);

    const moversPayload = { gainers, losers, changesMap };

    // 5. Cache computed 12H movers (write only - 0 reads)
    await db.execute({
      sql: `INSERT INTO market_cache (key, payload, updated_at)
            VALUES ('movers', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
              SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(moversPayload)],
    });

    return res.status(200).json({
      success: true,
      window: "12h",
      inserted: batchStatements.length,
      gainers: gainers.length,
      losers: losers.length
    });

  } catch (error) {
    console.error("[cron] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}
