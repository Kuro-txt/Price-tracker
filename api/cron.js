// Add this helper inside your cron handler after saving new prices to resource_prices:
async function updatePrecomputedCache(db) {
  // 1. Fetch Latest Prices Snapshot
  const pricesRes = await db.execute(`
    SELECT item_name AS name, price
    FROM resource_prices
    WHERE recorded_at >= datetime('now', '-3 hours')
    GROUP BY item_name
    HAVING recorded_at = MAX(recorded_at)
    ORDER BY item_name ASC;
  `);
  
  const latestPrices = pricesRes.rows.map(r => ({
    name: r.name,
    price: parseFloat(r.price)
  }));

  // 2. Compute 12H Movers Snapshot
  const moversRes = await db.execute(`
    WITH Latest AS (
      SELECT item_name, price AS current_price
      FROM resource_prices
      WHERE recorded_at >= datetime('now', '-3 hours')
      GROUP BY item_name
      HAVING recorded_at = MAX(recorded_at)
    ),
    Past AS (
      SELECT item_name, price AS past_price
      FROM resource_prices
      WHERE recorded_at >= datetime('now', '-14 hours')
      GROUP BY item_name
      HAVING recorded_at = MIN(recorded_at)
    )
    SELECT 
      l.item_name,
      l.current_price,
      p.past_price,
      ROUND(((l.current_price - p.past_price) / p.past_price) * 100, 2) AS change_pct,
      ROUND(l.current_price - p.past_price, 6) AS change_amt
    FROM Latest l
    JOIN Past p ON LOWER(l.item_name) = LOWER(p.item_name)
    WHERE p.past_price > 0
    ORDER BY change_pct DESC;
  `);

  const gainers = [];
  const losers = [];
  const changesMap = {};

  moversRes.rows.forEach(row => {
    const item = {
      name: row.item_name,
      price: parseFloat(row.current_price),
      pastPrice: parseFloat(row.past_price),
      changePct: parseFloat(row.change_pct),
      changeAmt: parseFloat(row.change_amt)
    };
    changesMap[row.item_name.toLowerCase()] = item;
    if (item.changePct > 0) gainers.push(item);
    else if (item.changePct < 0) losers.push(item);
  });
  losers.sort((a, b) => a.changePct - b.changePct);

  // 3. Save as single JSON blobs in market_cache (Exact 2 write operations)
  await db.batch([
    {
      sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('prices', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(latestPrices)]
    },
    {
      sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('movers', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify({ gainers, losers, changesMap })]
    }
  ]);
}
