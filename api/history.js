import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Global Edge CDN cache: Vercel serves repeated history requests for 2 minutes with 0 Turso DB reads
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");

  const item  = req.query.item  || "Sunflower";
  const range = req.query.range || "24h";

  const timeModifiers = {
    "6h": "-6 hours", "12h": "-12 hours", "24h": "-24 hours",
    "7d": "-7 days",  "30d": "-30 days",  "90d": "-90 days",
    "all": "-365 days",
  };
  const timeModifier = timeModifiers[range] ?? "-24 hours";

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(200).json([]);
    }

    const db = getDb();

    // Selects the most recent 300 data points in the requested range, ordered chronologically
    const result = await db.execute({
      sql: `
        SELECT price, recorded_at
        FROM (
          SELECT price, recorded_at
          FROM resource_prices
          WHERE item_name = ? COLLATE NOCASE
            AND recorded_at >= datetime('now', ?)
          ORDER BY recorded_at DESC
          LIMIT 300
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
