import { getDb } from "./lib/db.js";

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
  // Global Edge CDN cache: Vercel serves market data for 60s across all global visitors with 0 Turso reads
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");

  let prices = [];
  let movers = { gainers: [], losers: [], changesMap: {} };

  // ─── Fast Read: Exactly 2 rows read from Turso cache ────────────────────────
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

  // ─── Direct SFL API Fallback: If cache cold, fetch from source (0 DB reads) ──
  if (!prices || prices.length === 0) {
    try {
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

  return res.status(200).json({
    prices: prices || [],
    movers: movers || { gainers: [], losers: [], changesMap: {} }
  });
}
