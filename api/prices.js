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
    const cacheRes = await db.execute("SELECT payload FROM market_cache WHERE key = 'prices' LIMIT 1;");
    if (cacheRes.rows.length > 0 && cacheRes.rows[0].payload) {
      const data = JSON.parse(cacheRes.rows[0].payload);
      if (Array.isArray(data) && data.length > 0) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");
        return res.status(200).json(data);
      }
    }

    // 3. Fallback: Auto-populate if cache is empty
    const fallbackRes = await db.execute(`
      SELECT item_name AS name, price
      FROM resource_prices
      WHERE recorded_at >= datetime('now', '-6 hours')
      GROUP BY item_name
      HAVING recorded_at = MAX(recorded_at)
      ORDER BY item_name ASC;
    `);

    let prices = fallbackRes.rows.map(r => ({
      name: r.name,
      price: parseFloat(r.price)
    }));

    if (prices.length === 0) {
      const allRes = await db.execute(`
        SELECT item_name AS name, price
        FROM resource_prices
        GROUP BY item_name
        HAVING recorded_at = MAX(recorded_at)
        ORDER BY item_name ASC;
      `);
      prices = allRes.rows.map(r => ({
        name: r.name,
        price: parseFloat(r.price)
      }));
    }

    // 4. Save to cache for future requests
    if (prices.length > 0) {
      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('prices', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(prices)]
      });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");
    return res.status(200).json(prices);
  } catch (error) {
    console.error("Prices API Error:", error);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}
