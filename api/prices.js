import { getDb } from "./lib/db.js";
import { fetchLiveMarketPrices } from "./lib/collectibles.js";

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
      prices = await fetchLiveMarketPrices();
    } catch (_) {}
  }

  // Support Discord bot / specific item query: /api/prices?item=truffle
  const itemQuery = req.query?.item ? String(req.query.item).trim() : null;
  if (itemQuery) {
    const q = itemQuery.toLowerCase();
    const exact = prices.find(p => p.name.toLowerCase() === q);
    if (exact) {
      return res.status(200).json(exact);
    }
    const matching = prices.filter(p => p.name.toLowerCase().includes(q));
    if (matching.length === 1) {
      return res.status(200).json(matching[0]);
    }
    if (matching.length > 1) {
      return res.status(200).json({ query: itemQuery, count: matching.length, matches: matching });
    }
    return res.status(404).json({ error: `Item '${itemQuery}' not found`, count: 0, available: prices.map(p => p.name) });
  }

  return res.status(200).json(prices || []);
}
