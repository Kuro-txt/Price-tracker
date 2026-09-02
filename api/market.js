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

const TEN_MINUTES_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Global Edge CDN cache: Vercel serves market data for 60s across all global visitors with 0 Turso reads
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");

  let prices = [];
  let movers = { gainers: [], losers: [], changesMap: {} };
  let lastUpdated = 0;
  let cacheStale = false;

  // ─── Step 1: Read Fast Turso Cache (2 rows read) ───────────────────────────
  try {
    if (process.env.TURSO_DATABASE_URL) {
      const db = getDb();
      const cacheRes = await db.execute(
        "SELECT key, payload, updated_at FROM market_cache WHERE key IN ('prices', 'movers');"
      );

      cacheRes.rows.forEach(row => {
        try {
          if (row.key === "prices") {
            prices = JSON.parse(row.payload);
            const ts = new Date(row.updated_at).getTime();
            if (!isNaN(ts)) lastUpdated = ts;
          }
          if (row.key === "movers") movers = JSON.parse(row.payload);
        } catch (_) {}
      });
    }
  } catch (cacheErr) {
    console.warn("[market] Cache read warning:", cacheErr.message);
  }

  const now = Date.now();
  // If cache is empty or older than 10 minutes, trigger self-healing auto-sync
  if (!prices || prices.length === 0 || (now - lastUpdated) > TEN_MINUTES_MS) {
    cacheStale = true;
  }

  // ─── Step 2: Self-Healing Auto-Sync (Persists fresh prices for graph) ───────
  if (cacheStale) {
    try {
      console.log("[market] Syncing fresh live prices from sfl.world...");
      const sflRes = await fetch("https://sfl.world/api/v1/prices", {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SunChart/1.0; +https://sunchart.app)",
          "Accept": "application/json"
        }
      });

      if (sflRes.ok) {
        const data = await sflRes.json();
        const livePrices = parseSflPrices(data);

        if (livePrices.length > 0) {
          prices = livePrices;

          if (process.env.TURSO_DATABASE_URL) {
            const db = getDb();
            await ensureTablesExist(db);

            // Batch insert into resource_prices with ISO 8601 UTC timestamp for time-series charts
            const batchStatements = livePrices.map(item => ({
              sql: `INSERT INTO resource_prices (item_name, price, recorded_at)
                    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));`,
              args: [item.name, parseFloat(item.price)],
            }));

            if (batchStatements.length > 0) {
              await db.batch(batchStatements);
            }

            // Update market_cache with fresh prices
            await db.execute({
              sql: `INSERT INTO market_cache (key, payload, updated_at)
                    VALUES ('prices', ?, datetime('now'))
                    ON CONFLICT(key) DO UPDATE
                      SET payload = excluded.payload, updated_at = excluded.updated_at;`,
              args: [JSON.stringify(livePrices)],
            });
          }
        }
      }
    } catch (syncErr) {
      console.error("[market] Auto-sync error:", syncErr.message);
    }
  }

  return res.status(200).json({
    prices: prices || [],
    movers: movers || { gainers: [], losers: [], changesMap: {} }
  });
}
