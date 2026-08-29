import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Edge CDN caching: Vercel serves repeated history requests without querying Turso DB
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(500).json({ error: "TURSO_DATABASE_URL missing." });
    }

    const item  = req.query.item  || "Sunflower";
    const range = req.query.range || "24h";

    const timeModifiers = {
      "6h": "-6 hours", "12h": "-12 hours", "24h": "-24 hours",
      "7d": "-7 days",  "30d": "-30 days",  "90d": "-90 days",
      "all": "-365 days",
    };
    const timeModifier = timeModifiers[range] ?? "-24 hours";

    const db = getDb();

    // Uses idx_item_time_nocase index for instant O(log N) lookup without scanning other items
    const result = await db.execute({
      sql: `
        SELECT price, recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE
          AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC;
      `,
      args: [item, timeModifier],
    });

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("[history] Error:", error.message);
    return res.status(500).json({ error: error.message, rows: [] });
  }
}
