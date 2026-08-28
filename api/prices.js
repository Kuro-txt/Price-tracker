export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");

  try {
    // Validate environment variables upfront with clear error messages
    if (!process.env.TURSO_DATABASE_URL) {
      console.error("[prices] TURSO_DATABASE_URL is not set in Vercel environment variables.");
      return res.status(500).json({ error: "Server misconfiguration: TURSO_DATABASE_URL missing. Add it in Vercel → Settings → Environment Variables and ensure Preview is checked." });
    }

    const { createClient } = await import("@libsql/client");
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Ensure tables exist
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

    // 1. Serve from 1-row cache
    const cacheRes = await db.execute(
      "SELECT payload FROM market_cache WHERE key = 'prices' LIMIT 1;"
    );
    if (cacheRes.rows.length > 0 && cacheRes.rows[0].payload) {
      const data = JSON.parse(cacheRes.rows[0].payload);
      if (Array.isArray(data) && data.length > 0) {
        return res.status(200).json(data);
      }
    }

    // 2. Fallback: fetch latest price per item via subquery join
    let prices = await fetchLatestPrices(db, "-6 hours");
    if (prices.length === 0) prices = await fetchLatestPrices(db, null);

    // 3. Save to cache
    if (prices.length > 0) {
      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at)
              VALUES ('prices', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE
                SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(prices)],
      });
    }

    // If still empty, cron hasn't run yet
    if (prices.length === 0) {
      return res.status(200).json([]);
    }

    return res.status(200).json(prices);

  } catch (error) {
    console.error("[prices] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}

async function fetchLatestPrices(db, timeModifier) {
  const whereClause = timeModifier
    ? `WHERE recorded_at >= datetime('now', '${timeModifier}')`
    : "";
  const res = await db.execute(`
    SELECT rp.item_name AS name, rp.price
    FROM resource_prices rp
    JOIN (
      SELECT item_name, MAX(recorded_at) AS max_at
      FROM resource_prices
      ${whereClause}
      GROUP BY item_name
    ) latest ON rp.item_name = latest.item_name AND rp.recorded_at = latest.max_at
    ORDER BY rp.item_name ASC;
  `);
  return res.rows.map(r => ({ name: r.name, price: parseFloat(r.price) }));
}
