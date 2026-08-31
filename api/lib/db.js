import { createClient } from "@libsql/client/web";

let dbInstance = null;

export function getDb() {
  const rawUrl = process.env.TURSO_DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Missing environment variable: TURSO_DATABASE_URL");
  }

  // Pure HTTPS scheme required for @libsql/client/web serverless HTTP pipeline
  const url = rawUrl.trim().replace(/^libsql:\/\//i, "https://");
  const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim();

  if (!dbInstance) {
    dbInstance = createClient({
      url,
      authToken,
    });
  }

  return dbInstance;
}

export async function ensureTablesExist(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS resource_prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name   TEXT    NOT NULL,
      price       REAL    NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS market_cache (
      key        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // High-performance index matching COLLATE NOCASE queries (eliminates full-table scans)
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_item_time_nocase ON resource_prices(item_name COLLATE NOCASE, recorded_at ASC);
  `);
}
