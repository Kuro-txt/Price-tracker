import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let cachedPrices = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 30 * 1000;

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (cachedPrices && now - lastFetchTime < CACHE_TTL_MS) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");
      return res.status(200).json(cachedPrices);
    }

    // Only scans the last 45 minutes (~50-100 rows instead of whole DB)
    const query = `
      SELECT item_name AS name, price
      FROM resource_prices
      WHERE recorded_at >= datetime('now', '-45 minutes')
      GROUP BY item_name
      HAVING recorded_at = MAX(recorded_at)
      ORDER BY item_name ASC;
    `;

    const result = await db.execute(query);
    
    // Fallback if cron was slightly delayed
    if (result.rows.length === 0) {
      const fallbackQuery = `
        SELECT item_name AS name, price
        FROM resource_prices
        GROUP BY item_name
        HAVING recorded_at = MAX(recorded_at)
        ORDER BY item_name ASC;
      `;
      const fallbackResult = await db.execute(fallbackQuery);
      cachedPrices = fallbackResult.rows.map(r => ({ name: r.name, price: parseFloat(r.price) }));
    } else {
      cachedPrices = result.rows.map(r => ({ name: r.name, price: parseFloat(r.price) }));
    }

    lastFetchTime = now;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");
    return res.status(200).json(cachedPrices);
  } catch (error) {
    console.error("Prices API Error:", error);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}
