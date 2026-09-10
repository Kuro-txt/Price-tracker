import { createClient } from "@libsql/client/web";
import * as dotenv from "dotenv";
dotenv.config({ path: "./scratch/sfl-tracker/.env" });

const url = process.env.TURSO_DATABASE_URL?.replace("libsql://", "https://");
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function check() {
  const [hourly, daily, sample7d, sample90d] = await Promise.all([
    db.execute("SELECT COUNT(*) as cnt, MAX(hour_at) as latest FROM price_hourly;"),
    db.execute("SELECT COUNT(*) as cnt, MAX(day_at) as latest FROM price_daily;"),
    db.execute(`
      SELECT avg_price AS price, hour_at AS recorded_at
      FROM price_hourly
      WHERE item_name = 'Sunflower' COLLATE NOCASE
        AND hour_at >= datetime('now', '-7 days')
      ORDER BY hour_at ASC LIMIT 5;
    `),
    db.execute(`
      SELECT avg_price AS price, day_at AS recorded_at
      FROM price_daily
      WHERE item_name = 'Sunflower' COLLATE NOCASE
        AND day_at >= date('now', '-90 days')
      ORDER BY day_at ASC LIMIT 5;
    `),
  ]);

  console.log("\n=== price_hourly ===");
  console.log(`  Rows: ${hourly.rows[0].cnt}, Latest hour: ${hourly.rows[0].latest}`);

  console.log("\n=== price_daily ===");
  console.log(`  Rows: ${daily.rows[0].cnt}, Latest day: ${daily.rows[0].latest}`);

  console.log("\n=== Sunflower 7D sample (from price_hourly) ===");
  if (sample7d.rows.length === 0) {
    console.log("  ⚠️  No rows yet — cron hasn't run since deploy, or tables still empty.");
  } else {
    sample7d.rows.forEach(r => console.log(`  ${r.recorded_at}  →  ${r.price}`));
  }

  console.log("\n=== Sunflower 90D sample (from price_daily) ===");
  if (sample90d.rows.length === 0) {
    console.log("  ⚠️  No rows yet — cron hasn't run since deploy.");
  } else {
    sample90d.rows.forEach(r => console.log(`  ${r.recorded_at}  →  ${r.price}`));
  }
}

check().catch(console.error);
