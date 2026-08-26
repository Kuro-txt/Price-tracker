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

    let sqlQuery = "";
    let args = [];

    if (range === "24h") {
      // Full raw resolution for 24H (approx 96 points)
      sqlQuery = `
        SELECT item_name, price, recorded_at 
        FROM resource_prices 
        WHERE item_name = ? COLLATE NOCASE 
          AND recorded_at >= datetime('now', '-24 hours')
        ORDER BY recorded_at ASC
      `;
      args = [item];
    } else if (range === "7d") {
      // Raw resolution for 7D
      sqlQuery = `
        SELECT item_name, price, recorded_at 
        FROM resource_prices 
        WHERE item_name = ? COLLATE NOCASE 
          AND recorded_at >= datetime('now', '-7 days')
        ORDER BY recorded_at ASC
      `;
      args = [item];
    } else if (range === "30d" || range === "1m") {
      // 30 Days: Average price grouped by Hour (~720 points)
      sqlQuery = `
        SELECT 
          item_name, 
          ROUND(AVG(price), 6) AS price, 
          strftime('%Y-%m-%d %H:00:00', recorded_at) AS recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE 
          AND recorded_at >= datetime('now', '-30 days')
        GROUP BY strftime('%Y-%m-%d %H:00:00', recorded_at)
        ORDER BY recorded_at ASC
      `;
      args = [item];
    } else {
      // 90 Days: Average price grouped every 6 Hours (~360 points)
      sqlQuery = `
        SELECT 
          item_name, 
          ROUND(AVG(price), 6) AS price, 
          strftime('%Y-%m-%d %H:00:00', recorded_at) AS recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE 
          AND recorded_at >= datetime('now', '-90 days')
        GROUP BY (strftime('%s', recorded_at) / (6 * 3600))
        ORDER BY recorded_at ASC
      `;
      args = [item];
    }

    const result = await db.execute({ sql: sqlQuery, args });
    let rows = result.rows;

    // Fallback if data points are sparse (e.g. brand new database)
    if (rows.length === 0) {
      const fallback = await db.execute({
        sql: `SELECT item_name, price, recorded_at 
              FROM resource_prices 
              WHERE item_name = ? COLLATE NOCASE 
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
    console.error("History API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
