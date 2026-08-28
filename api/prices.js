import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");

  try {
    const db = getDb();

    // 1. Ensure cache table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS market_cache (
        key        TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Serve from 1-row cache (1 read)
    const cacheRes = await db.execute(
      "SELECT payload FROM market_cache WHERE key = 'prices' LIMIT 1;"
    );
    if (cacheRes.rows.length > 0 && cacheRes.rows[0].payload) {
      const data = JSON.parse(cacheRes.rows[0].payload);
      if (Array.isArray(data) && data.length > 0) {
        return res.status(200).json(data);
      }
    }

    // 3. Fallback: fetch latest price per item via correct subquery join
    let prices = await fetchLatestPrices(db, "-6 hours");

    if (prices.length === 0) {
      prices = await fetchLatestPrices(db, null);
    }

    // 4. Save to cache for future requests
    if (prices.length > 0) {
      await db.execute({
        sql: `
          INSERT INTO market_cache (key, payload, updated_at)
          VALUES ('prices', ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE
            SET payload    = excluded.payload,
                updated_at = excluded.updated_at;
        `,
        args: [JSON.stringify(prices)],
      });
    }

    return res.status(200).json(prices);
  } catch (error) {
    console.error("Prices API Error:", error);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}

async function fetchLatestPrices(db, timeModifier) {
  const whereClause = timeModifier
    ? `WHERE recorded_at >= datetime('now', '${timeModifier}')`
    : "";

  const res = await db.execute(`
    SELECT rp.item_name AS name, rp.price
    FROM resource_prices rp
    JOIN (
      SELECT item_name, MAX(recorded_at) AS max_at
      FROM resource_prices
      ${whereClause}
      GROUP BY item_name
    ) latest
      ON  rp.item_name  = latest.item_name
      AND rp.recorded_at = latest.max_at
    ORDER BY rp.item_name ASC;
  `);

  return res.rows.map(r => ({
    name:  r.name,
    price: parseFloat(r.price),
  }));
}
