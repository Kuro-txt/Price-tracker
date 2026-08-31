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

    // ─── Fast Cache Query ──────────────────────────────────────────────────
    let prices = [];
    let movers = { gainers: [], losers: [], changesMap: {} };

    try {
      const cacheRes = await db.execute(
        "SELECT key, payload FROM market_cache WHERE key IN ('prices', 'movers');"
      );

      cacheRes.rows.forEach(row => {
        try {
          if (row.key === "prices") prices = JSON.parse(row.payload);
          if (row.key === "movers") movers = JSON.parse(row.payload);
        } catch (_) {}
      });
    } catch (cacheErr) {
      console.warn("[market] Cache read warning:", cacheErr.message);
    }

    // Fallback: If cache is empty, fetch latest prices from resource_prices table
    if (prices.length === 0) {
      try {
        const fallbackRes = await db.execute(`
          SELECT item_name AS name, price
          FROM (
            SELECT item_name, price,
                   ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at DESC) as rn
            FROM resource_prices
          )
          WHERE rn = 1;
        `);
        prices = fallbackRes.rows.map(r => ({
          name: r.name,
          price: parseFloat(r.price)
        }));
      } catch (fallbackErr) {
        console.warn("[market] Fallback read warning:", fallbackErr.message);
      }
    }

    return res.status(200).json({ prices, movers });
  } catch (error) {
    console.error("[market] Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
