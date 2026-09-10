import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const report = {};

  try {
    const db = getDb();

    // 1. Check existing indexes
    const idxRes = await db.execute("PRAGMA index_list('resource_prices');");
    report.indexes = idxRes.rows;

    // 2. Explain query plan for the 30d query
    const explain30d = await db.execute({
      sql: `EXPLAIN QUERY PLAN
            SELECT price, recorded_at
            FROM resource_prices
            WHERE item_name = ? COLLATE NOCASE
              AND datetime(recorded_at) >= datetime('now', '-30 days')
            GROUP BY strftime('%Y-%m-%d %H:00', recorded_at)
            ORDER BY recorded_at ASC
            LIMIT 1000;`,
      args: ["Sunflower"]
    });
    report.explain_30d = explain30d.rows;

    // 3. Explain query plan without GROUP BY
    const explainNoGroup = await db.execute({
      sql: `EXPLAIN QUERY PLAN
            SELECT price, recorded_at
            FROM resource_prices
            WHERE item_name = ? COLLATE NOCASE
              AND recorded_at >= datetime('now', '-30 days')
            ORDER BY recorded_at ASC
            LIMIT 1000;`,
      args: ["Sunflower"]
    });
    report.explain_no_group = explainNoGroup.rows;

    // 4. Check row count for Sunflower
    const countRes = await db.execute({
      sql: "SELECT count(*) as count FROM resource_prices WHERE item_name = 'Sunflower';",
      args: []
    });
    report.sunflower_rows = countRes.rows[0];

    // 5. Total rows in resource_prices
    const totalRes = await db.execute("SELECT count(*) as total FROM resource_prices;");
    report.total_rows = totalRes.rows[0];

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
