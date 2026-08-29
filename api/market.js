import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Edge CDN caching: Vercel serves market data from edge cache for 30-60s
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(500).json({
        error: "TURSO_DATABASE_URL is not set."
      });
    }

    const db = getDb();

    // ─── ONE QUERY for both cache keys (Reads exactly 2 rows from Turso) ──
    const cacheRes = await db.execute(
      "SELECT key, payload FROM market_cache WHERE key IN ('prices', 'movers');"
    );

    let prices = [];
    let movers = { gainers: [], losers: [], changesMap: {} };

    cacheRes.rows.forEach(row => {
      try {
        if (row.key === "prices") prices = JSON.parse(row.payload);
        if (row.key === "movers") movers = JSON.parse(row.payload);
      } catch (_) {}
    });

    return res.status(200).json({ prices, movers });
  } catch (error) {
    console.error("[market] Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
