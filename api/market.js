// /api/market — combined endpoint.
// Returns { prices, movers } with ONE DB read instead of the two
// separate reads that /api/prices + /api/movers used to require.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(500).json({
        error: "TURSO_DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables (check Preview)."
      });
    }

    const { createClient } = await import("@libsql/client");
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Ensure tables exist (safe on cold start)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS resource_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        price REAL NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS market_cache (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ─── ONE QUERY for both cache rows ────────────────────────────────────
    const cacheRes = await db.execute(
      "SELECT key, payload FROM market_cache WHERE key IN ('prices', 'movers');"
    );

    let prices = [];
    let movers = { gainers: [], losers: [], changesMap: {} };

    cacheRes.rows.forEach(row => {
      try {
        if (row.key === "prices") prices = JSON.parse(row.payload);
        if (row.key === "movers") movers = JSON.parse(row.payload);
      } catch (_) {}
    });

    return res.status(200).json({ prices, movers });
  } catch (error) {
    console.error("[market] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}
