import { createClient } from "@libsql/client/web";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const report = {
    node_version: process.version,
    env_turso_url_set: !!process.env.TURSO_DATABASE_URL,
    env_turso_token_set: !!process.env.TURSO_AUTH_TOKEN,
    db_connection: "not tested",
    db_error: null,
  };

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      report.db_connection = "skipped - TURSO_DATABASE_URL not set";
      return res.status(200).json(report);
    }

    const db = createClient({
      url: process.env.TURSO_DATABASE_URL.trim(),
      authToken: (process.env.TURSO_AUTH_TOKEN || "").trim(),
    });

    const tablesRes = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
    );
    report.tables = tablesRes.rows.map(r => r.name);
    report.db_connection = "success";

    // Test pastRes baseline query:
    const pastRes = await db.execute(`
      SELECT item_name, price AS past_price, recorded_at
      FROM (
        SELECT item_name, price, recorded_at,
               ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at DESC) as rn
        FROM resource_prices
        WHERE recorded_at <= datetime('now', '-2 hours')
      )
      WHERE rn = 1;
    `);

    report.past_items_found = pastRes.rows.length;
    report.sample_past_items = pastRes.rows.slice(0, 5);

  } catch (err) {
    report.db_connection = "failed";
    report.db_error = err.message;
  }

  return res.status(200).json(report);
}
