import { createClient } from "@libsql/client";

let _db = null;

export function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL environment variable is missing in Vercel project settings.");
  }

  if (!_db) {
    _db = createClient({ url, authToken });
  }
  return _db;
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
}
