import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  // 1. Authorize trigger via query param (?secret=...) or Bearer header
  const authHeader = req.headers.authorization;
  const secretParam = req.query.secret;
  const isAuthorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    secretParam === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 2. Ensure table and index exist in Turso
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

    // 3. Fetch latest live prices from SFL API
    const response = await fetch("https://sfl.world/api/v1/prices", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) throw new Error(`SFL API status: ${response.status}`);
    const json = await response.json();

    const timestamp = new Date().toISOString();
    const p2pItems = json.data?.p2p || json.data || {};
    const batch = [];

    // 4. Prepare batch insert statements
    for (const [name, price] of Object.entries(p2pItems)) {
      const numPrice = parseFloat(price);
      if (name && !isNaN(numPrice)) {
        batch.push({
          sql: "INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, ?)",
          args: [name, numPrice, timestamp],
        });
      }
    }

    // 5. Execute batch write to Turso cloud
    if (batch.length > 0) {
      await db.batch(batch, "write");
    }

    return res.status(200).json({
      success: true,
      savedCount: batch.length,
      timestamp,
    });
  } catch (error) {
    console.error("Cloud Save Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
