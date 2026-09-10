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

  // Maximum rows to read from index:
  // Since items only have ~1,300 rows total, limiting to 1,500 guarantees we read
  // only the exact rows for that item, with ZERO table scans and ZERO temp b-trees.
  const rangeLimits = {
    "6h": 100,
    "12h": 150,
    "24h": 250,
    "7d": 800,
    "30d": 1500,
    "90d": 1500,
    "all": 2000,
  };
  const safeLimit = Number(rangeLimits[range]) || 250;

  // Edge CDN caching: 30d/90d/all cached for 15 minutes to eliminate redundant DB reads
  const cdnCacheSeconds = {
    "6h": 120,   // 2 minutes
    "12h": 180,  // 3 minutes
    "24h": 180,  // 3 minutes
    "7d": 600,   // 10 minutes
    "30d": 900,  // 15 minutes
    "90d": 1800, // 30 minutes
    "all": 3600, // 1 hour
  };
  const sMaxAge = cdnCacheSeconds[range] ?? 180;
  res.setHeader("Cache-Control", `s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}`);

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(200).json([]);
    }

    const db = getDb();

    // Pure index seek: SEARCH resource_prices USING INDEX idx_item_time_nocase (item_name=? AND recorded_at>?)
    // Direct B-Tree scan in ascending order with ZERO temporary b-trees and ZERO grouping overhead.
    const result = await db.execute({
      sql: `
        SELECT price,
               CASE 
                 WHEN recorded_at LIKE '%T%Z' THEN recorded_at
                 ELSE strftime('%Y-%m-%dT%H:%M:%SZ', recorded_at)
               END AS recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE
          AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC
        LIMIT ${safeLimit};
      `,
      args: [item, timeModifier],
    });

    let rows = result.rows || [];

    // In-memory downsampling in Node.js RAM (0 database reads, 0ms overhead):
    // If a long range has more than 400 points, sample down evenly to ~400 points
    // so the entire timespan is fully visualized while minimizing payload size.
    if (rows.length > 400) {
      const step = Math.ceil(rows.length / 400);
      const sampled = [];
      for (let i = 0; i < rows.length; i += step) {
        sampled.push(rows[i]);
      }
      // Always include the latest point
      if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
        sampled.push(rows[rows.length - 1]);
      }
      rows = sampled;
    }

    return res.status(200).json(rows);
  } catch (error) {
    console.error("[history] Error:", error.message);
    return res.status(200).json([]);
  }
}
