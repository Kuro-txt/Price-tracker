import { getDb } from "./lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Edge CDN caching: Vercel serves repeated history requests without querying Turso DB
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");

  const item  = (req.query.item || "Sunflower").trim();
  const range = (req.query.range || "24h").toLowerCase();

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(200).json([]);
    }

    const db = getDb();

    // Query historical rows for this item, sorted chronologically
    let sql = `
      SELECT price, recorded_at
      FROM resource_prices
      WHERE TRIM(item_name) = ? COLLATE NOCASE
    `;
    const args = [item];

    if (range === "6h") {
      sql += ` AND recorded_at >= datetime('now', '-6 hours')`;
    } else if (range === "12h") {
      sql += ` AND recorded_at >= datetime('now', '-12 hours')`;
    } else if (range === "24h") {
      sql += ` AND recorded_at >= datetime('now', '-24 hours')`;
    } else if (range === "7d") {
      sql += ` AND recorded_at >= datetime('now', '-7 days')`;
    } else if (range === "30d") {
      sql += ` AND recorded_at >= datetime('now', '-30 days')`;
    } else if (range === "90d") {
      sql += ` AND recorded_at >= datetime('now', '-90 days')`;
    }
    // "all" has no time filter

    sql += ` ORDER BY recorded_at ASC LIMIT 1000;`;

    let result = await db.execute({ sql, args });

    // Fallback: If time-window query returned 0 rows (e.g. initial setup), fetch last 100 records regardless of time
    if (!result.rows || result.rows.length === 0) {
      result = await db.execute({
        sql: `
          SELECT price, recorded_at
          FROM resource_prices
          WHERE TRIM(item_name) = ? COLLATE NOCASE
          ORDER BY recorded_at DESC
          LIMIT 100;
        `,
        args: [item]
      });

      // Reverse so it is in ascending order for charting
      if (result.rows && result.rows.length > 0) {
        return res.status(200).json(result.rows.reverse());
      }
    }

    return res.status(200).json(result.rows || []);
  } catch (error) {
    console.error("[history] Error:", error.message);
    return res.status(200).json([]);
  }
}
