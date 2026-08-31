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
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Edge CDN caching: Vercel serves market data from edge cache for 30s
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  let prices = [];
  let movers = { gainers: [], losers: [], changesMap: {} };
  let neededLiveFetch = false;

  // ─── Tier 1: Fast Turso Cache Query ──────────────────────────────────────────
  try {
    if (process.env.TURSO_DATABASE_URL) {
      const db = getDb();
      const cacheRes = await db.execute(
        "SELECT key, payload FROM market_cache WHERE key IN ('prices', 'movers');"
      );

      cacheRes.rows.forEach(row => {
        try {
          if (row.key === "prices") prices = JSON.parse(row.payload);
          if (row.key === "movers") movers = JSON.parse(row.payload);
        } catch (_) {}
      });
    }
  } catch (cacheErr) {
    console.warn("[market] Cache read warning:", cacheErr.message);
  }

  // ─── Tier 2: Fallback to Resource Prices Table ─────────────────────────────────
  if (!prices || prices.length === 0) {
    try {
      if (process.env.TURSO_DATABASE_URL) {
        const db = getDb();
        const fallbackRes = await db.execute(`
          SELECT item_name AS name, price
          FROM (
            SELECT item_name, price,
                   ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY recorded_at DESC) as rn
            FROM resource_prices
          )
          WHERE rn = 1;
        `);
        if (fallbackRes.rows && fallbackRes.rows.length > 0) {
          prices = fallbackRes.rows.map(r => ({
            name: r.name,
            price: parseFloat(r.price)
          }));
        }
      }
    } catch (fallbackErr) {
      console.warn("[market] Table fallback warning:", fallbackErr.message);
    }
  }

  // ─── Tier 3: Direct SFL API Fallback (Guarantees data is ALWAYS returned) ────
  if (!prices || prices.length === 0) {
    neededLiveFetch = true;
    try {
      console.log("[market] Tier 3: Fetching live from sfl.world API...");
      const sflRes = await fetch("https://sfl.world/api/v1/prices", {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SunChart/1.0; +https://sunchart.app)",
          "Accept": "application/json"
        }
      });
      if (sflRes.ok) {
        const data = await sflRes.json();
        prices = parseSflPrices(data);
      }
    } catch (sflErr) {
      console.error("[market] Live SFL API fallback error:", sflErr.message);
    }
  }

  // ─── Self-Healing Auto-Sync: Persist live prices if cache was cold ───────────
  if (neededLiveFetch && prices && prices.length > 0 && process.env.TURSO_DATABASE_URL) {
    try {
      const db = getDb();
      await ensureTablesExist(db);

      const batchStatements = prices.map(item => ({
        sql: `INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, datetime('now'));`,
        args: [item.name, parseFloat(item.price)],
      }));

      if (batchStatements.length > 0) {
        await db.batch(batchStatements, "write");
      }

      await db.execute({
        sql: `INSERT INTO market_cache (key, payload, updated_at) VALUES ('prices', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at;`,
        args: [JSON.stringify(prices)],
      });
    } catch (persistErr) {
      console.warn("[market] Self-healing persist warning:", persistErr.message);
    }
  }

  return res.status(200).json({ prices: prices || [], movers: movers || { gainers: [], losers: [], changesMap: {} } });
}
