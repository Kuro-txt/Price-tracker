import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const item = req.query.item;
    const range = req.query.range || "24h";

    if (!item) {
      return res.status(400).json({ error: "Item parameter is required" });
    }

    // Map range parameter to SQLite datetime modifier
    let timeModifier = "-24 hours";
    if (range === "7d") timeModifier = "-7 days";
    else if (range === "30d" || range === "1m") timeModifier = "-30 days";
    else if (range === "90d" || range === "3m") timeModifier = "-90 days";

    const result = await db.execute({
      sql: `SELECT item_name, price, recorded_at 
            FROM resource_prices 
            WHERE LOWER(item_name) = LOWER(?) 
              AND recorded_at >= datetime('now', ?) 
            ORDER BY recorded_at ASC`,
      args: [item, timeModifier],
    });

    let rows = result.rows;

    // Fallback: If no records exist in the selected range, fetch recent available entries
    if (rows.length === 0) {
      const fallback = await db.execute({
        sql: `SELECT item_name, price, recorded_at 
              FROM resource_prices 
              WHERE LOWER(item_name) = LOWER(?) 
              ORDER BY recorded_at ASC 
              LIMIT 50`,
        args: [item],
      });
      rows = fallback.rows;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate");
    return res.status(200).json(rows);
  } catch (error) {
    console.error("History fetch error:", error);
    return res.status(500).json({ error: error.message });
  }
}
