import { getDb } from "./lib/db.js";

function parseSflPrices(json) {
  const result = [];
  if (!json) return result;
  if (Array.isArray(json)) return json.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
  if (Array.isArray(json.data)) return json.data.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
  if (Array.isArray(json.prices)) return json.prices.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
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
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  let prices = [];

  try {
    if (process.env.TURSO_DATABASE_URL) {
      const db = getDb();
      const cacheRes = await db.execute("SELECT payload FROM market_cache WHERE key = 'prices';");
      if (cacheRes.rows.length > 0) {
        try { prices = JSON.parse(cacheRes.rows[0].payload); } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("[prices] DB read warning:", err.message);
  }

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
    } catch (_) {}
  }

  return res.status(200).json(prices || []);
}
