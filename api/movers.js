export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      console.error("[movers] TURSO_DATABASE_URL is not set.");
      return res.status(500).json({ error: "Server misconfiguration: TURSO_DATABASE_URL missing." });
    }

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
    await db.execute(`
      CREATE TABLE IF NOT EXISTS market_cache (
        key        TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 1. Serve from 1-row cache
    const cacheRes = await db.execute(
      "SELECT payload FROM market_cache WHERE key = 'movers' LIMIT 1;"
    );
    if (cacheRes.rows.length > 0 && cacheRes.rows[0].payload) {
      const data = JSON.parse(cacheRes.rows[0].payload);
      if (data && (data.gainers?.length > 0 || data.losers?.length > 0 || Object.keys(data.changesMap || {}).length > 0)) {
        return res.status(200).json(data);
      }
    }

    // 2. Fallback: compute movers
    const moversRes = await db.execute(`
      WITH Latest AS (
        SELECT rp.item_name, rp.price AS current_price
        FROM resource_prices rp
        JOIN (
          SELECT item_name, MAX(recorded_at) AS max_at
          FROM resource_prices
          WHERE recorded_at >= datetime('now', '-6 hours')
          GROUP BY item_name
        ) m ON rp.item_name = m.item_name AND rp.recorded_at = m.max_at
      ),
      Past AS (
        SELECT rp.item_name, rp.price AS past_price
        FROM resource_prices rp
        JOIN (
          SELECT item_name, MIN(recorded_at) AS min_at
          FROM resource_prices
          WHERE recorded_at >= datetime('now', '-14 hours')
          GROUP BY item_name
        ) m ON rp.item_name = m.item_name AND rp.recorded_at = m.min_at
      )
      SELECT l.item_name, l.current_price, p.past_price,
        ROUND(((l.current_price - p.past_price) / p.past_price) * 100, 2) AS change_pct,
        ROUND(l.current_price - p.past_price, 6) AS change_amt
      FROM Latest l
      JOIN Past p ON LOWER(l.item_name) = LOWER(p.item_name)
      WHERE p.past_price > 0
      ORDER BY change_pct DESC;
    `);

    const gainers = [], losers = [], changesMap = {};
    moversRes.rows.forEach(row => {
      const item = {
        name: row.item_name, price: parseFloat(row.current_price),
        pastPrice: parseFloat(row.past_price),
        changePct: parseFloat(row.change_pct),
        changeAmt: parseFloat(row.change_amt),
      };
      changesMap[row.item_name.toLowerCase()] = item;
      if (item.changePct > 0) gainers.push(item);
      else if (item.changePct < 0) losers.push(item);
    });
    losers.sort((a, b) => a.changePct - b.changePct);

    const payload = { gainers, losers, changesMap };

    if (Object.keys(changesMap).length > 0) {
      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('movers', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(payload)],
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error("[movers] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message, gainers: [], losers: [], changesMap: {} });
  }
}
