export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      console.error("[history] TURSO_DATABASE_URL is not set.");
      return res.status(500).json({ error: "Server misconfiguration: TURSO_DATABASE_URL missing." });
    }

    const item  = req.query.item  || "Sunflower";
    const range = req.query.range || "24h";

    const timeModifiers = {
      "6h": "-6 hours", "12h": "-12 hours", "24h": "-24 hours",
      "7d": "-7 days",  "30d": "-30 days",  "90d": "-90 days",
      "all": "-365 days",
    };
    const timeModifier = timeModifiers[range] ?? "-24 hours";

    const { createClient } = await import("@libsql/client");
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS resource_prices (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name   TEXT    NOT NULL,
        price       REAL    NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const result = await db.execute({
      sql: `
        SELECT price, recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE
          AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC;
      `,
      args: [item, timeModifier],
    });

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("[history] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message, rows: [] });
  }
}
