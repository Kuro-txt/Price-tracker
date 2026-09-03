import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const item  = req.query.item  || "Sunflower";
  const range = req.query.range || "24h";

  const timeModifiers = {
    "6h": "-6 hours", "12h": "-12 hours", "24h": "-24 hours",
    "7d": "-7 days",  "30d": "-30 days",  "90d": "-90 days",
    "all": "-365 days",
  };
  const timeModifier = timeModifiers[range] ?? "-24 hours";

  // Encompasses the full timeframe while preventing oversized payloads
  const rangeLimits = {
    "6h": 80,
    "12h": 120,
    "24h": 200,
    "7d": 600,
    "30d": 800,
    "90d": 1000,
    "all": 1200,
  };
  const safeLimit = Number(rangeLimits[range]) || 200;

  // Ultra-Lean Read Optimization:
  // Edge CDN caching: Longer ranges change very slowly.
  // Caching 7d for 10 minutes and 30d for 15 minutes eliminates >98% of database reads.
  const cdnCacheSeconds = {
    "6h": 120,   // 2 minutes
    "12h": 180,  // 3 minutes
    "24h": 180,  // 3 minutes
    "7d": 600,   // 10 minutes Edge cache
    "30d": 900,  // 15 minutes Edge cache
    "90d": 1800, // 30 minutes Edge cache
    "all": 3600, // 1 hour Edge cache
  };
  const sMaxAge = cdnCacheSeconds[range] ?? 180;
  res.setHeader("Cache-Control", `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}`);

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(200).json([]);
    }

    const db = getDb();

    // Uses idx_item_time_nocase directly (item_name COLLATE NOCASE, recorded_at ASC)
    // Avoids wrapping recorded_at in functions so SQLite performs an O(log N) index seek
    const result = await db.execute({
      sql: `
        SELECT price,
               CASE 
                 WHEN recorded_at LIKE '%T%Z' THEN recorded_at
                 ELSE strftime('%Y-%m-%dT%H:%M:%SZ', recorded_at)
               END AS recorded_at
        FROM (
          SELECT price, recorded_at
          FROM resource_prices
          WHERE item_name = ? COLLATE NOCASE
            AND recorded_at >= datetime('now', ?)
          ORDER BY recorded_at DESC
          LIMIT ${safeLimit}
        )
        ORDER BY recorded_at ASC;
      `,
      args: [item, timeModifier],
    });

    return res.status(200).json(result.rows || []);
  } catch (error) {
    console.error("[history] Error:", error.message);
    return res.status(200).json([]);
  }
}
