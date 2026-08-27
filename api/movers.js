import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let cachedMovers = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (cachedMovers && now - lastFetchTime < CACHE_TTL_MS) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
      return res.status(200).json(cachedMovers);
    }

    const query = `
      WITH LatestPrices AS (
        SELECT 
          item_name, 
          price AS current_price,
          ROW_NUMBER() OVER (PARTITION BY LOWER(item_name) ORDER BY recorded_at DESC) as rn
        FROM resource_prices
      ),
      PastPrices AS (
        SELECT 
          item_name, 
          price AS past_price,
          ROW_NUMBER() OVER (PARTITION BY LOWER(item_name) ORDER BY recorded_at ASC) as rn
        FROM resource_prices
        WHERE recorded_at >= datetime('now', '-12 hours')
      )
      SELECT 
        l.item_name,
        l.current_price,
        p.past_price,
        ROUND(((l.current_price - p.past_price) / p.past_price) * 100, 2) AS change_pct,
        ROUND(l.current_price - p.past_price, 6) AS change_amt
      FROM LatestPrices l
      JOIN PastPrices p ON LOWER(l.item_name) = LOWER(p.item_name) AND p.rn = 1
      WHERE l.rn = 1 AND p.past_price > 0
      ORDER BY change_pct DESC;
    `;

    const result = await db.execute(query);

    const gainers = [];
    const losers = [];
    const changesMap = {};

    result.rows.forEach(row => {
      const item = {
        name: row.item_name,
        price: parseFloat(row.current_price),
        pastPrice: parseFloat(row.past_price),
        changePct: parseFloat(row.change_pct),
        changeAmt: parseFloat(row.change_amt)
      };

      changesMap[row.item_name.toLowerCase()] = item;

      if (item.changePct >= 5) {
        gainers.push(item);
      } else if (item.changePct <= -5) {
        losers.push(item);
      }
    });

    cachedMovers = { gainers, losers, changesMap };
    lastFetchTime = now;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    return res.status(200).json(cachedMovers);
  } catch (error) {
    console.error("Movers API Error:", error);
    return res.status(500).json({ error: error.message, gainers: [], losers: [], changesMap: {} });
  }
}
