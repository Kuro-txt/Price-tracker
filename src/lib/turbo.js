import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Auto-creates the table and index if they don't exist yet
export async function initDatabase() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS resource_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_resource_time 
    ON resource_prices (item_name, recorded_at DESC);
  `);
}
