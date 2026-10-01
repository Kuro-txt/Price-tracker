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

    // 6. Rollup tables stats
    try {
      const hourlyStats = await db.execute(
        "SELECT count(*) as count, min(hour_at) as min_hour, max(hour_at) as max_hour FROM price_hourly;"
      );
      report.price_hourly = hourlyStats.rows[0];
    } catch (e) {
      report.price_hourly_error = e.message;
    }

    try {
      const dailyStats = await db.execute(
        "SELECT count(*) as count, min(day_at) as min_day, max(day_at) as max_day FROM price_daily;"
      );
      report.price_daily = dailyStats.rows[0];
    } catch (e) {
      report.price_daily_error = e.message;
    }

    // 7. Optional backfill action: ?action=backfill
    if (req.query.action === "backfill") {
      const startMs = Date.now();
      const b1 = await db.execute(`
        INSERT OR IGNORE INTO price_hourly (item_name, avg_price, hour_at)
        SELECT item_name, AVG(price) as avg_price, strftime('%Y-%m-%dT%H:00:00Z', recorded_at) as hour_at
        FROM resource_prices
        WHERE recorded_at < '2026-09-10T12:00:00Z'
        GROUP BY item_name, strftime('%Y-%m-%dT%H:00:00Z', recorded_at);
      `);

      const b2 = await db.execute(`
        INSERT OR IGNORE INTO price_daily (item_name, avg_price, day_at)
        SELECT item_name, AVG(price) as avg_price, strftime('%Y-%m-%d', recorded_at) as day_at
        FROM resource_prices
        WHERE recorded_at < '2026-09-10'
        GROUP BY item_name, strftime('%Y-%m-%d', recorded_at);
      `);

      report.backfill = {
        elapsed_ms: Date.now() - startMs,
        hourly_rows_affected: b1.rowsAffected,
        daily_rows_affected: b2.rowsAffected,
      };
    }

    // 8. Storage management cleanup action: ?action=cleanup_storage
    if (req.query.action === "cleanup_storage") {
      const startMs = Date.now();

      // Prune raw resource_prices older than 8 days
      const pruneRes = await db.execute(`
        DELETE FROM resource_prices
        WHERE datetime(recorded_at) < datetime('now', '-8 days');
      `);

      // Drop 3 duplicate legacy indexes
      await db.execute("DROP INDEX IF EXISTS idx_item_time;");
      await db.execute("DROP INDEX IF EXISTS idx_resource_nocase;");
      await db.execute("DROP INDEX IF EXISTS idx_resource_time;");

      // Verify remaining indexes and row count
      const remainingIdx = await db.execute("PRAGMA index_list('resource_prices');");
      const remainingRows = await db.execute("SELECT count(*) as count FROM resource_prices;");

      report.cleanup_storage = {
        elapsed_ms: Date.now() - startMs,
        rows_deleted: pruneRes.rowsAffected,
        remaining_rows: remainingRows.rows[0].count,
        remaining_indexes: remainingIdx.rows
      };
    }

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
