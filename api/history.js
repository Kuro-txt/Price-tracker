import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");

  try {
    const item  = req.query.item  || "Sunflower";
    const range = req.query.range || "24h";

    const timeModifiers = {
      "6h":  "-6 hours",
      "12h": "-12 hours",
      "24h": "-24 hours",
      "7d":  "-7 days",
      "30d": "-30 days",
      "90d": "-90 days",
      "all": "-365 days",
    };
    const timeModifier = timeModifiers[range] ?? "-24 hours";

    const db = getDb();

    // Uses idx_item_time index: scans only rows for this item in the requested range
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
    console.error("History API Error:", error);
    return res.status(500).json({ error: error.message, rows: [] });
  }
}
