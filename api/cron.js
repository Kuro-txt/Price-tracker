import { getDb, ensureTablesExist } from "./lib/db.js";

function parseSflPrices(json) {
  const result = [];
  if (!json) return result;

  if (Array.isArray(json)) {
    return json.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
  }
  if (Array.isArray(json.data)) {
    return json.data.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
  }
  if (Array.isArray(json.prices)) {
    return json.prices.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
  }

  const sourceObj = (json.data && json.data.p2p) || (json.p2p) || (json.data) || json;
  if (typeof sourceObj === "object" && sourceObj !== null) {
    for (const [name, price] of Object.entries(sourceObj)) {
      const numPrice = typeof price === "object" && price !== null ? parseFloat(price.price || price.value) : parseFloat(price);
      if (name && !isNaN(numPrice) && typeof name === "string") {
        result.push({ name, price: numPrice });
      }
    }
  }
  return result;
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    await ensureTablesExist(db);

    // 1. Fetch live prices from sfl.world
    const response = await fetch("https://sfl.world/api/v1/prices", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SunChart/1.0; +https://sunchart.app)",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`SFL API responded with status ${response.status}`);
    }

    const data = await response.json();
    const latestPrices = parseSflPrices(data);

    if (latestPrices.length === 0) {
      return res.status(200).json({ message: "No prices returned from source.", raw: data });
    }

    // 2. Batch insert new prices (preserving full raw decimal precision)
    const batchStatements = latestPrices.map(item => ({
      sql: `INSERT INTO resource_prices (item_name, price, recorded_at)
            VALUES (?, ?, datetime('now'));`,
      args: [item.name, parseFloat(item.price)],
    }));

    if (batchStatements.length > 0) {
      await db.batch(batchStatements);
    }

    // 3. Update market_cache with latest prices
    await db.execute({
      sql: `INSERT INTO market_cache (key, payload, updated_at)
            VALUES ('prices', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
              SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(latestPrices)],
    });

    // 4. Compute Movers against baseline recorded >= 2 hours ago
    let pastRes = await db.execute(`
      SELECT item_name, price AS past_price
      FROM (
        SELECT item_name, price,
               ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at DESC) as rn
        FROM resource_prices
        WHERE recorded_at <= datetime('now', '-2 hours')
      )
      WHERE rn = 1;
    `);

    // Fallback if no records older than 2h exist yet
    if (!pastRes.rows || pastRes.rows.length === 0) {
      pastRes = await db.execute(`
        SELECT item_name, price AS past_price
        FROM (
          SELECT item_name, price,
                 ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at ASC) as rn
          FROM resource_prices
        )
        WHERE rn = 1;
      `);
    }

    const pastMap = {};
    if (pastRes.rows) {
      pastRes.rows.forEach(r => {
        pastMap[r.item_name.toLowerCase()] = parseFloat(r.past_price);
      });
    }

    const gainers = [];
    const losers  = [];
    const changesMap = {};

    latestPrices.forEach(item => {
      const lower = item.name.toLowerCase();
      const pastPrice = (pastMap[lower] !== undefined && pastMap[lower] !== null) ? pastMap[lower] : item.price;
      const changeAmt = item.price - pastPrice;
      const changePct = pastPrice > 0 ? parseFloat(((changeAmt / pastPrice) * 100).toFixed(2)) : 0;

      const moverItem = {
        name: item.name,
        price: item.price,
        pastPrice: pastPrice,
        changePct: changePct,
        changeAmt: parseFloat(changeAmt.toFixed(8))
      };

      changesMap[lower] = moverItem;
      if (changePct >= 0) gainers.push(moverItem);
      else losers.push(moverItem);
    });

    gainers.sort((a, b) => b.changePct - a.changePct);
    losers.sort((a, b) => a.changePct - b.changePct);

    const moversPayload = { gainers, losers, changesMap };

    await db.execute({
      sql: `INSERT INTO market_cache (key, payload, updated_at)
            VALUES ('movers', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
              SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(moversPayload)],
    });

    return res.status(200).json({
      success: true,
      inserted: batchStatements.length,
      gainers: gainers.length,
      losers: losers.length
    });

  } catch (error) {
    console.error("[cron] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}
