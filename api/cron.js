import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  const startTime = Date.now();

  try {
    // 1. Ensure database tables exist
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

    // 2. Fetch live prices with browser-like headers to pass Cloudflare filters
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const sflResponse = await fetch("https://sfl.world/api/prices", {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://sfl.world/",
        "Cache-Control": "no-cache"
      }
    });
    clearTimeout(timeoutId);

    // 3. Read raw text first to avoid parsing crashes on HTML
    const responseText = await sflResponse.text();

    if (!sflResponse.ok) {
      throw new Error(`Upstream SFL status ${sflResponse.status}: ${responseText.slice(0, 150)}`);
    }

    if (responseText.trim().startsWith("<") || responseText.includes("<!DOCTYPE html>")) {
      throw new Error(`Upstream SFL returned HTML instead of JSON. Cloudflare Challenge or invalid URL. Preview: ${responseText.slice(0, 180)}`);
    }

    let rawData;
    try {
      rawData = JSON.parse(responseText);
    } catch (_) {
      throw new Error(`Invalid JSON received from SFL. Snippet: ${responseText.slice(0, 150)}`);
    }

    // 4. Parse response into standard array
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
      throw new Error("Parsed price list is empty. Verify SFL API response format.");
    }

    // 5. Batch Insert new prices into resource_prices
    const nowIso = new Date().toISOString();
    const insertStatements = currentPrices.map(item => ({
      sql: `INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, datetime(?));`,
      args: [item.name, item.price, nowIso]
    }));

    await db.batch(insertStatements);

    // 6. Fetch past prices (~12h ago) to compute movers in memory
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

    // 7. Save precomputed snapshots to market_cache
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
    console.error("Cron Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
