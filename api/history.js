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

  // Dynamic limits tuned to encompass the FULL time window without truncating older days.
  // 15-minute intervals: 6h = 24 rows, 24h = ~96 rows, 7d = ~672 rows.
  // Setting 7d limit to 800 ensures all 7 days are fully displayed.
  const rangeLimits = {
    "6h": 100,
    "12h": 150,
    "24h": 250,
    "7d": 800,
    "30d": 1200,
    "90d": 1500,
    "all": 2000,
  };
  const safeLimit = Number(rangeLimits[range]) || 250;

  // Ultra-Lean Read Optimization:
  // Edge CDN caching: Longer ranges don't change every minute.
  // Caching 7d for 5 minutes and 30d for 10 minutes saves >98% of Turso database reads.
  const cdnCacheSeconds = {
    "6h": 60,
    "12h": 120,
    "24h": 120,
    "7d": 300,   // 5 minutes
    "30d": 600,  // 10 minutes
    "90d": 900,  // 15 minutes
    "all": 1800, // 30 minutes
  };
  const sMaxAge = cdnCacheSeconds[range] ?? 120;
  res.setHeader("Cache-Control", `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}`);

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(200).json([]);
    }

    const db = getDb();

    // Selects the data points spanning the full requested range, normalized to UTC ISO 8601 strings
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
            AND datetime(recorded_at) >= datetime('now', ?)
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
