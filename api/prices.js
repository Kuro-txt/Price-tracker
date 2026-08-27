import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const result = await db.execute("SELECT payload FROM market_cache WHERE key = 'prices' LIMIT 1;");
    
    if (result.rows.length > 0) {
      const data = JSON.parse(result.rows[0].payload);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");
      return res.status(200).json(data);
    }

    return res.status(200).json([]);
  } catch (error) {
    console.error("Prices API Error:", error);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}
