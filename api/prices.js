import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const query = `
      SELECT item_name AS name, price, recorded_at
      FROM resource_prices
      WHERE rowid IN (
        SELECT MAX(rowid)
        FROM resource_prices
        GROUP BY LOWER(item_name)
      )
      ORDER BY item_name ASC;
    `;

    const result = await db.execute(query);
    const prices = result.rows.map(row => ({
      name: row.name,
      price: parseFloat(row.price)
    }));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate");
    return res.status(200).json(prices);
  } catch (error) {
    console.error("Prices API Error:", error);
    return res.status(500).json({ error: error.message, prices: [] });
  }
}
