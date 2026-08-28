import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const config = {
  maxDuration: 30, // Extends timeout limit if supported
};

export default async function handler(req, res) {
  const startTime = Date.now();

  try {
    // 1. Ensure all required tables exist
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

    // 2. Fetch live prices from SFL World API with timeout safety
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const sflResponse = await fetch("https://sfl.world/api/prices", {
      signal: controller.signal,
      headers: {
        "User-Agent": "SunChart-Terminal/1.0",
        "Accept": "application/json"
      }
    });
    clearTimeout(timeoutId);

    if (!sflResponse.ok) {
      throw new Error(`SFL API responded with status: ${sflResponse.status}`);
    }

    const rawData = await sflResponse.json();
    
    // Parse response into a standardized array: [{ name: "Sunflower", price: 0.0012 }, ...]
    const currentPrices = [];
    if (Array.isArray(rawData)) {
      rawData.forEach(item => {
        const name = item.name || item.item_name;
        const price = parseFloat(item.price || item.current_price || 0);
        if (name && !isNaN(price)) currentPrices.push({ name, price });
      });
    } else if (typeof rawData === 'object' && rawData !== null) {
      const listKey = Object.keys(rawData).find(k => Array.isArray(rawData[k]));
      if (listKey) {
        rawData[listKey].forEach(item => {
          const name = item.name || item.item_name;
          const price = parseFloat(item.price || item.current_price || 0);
          if (name && !isNaN(price)) currentPrices.push({ name, price });
        });
      } else {
        Object.entries(rawData).forEach(([name, val]) => {
          if (name === 'error' || name === 'status') return;
          const price = typeof val === 'object' && val !== null ? parseFloat(val.price || 0) : parseFloat(val || 0);
          if (name && !isNaN(price)) currentPrices.push({ name, price });
        });
      }
    }

    if (currentPrices.length === 0) {
      throw new Error("Parsed price list is empty. Check API response format.");
    }

    // 3. Batch Insert new prices into resource_prices
    const nowIso = new Date().toISOString();
    const insertStatements = currentPrices.map(item => ({
      sql: `INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, datetime(?));`,
      args: [item.name, item.price, nowIso]
    }));

    await db.batch(insertStatements);

    // 4. Fetch past prices (~12 hours ago) to compute movers
    const pastRes = await db.execute(`
      SELECT item_name, price, MIN(recorded_at) as earliest_time
      FROM resource_prices
      WHERE recorded_at >= datetime('now', '-14 hours')
      GROUP BY item_name;
    `);

    const pastMap = {};
    pastRes.rows.forEach(r => {
      pastMap[r.item_name.toLowerCase()] = parseFloat(r.price);
    });

    // 5. Compute Movers in Node.js Memory (Lightning Fast & Zero SQL Timeout Risk)
    const gainers = [];
    const losers = [];
    const changesMap = {};

    currentPrices.forEach(item => {
      const pastPrice = pastMap[item.name.toLowerCase()] || item.price;
      const changeAmt = item.price - pastPrice;
      const changePct = pastPrice > 0 ? (changeAmt / pastPrice) * 100 : 0;

      const moverRecord = {
        name: item.name,
        price: item.price,
        pastPrice: pastPrice,
        changePct: parseFloat(changePct.toFixed(2)),
        changeAmt: parseFloat(changeAmt.toFixed(6))
      };

      changesMap[item.name.toLowerCase()] = moverRecord;

      if (moverRecord.changePct > 0) {
        gainers.push(moverRecord);
      } else if (moverRecord.changePct < 0) {
        losers.push(moverRecord);
      }
    });

    gainers.sort((a, b) => b.changePct - a.changePct);
    losers.sort((a, b) => a.changePct - b.changePct);

    // 6. Save precomputed JSON snapshots into market_cache
    await db.batch([
      {
        sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('prices', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(currentPrices)]
      },
      {
        sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('movers', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify({ gainers, losers, changesMap })]
      }
    ]);

    const duration = Date.now() - startTime;
    return res.status(200).json({
      success: true,
      itemsUpdated: currentPrices.length,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Cron Execution Failed:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
}
