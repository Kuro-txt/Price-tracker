import { getDb } from "./lib/db.js";

function hasFullData(range, rows) {
  if (!rows || rows.length === 0) return false;

  const now = Date.now();
  const oldestTime = new Date(rows[0].recorded_at).getTime();
  if (isNaN(oldestTime)) return false;

  const spanDays = (now - oldestTime) / (1000 * 60 * 60 * 24);

  switch (range) {
    case "7d":
      // Must cover at least 6.5 days AND have at least 140 hourly points
      return spanDays >= 6.5 && rows.length >= 140;

    case "30d":
      // Covers at least 28 days (with >=600 rows) OR spans all the way back to the start of tracking (August 2026)
      if (spanDays >= 28 && rows.length >= 600) return true;
      if (rows.length >= 350 && rows[0].recorded_at <= "2026-08-28T00:00:00Z") return true;
      return false;

    case "90d":
    case "all":
      // Covers requested span OR spans all the way back to the start of tracking (August 2026)
      if (spanDays >= 85 && rows.length >= 75) return true;
      if (rows.length >= 20 && rows[0].recorded_at <= "2026-08-28T00:00:00Z") return true;
      return false;

    default:
      return true;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const item  = req.query.item  || "Sunflower";
  const range = req.query.range || "24h";

  const timeModifiers = {
    "6h":  "-6 hours",  "12h": "-12 hours", "24h": "-24 hours",
    "7d":  "-7 days",   "30d": "-30 days",  "90d": "-90 days",
    "all": "-365 days",
  };
  const timeModifier = timeModifiers[range] ?? "-24 hours";

  // Row limits per table — these tables are already compact, downsampling is rarely needed
  const rangeLimits = {
    "6h": 100, "12h": 150, "24h": 250,   // raw resource_prices
    "7d": 200, "30d": 750,               // price_hourly  (max 168 / 720 rows)
    "90d": 100, "all": 400,              // price_daily   (max 90 / 365 rows)
  };
  const safeLimit = Number(rangeLimits[range]) || 250;

  // Edge CDN caching: longer ranges cached longer to minimise Turso hits
  const cdnCacheSeconds = {
    "6h": 120,   "12h": 180,  "24h": 180,
    "7d": 600,   "30d": 900,
    "90d": 1800, "all": 3600,
  };
  const sMaxAge = cdnCacheSeconds[range] ?? 180;
  res.setHeader("Cache-Control", `s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}`);

  try {
    if (!process.env.TURSO_DATABASE_URL) {
      return res.status(200).json([]);
    }

    const db = getDb();

    // ── Tier routing ──────────────────────────────────────────────────────────
    // 6h / 12h / 24h  → raw resource_prices  (15-min resolution)
    // 7d  / 30d        → price_hourly          (1-hr  resolution)
    // 90d / all        → price_daily           (1-day resolution)
    // ─────────────────────────────────────────────────────────────────────────
    let sql;

    if (range === "7d" || range === "30d") {
      // Hourly rollup table — primary-key seek, zero temp b-trees
      sql = `
        SELECT avg_price AS price,
               hour_at   AS recorded_at
        FROM price_hourly
        WHERE item_name = ? COLLATE NOCASE
          AND hour_at >= datetime('now', ?)
        ORDER BY hour_at ASC
        LIMIT ${safeLimit};
      `;
    } else if (range === "90d" || range === "all") {
      // Daily rollup table — primary-key seek, zero temp b-trees
      sql = `
        SELECT avg_price         AS price,
               day_at || 'T00:00:00Z' AS recorded_at
        FROM price_daily
        WHERE item_name = ? COLLATE NOCASE
          AND day_at >= date('now', ?)
        ORDER BY day_at ASC
        LIMIT ${safeLimit};
      `;
    } else {
      // Raw 15-min snapshots for short ranges (6h / 12h / 24h)
      sql = `
        SELECT price,
               CASE
                 WHEN recorded_at LIKE '%T%Z' THEN recorded_at
                 ELSE strftime('%Y-%m-%dT%H:%M:%SZ', recorded_at)
               END AS recorded_at
        FROM resource_prices
        WHERE item_name = ? COLLATE NOCASE
          AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC
        LIMIT ${safeLimit};
      `;
    }

    let result = await db.execute({ sql, args: [item, timeModifier] });
    let rows = result.rows || [];

    // Fallback: until rollup tables accumulate genuine full history,
    // fallback to raw resource_prices so charts always show complete data.
    const rollupRanges = ["7d", "30d", "90d", "all"];
    const needsFallback = rollupRanges.includes(range) && !hasFullData(range, rows);

    if (needsFallback) {
      const rawLimit = range === "all" ? 5000 : 3500;
      const fallback = await db.execute({
        sql: `
          SELECT price,
                 CASE
                   WHEN recorded_at LIKE '%T%Z' THEN recorded_at
                   ELSE strftime('%Y-%m-%dT%H:%M:%SZ', recorded_at)
                 END AS recorded_at
          FROM resource_prices
          WHERE item_name = ? COLLATE NOCASE
            AND recorded_at >= datetime('now', ?)
          ORDER BY recorded_at ASC
          LIMIT ${rawLimit};
        `,
        args: [item, timeModifier],
      });
      rows = fallback.rows || [];
    }

    // In-memory downsampling — runs in Node.js RAM, zero DB reads.
    // Only kicks in if rows somehow exceed 400 (e.g. during fallback path).
    if (rows.length > 400) {
      const step = Math.ceil(rows.length / 400);
      const sampled = [];
      for (let i = 0; i < rows.length; i += step) {
        sampled.push(rows[i]);
      }
      if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
        sampled.push(rows[rows.length - 1]);
      }
      rows = sampled;
    }

    return res.status(200).json(rows);
  } catch (error) {
    console.error("[history] Error:", error.message);
    return res.status(200).json([]);
  }
}
