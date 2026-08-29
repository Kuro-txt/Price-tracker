import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(500).json({ error: "TURSO_DATABASE_URL missing." });
    }

    const db = getDb();
    const cacheRes = await db.execute("SELECT payload FROM market_cache WHERE key = 'prices';");

    let prices = [];
    if (cacheRes.rows.length > 0) {
      try { prices = JSON.parse(cacheRes.rows[0].payload); } catch (_) {}
    }

    return res.status(200).json(prices);
  } catch (error) {
    console.error("[prices] Error:", error.message);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}
