import { getDb } from "./lib/db.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const startTime = Date.now();

  try {
    const db = getDb();

    // 1. Ensure tables + index exist
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
    // Critical for history.js query performance
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_item_time
        ON resource_prices (item_name, recorded_at);
    `);

    // 2. Fetch live prices from sfl.world
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10000);

    const sflResponse = await fetch("https://sfl.world/api/v1/prices", {
      signal:  controller.signal,
      headers: {
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":        "application/json, text/plain, */*",
        "Cache-Control": "no-cache",
      },
    });
    clearTimeout(timeoutId);

    const responseText = await sflResponse.text();

    if (!sflResponse.ok) {
      throw new Error(`SFL API responded with HTTP ${sflResponse.status}: ${responseText.slice(0, 150)}`);
    }
    if (responseText.trim().startsWith("<")) {
      throw new Error(`Received HTML instead of JSON: ${responseText.slice(0, 150)}`);
    }

    let rawData;
    try {
      rawData = JSON.parse(responseText);
    } catch (_) {
      throw new Error(`Invalid JSON from SFL. Snippet: ${responseText.slice(0, 150)}`);
    }

    // 3. Extract items from data.p2p dictionary structure
    const currentPrices = [];

    const addPriceEntry = (name, val) => {
      let price = 0;
      if (typeof val === "number") {
        price = val;
      } else if (typeof val === "string") {
        price = parseFloat(val);
      } else if (typeof val === "object" && val !== null) {
        price = parseFloat(val.price ?? val.sfl ?? val.floor ?? val.value ?? 0);
      }
      if (name && typeof name === "string" && !isNaN(price) && price > 0) {
        currentPrices.push({ name: name.trim(), price });
      }
    };

    if (rawData?.data?.p2p && typeof rawData.data.p2p === "object") {
      Object.entries(rawData.data.p2p).forEach(([name, val]) => addPriceEntry(name, val));
    } else if (rawData?.data && typeof rawData.data === "object") {
      Object.entries(rawData.data).forEach(([key, val]) => {
        if (typeof val === "object" && val !== null && !val.price && !val.sfl) {
          Object.entries(val).forEach(([subName, subVal]) => addPriceEntry(subName, subVal));
        } else {
          addPriceEntry(key, val);
        }
      });
    } else if (Array.isArray(rawData)) {
      rawData.forEach(item => {
        const name  = item.name || item.item_name || item.item;
        const price = parseFloat(item.price ?? item.current_price ?? item.sfl ?? 0);
        if (name && !isNaN(price) && price > 0) currentPrices.push({ name: name.trim(), price });
      });
    }

    if (currentPrices.length === 0) {
      throw new Error(`Could not parse price entries from response: ${responseText.slice(0, 200)}`);
    }

    // 4. Batch insert new records
    const nowIso           = new Date().toISOString();
    const insertStatements = currentPrices.map(item => ({
      sql:  "INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, datetime(?));",
      args: [item.name, item.price, nowIso],
    }));
    await db.batch(insertStatements);

    // 5. Compute movers in memory using correct subquery join for past baseline
    const pastRes = await db.execute(`
      SELECT rp.item_name, rp.price
      FROM resource_prices rp
      JOIN (
        SELECT item_name, MIN(recorded_at) AS min_at
        FROM resource_prices
        WHERE recorded_at >= datetime('now', '-14 hours')
        GROUP BY item_name
      ) m ON rp.item_name = m.item_name AND rp.recorded_at = m.min_at;
    `);

    const pastMap = {};
    pastRes.rows.forEach(r => {
      pastMap[r.item_name.toLowerCase()] = parseFloat(r.price);
    });

    // 6. Compute gainers / losers
    const gainers    = [];
    const losers     = [];
    const changesMap = {};

    currentPrices.forEach(item => {
      const pastPrice = pastMap[item.name.toLowerCase()] ?? item.price;
      const changeAmt = item.price - pastPrice;
      const changePct = pastPrice > 0 ? (changeAmt / pastPrice) * 100 : 0;

      const moverRecord = {
        name:      item.name,
        price:     item.price,
        pastPrice: pastPrice,
        changePct: parseFloat(changePct.toFixed(2)),
        changeAmt: parseFloat(changeAmt.toFixed(6)),
      };

      changesMap[item.name.toLowerCase()] = moverRecord;
      if (moverRecord.changePct > 0) gainers.push(moverRecord);
      else if (moverRecord.changePct < 0) losers.push(moverRecord);
    });

    gainers.sort((a, b) => b.changePct - a.changePct);
    losers.sort((a, b) => a.changePct - b.changePct);

    // 7. Persist precomputed snapshots to market_cache
    await db.batch([
      {
        sql:  `INSERT INTO market_cache (key, payload, updated_at) VALUES ('prices', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(currentPrices)],
      },
      {
        sql:  `INSERT INTO market_cache (key, payload, updated_at) VALUES ('movers', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify({ gainers, losers, changesMap })],
      },
    ]);

    return res.status(200).json({
      success:      true,
      itemsUpdated: currentPrices.length,
      durationMs:   Date.now() - startTime,
      timestamp:    new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cron Execution Failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
