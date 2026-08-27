import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const item = req.query.item || "Sunflower";
    const range = req.query.range || "24h";

    let timeModifier = "-24 hours";
    if (range === "6h") timeModifier = "-6 hours";
    else if (range === "12h") timeModifier = "-12 hours";
    else if (range === "7d") timeModifier = "-7 days";
    else if (range === "30d") timeModifier = "-30 days";
    else if (range === "90d") timeModifier = "-90 days";
    else if (range === "all") timeModifier = "-365 days";

    // Uses idx_item_time index: scans only rows for this specific item in range
    const result = await db.execute({
      sql: `
        SELECT price, recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE
          AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC;
      `,
      args: [item, timeModifier]
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("History API Error:", error);
    return res.status(500).json({ error: error.message, rows: [] });
  }
}
