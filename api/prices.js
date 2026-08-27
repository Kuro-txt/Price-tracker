import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let cachedPrices = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (cachedPrices && now - lastFetchTime < CACHE_TTL_MS) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");
      return res.status(200).json(cachedPrices);
    }

    const query = `
      SELECT item_name AS name, price, recorded_at
      FROM resource_prices
      WHERE rowid IN (
        SELECT MAX(rowid)
        FROM resource_prices
        GROUP BY LOWER(item_name)
      )
      ORDER BY item_name ASC;
    `;

    const result = await db.execute(query);
    cachedPrices = result.rows.map(row => ({
      name: row.name,
      price: parseFloat(row.price)
    }));
    lastFetchTime = now;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");
    return res.status(200).json(cachedPrices);
  } catch (error) {
    console.error("Prices API Error:", error);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}
