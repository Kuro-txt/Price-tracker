import { createClient } from "@libsql/client/web";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const report = {
    node_version: process.version,
    env_turso_url_set: !!process.env.TURSO_DATABASE_URL,
    env_turso_token_set: !!process.env.TURSO_AUTH_TOKEN,
    env_turso_url_prefix: process.env.TURSO_DATABASE_URL?.slice(0, 25) || "NOT SET",
    db_connection: "not tested",
    db_error: null,
    tables: [],
    sample_prices: [],
    total_distinct_items: 0,
    latest_recorded_at: null,
  };

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      report.db_connection = "skipped - TURSO_DATABASE_URL not set";
      return res.status(200).json(report);
    }

    const url = process.env.TURSO_DATABASE_URL.trim().replace(/^libsql:\/\//i, "https://");
    const db = createClient({
      url,
      authToken: (process.env.TURSO_AUTH_TOKEN || "").trim(),
    });

    // Test basic query
    const tablesRes = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
    );
    report.tables = tablesRes.rows.map(r => r.name);
    report.db_connection = "success";

    // Check row counts
    for (const table of report.tables) {
      try {
        const countRes = await db.execute(`SELECT COUNT(*) as cnt FROM ${table};`);
        report[`${table}_rows`] = countRes.rows[0].cnt;
      } catch (_) {}
    }

    if (report.tables.includes("resource_prices")) {
      try {
        const sampleRes = await db.execute(`
          SELECT item_name, price, recorded_at
          FROM resource_prices
          ORDER BY id DESC
          LIMIT 5;
        `);
        report.sample_prices = sampleRes.rows;

        const distinctRes = await db.execute(`
          SELECT COUNT(DISTINCT item_name) as distinct_cnt, MAX(recorded_at) as latest
          FROM resource_prices;
        `);
        report.total_distinct_items = distinctRes.rows[0]?.distinct_cnt || 0;
        report.latest_recorded_at = distinctRes.rows[0]?.latest || null;
      } catch (_) {}
    }

  } catch (err) {
    report.db_connection = "failed";
    report.db_error = err.message;
  }

  return res.status(200).json(report);
}
