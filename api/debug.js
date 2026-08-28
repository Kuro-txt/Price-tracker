export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const report = {
    node_version: process.version,
    env_turso_url_set: !!process.env.TURSO_DATABASE_URL,
    env_turso_token_set: !!process.env.TURSO_AUTH_TOKEN,
    env_turso_url_prefix: process.env.TURSO_DATABASE_URL?.slice(0, 20) || "NOT SET",
    db_connection: "not tested",
    db_error: null,
    tables: [],
  };

  try {
    const { createClient } = await import("@libsql/client");

    if (!process.env.TURSO_DATABASE_URL) {
      report.db_connection = "skipped - TURSO_DATABASE_URL not set";
      return res.status(200).json(report);
    }

    const db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
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

  } catch (err) {
    report.db_connection = "failed";
    report.db_error = err.message;
  }

  return res.status(200).json(report);
}
