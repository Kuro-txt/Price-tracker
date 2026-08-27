import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    // 1. Ensure cache table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS market_cache (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Read from 1-row cache (1 read)
    const cacheRes = await db.execute("SELECT payload FROM market_cache WHERE key = 'movers' LIMIT 1;");
    if (cacheRes.rows.length > 0 && cacheRes.rows[0].payload) {
      const data = JSON.parse(cacheRes.rows[0].payload);
      if (data && (data.gainers?.length > 0 || data.losers?.length > 0 || Object.keys(data.changesMap || {}).length > 0)) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");
        return res.status(200).json(data);
      }
    }

    // 3. Fallback: Auto-populate if cache is empty
    const moversRes = await db.execute(`
      WITH Latest AS (
        SELECT item_name, price AS current_price
        FROM resource_prices
        WHERE recorded_at >= datetime('now', '-6 hours')
        GROUP BY item_name
        HAVING recorded_at = MAX(recorded_at)
      ),
      Past AS (
        SELECT item_name, price AS past_price
        FROM resource_prices
        WHERE recorded_at >= datetime('now', '-14 hours')
        GROUP BY item_name
        HAVING recorded_at = MIN(recorded_at)
      )
      SELECT 
        l.item_name,
        l.current_price,
        p.past_price,
        ROUND(((l.current_price - p.past_price) / p.past_price) * 100, 2) AS change_pct,
        ROUND(l.current_price - p.past_price, 6) AS change_amt
      FROM Latest l
      JOIN Past p ON LOWER(l.item_name) = LOWER(p.item_name)
      WHERE p.past_price > 0
      ORDER BY change_pct DESC;
    `);

    const gainers = [];
    const losers = [];
    const changesMap = {};

    moversRes.rows.forEach(row => {
      const item = {
        name: row.item_name,
        price: parseFloat(row.current_price),
        pastPrice: parseFloat(row.past_price),
        changePct: parseFloat(row.change_pct),
        changeAmt: parseFloat(row.change_amt)
      };
      changesMap[row.item_name.toLowerCase()] = item;
      if (item.changePct > 0) gainers.push(item);
      else if (item.changePct < 0) losers.push(item);
    });
    losers.sort((a, b) => a.changePct - b.changePct);

    const payload = { gainers, losers, changesMap };

    // 4. Save to cache for future requests
    if (Object.keys(changesMap).length > 0) {
      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('movers', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(payload)]
      });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Movers API Error:", error);
    return res.status(500).json({ error: error.message, gainers: [], losers: [], changesMap: {} });
  }
}
