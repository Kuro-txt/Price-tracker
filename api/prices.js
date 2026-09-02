import { getDb } from "./lib/db.js";
import { fetchLiveMarketPrices } from "./lib/collectibles.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  let prices = [];

  try {
    if (process.env.TURSO_DATABASE_URL) {
      const db = getDb();
      const cacheRes = await db.execute("SELECT payload FROM market_cache WHERE key = 'prices';");
      if (cacheRes.rows.length > 0) {
        try { prices = JSON.parse(cacheRes.rows[0].payload); } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("[prices] DB read warning:", err.message);
  }

  if (!prices || prices.length === 0) {
    try {
      prices = await fetchLiveMarketPrices();
    } catch (_) {}
  }

  return res.status(200).json(prices || []);
}
