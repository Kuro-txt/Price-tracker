import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const item = req.query.item;
    const limit = parseInt(req.query.limit || "50", 10);

    if (!item) {
      return res.status(400).json({ error: "Item parameter is required" });
    }

    const result = await db.execute({
      sql: `SELECT item_name, price, recorded_at 
            FROM resource_prices 
            WHERE LOWER(item_name) = LOWER(?) 
            ORDER BY recorded_at ASC 
            LIMIT ?`,
      args: [item, limit],
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate");
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("History fetch error:", error);
    return res.status(500).json({ error: error.message });
  }
}
