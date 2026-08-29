import { createClient } from "@libsql/client";

let dbInstance = null;

export function getDb() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("Missing environment variable: TURSO_DATABASE_URL");
  }

  if (!dbInstance) {
    dbInstance = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
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
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         TEXT PRIMARY KEY,
      endpoint   TEXT NOT NULL UNIQUE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS push_alert_rules (
      id                 TEXT PRIMARY KEY,
      subscription_id    TEXT NOT NULL,
      item_name          TEXT NOT NULL,
      rule_type          TEXT NOT NULL,
      target_value       REAL NOT NULL,
      last_triggered_at  DATETIME,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_item_time ON resource_prices(item_name, recorded_at);
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_push_sub ON push_alert_rules(subscription_id);
  `);
}
