import { getDb, ensureTablesExist } from "./lib/db.js";
import { fetchLiveMarketPrices } from "./lib/collectibles.js";

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
      const livePrices = await fetchLiveMarketPrices();

      if (livePrices && livePrices.length > 0) {
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
    } catch (syncErr) {
      console.error("[market] Auto-sync error:", syncErr.message);
    }
  }

  return res.status(200).json({
    prices: prices || [],
    movers: movers || { gainers: [], losers: [], changesMap: {} }
  });
}
