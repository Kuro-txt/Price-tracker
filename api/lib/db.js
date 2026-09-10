import { createClient } from "@libsql/client/web";

let dbInstance = null;

export function getDb() {
  const rawUrl = process.env.TURSO_DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Missing environment variable: TURSO_DATABASE_URL");
  }

  // Ensure pure HTTPS scheme for stateless serverless HTTP client
  let url = rawUrl.trim();
  if (url.startsWith("libsql://")) {
    url = url.replace("libsql://", "https://");
  }
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

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_item_time_nocase ON resource_prices(item_name COLLATE NOCASE, recorded_at ASC);
  `);

  // Tier-2: hourly rollup (used for 7d and 30d charts)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS price_hourly (
      item_name TEXT NOT NULL,
      avg_price REAL NOT NULL,
      hour_at   TEXT NOT NULL,
      PRIMARY KEY (item_name, hour_at)
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_hourly_item_time ON price_hourly(item_name COLLATE NOCASE, hour_at ASC);
  `);

  // Tier-3: daily rollup (used for 90d and all-time charts)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS price_daily (
      item_name TEXT NOT NULL,
      avg_price REAL NOT NULL,
      day_at    TEXT NOT NULL,
      PRIMARY KEY (item_name, day_at)
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_daily_item_time ON price_daily(item_name COLLATE NOCASE, day_at ASC);
  `);
}
