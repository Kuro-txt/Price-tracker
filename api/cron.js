import { getDb, ensureTablesExist } from "./lib/db.js";

const DEFAULT_VAPID_PUBLIC = "BGTWgsnm27jVc2pRAODjCmromFVEVV0wKuIarpdyRiTz8na-WO1ugBEBUuT-C1v3sBvMVsY7PGE1wRqQTEMULdw";
const DEFAULT_VAPID_PRIVATE = "e9yw9CYkfZZBFeMBy8MuBXzLI9V7pqaQILWc3yWHuX0";
const DEFAULT_VAPID_SUBJECT = "mailto:admin@sunchart.app";

export default async function handler(req, res) {
  try {
    const db = getDb();
    await ensureTablesExist(db);

    // 1. Fetch live prices from sfl.world
    const response = await fetch("https://sfl.world/api/v1/prices");
    if (!response.ok) {
      throw new Error(`SFL API responded with status ${response.status}`);
    }
    const data = await response.json();
    const pricesArray = Array.isArray(data) ? data : (data.prices || data.data || []);

    if (!Array.isArray(pricesArray) || pricesArray.length === 0) {
      return res.status(200).json({ message: "No prices returned from source." });
    }

    // 2. Batch insert new prices
    const batchStatements = pricesArray
      .filter(item => item && (item.name || item.item_name) && item.price !== undefined)
      .map(item => ({
        sql: `INSERT INTO resource_prices (item_name, price, recorded_at)
              VALUES (?, ?, datetime('now'));`,
        args: [item.name || item.item_name, parseFloat(item.price)],
      }));

    if (batchStatements.length > 0) {
      await db.batch(batchStatements, "write");
    }

    // 3. Update market_cache with latest prices
    const latestPrices = pricesArray.map(item => ({
      name: item.name || item.item_name,
      price: parseFloat(item.price)
    }));

    await db.execute({
      sql: `INSERT INTO market_cache (key, payload, updated_at)
            VALUES ('prices', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
              SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(latestPrices)],
    });

    // 4. Compute and cache 12H Movers
    const moversRes = await db.execute(`
      WITH Latest AS (
        SELECT rp.item_name, rp.price AS current_price
        FROM resource_prices rp
        JOIN (
          SELECT item_name, MAX(recorded_at) AS max_at
          FROM resource_prices
          WHERE recorded_at >= datetime('now', '-6 hours')
          GROUP BY item_name
        ) m ON rp.item_name = m.item_name AND rp.recorded_at = m.max_at
      ),
      Past AS (
        SELECT rp.item_name, rp.price AS past_price
        FROM resource_prices rp
        JOIN (
          SELECT item_name, MIN(recorded_at) AS min_at
          FROM resource_prices
          WHERE recorded_at >= datetime('now', '-14 hours')
          GROUP BY item_name
        ) m ON rp.item_name = m.item_name AND rp.recorded_at = m.min_at
      )
      SELECT
        l.item_name,
        l.current_price,
        p.past_price,
        ROUND(((l.current_price - p.past_price) / p.past_price) * 100, 2) AS change_pct,
        ROUND(l.current_price - p.past_price, 6) AS change_amt
      FROM Latest l
      JOIN Past p ON LOWER(l.item_name) = LOWER(p.item_name)
      WHERE p.past_price > 0
      ORDER BY change_pct DESC;
    `);

    const gainers = [];
    const losers  = [];
    const changesMap = {};

    moversRes.rows.forEach(row => {
      const item = {
        name: row.item_name,
        price: parseFloat(row.current_price),
        pastPrice: parseFloat(row.past_price),
        changePct: parseFloat(row.change_pct),
        changeAmt: parseFloat(row.change_amt),
      };
      changesMap[row.item_name.toLowerCase()] = item;
      if (item.changePct > 0) gainers.push(item);
      else if (item.changePct < 0) losers.push(item);
    });
    losers.sort((a, b) => a.changePct - b.changePct);

    const moversPayload = { gainers, losers, changesMap };

    await db.execute({
      sql: `INSERT INTO market_cache (key, payload, updated_at)
            VALUES ('movers', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
              SET payload = excluded.payload, updated_at = excluded.updated_at;`,
      args: [JSON.stringify(moversPayload)],
    });

    // 5. Evaluate and Send Server-Side Web Push Notifications
    let pushResult = { sent: 0, failed: 0 };
    try {
      pushResult = await evaluateAndSendPushNotifications(db, latestPrices, changesMap);
    } catch (pushErr) {
      console.error("[cron push] Error evaluating push notifications:", pushErr);
    }

    return res.status(200).json({
      success: true,
      inserted: batchStatements.length,
      gainers: gainers.length,
      losers: losers.length,
      push_notifications: pushResult
    });

  } catch (error) {
    console.error("[cron] Error:", error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}

async function evaluateAndSendPushNotifications(db, pricesList, changesMap) {
  const rulesRes = await db.execute(`
    SELECT r.id AS rule_id, r.subscription_id, r.item_name, r.rule_type, r.target_value, r.last_triggered_at,
           s.endpoint, s.p256dh, s.auth
    FROM push_alert_rules r
    JOIN push_subscriptions s ON r.subscription_id = s.id;
  `);

  if (!rulesRes.rows || rulesRes.rows.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let webpush;
  try {
    const wpModule = await import("web-push");
    webpush = wpModule.default || wpModule;
    const publicKey = process.env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC;
    const privateKey = process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE;
    const subject = process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT;
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    console.error("[cron webpush init] web-push module failed to load:", err);
    return { sent: 0, failed: 0, error: "web-push init failed" };
  }

  const pricesMap = {};
  pricesList.forEach(p => { pricesMap[p.name.toLowerCase()] = p.price; });

  let sentCount = 0;
  let failedCount = 0;
  const triggeredRuleIds = [];

  for (const rule of rulesRes.rows) {
    const targetItems = rule.item_name === "*"
      ? pricesList.map(p => p.name)
      : [rule.item_name];

    for (const itemName of targetItems) {
      const lowerName = itemName.toLowerCase();
      const currentPrice = pricesMap[lowerName];
      const mover = changesMap[lowerName];

      if (currentPrice === undefined) continue;

      let triggered = false;
      let title = "";
      let body = "";

      if (rule.rule_type === "percent" && mover && typeof mover.changePct === "number") {
        const threshold = parseFloat(rule.target_value) || 5;
        if (Math.abs(mover.changePct) >= threshold) {
          triggered = true;
          const sign = mover.changePct >= 0 ? "+" : "";
          title = `${mover.changePct >= 0 ? "🚀 Surging" : "📉 Dipping"}: ${itemName}`;
          body = `Moved ${sign}${mover.changePct.toFixed(1)}% (12H) · Now ${currentPrice.toFixed(4).replace(/\\.?0+$/, '')} SFL`;
        }
      } else if (rule.rule_type === "above") {
        const targetVal = parseFloat(rule.target_value);
        if (!isNaN(targetVal) && currentPrice >= targetVal) {
          triggered = true;
          title = `🎯 Target Reached: ${itemName}`;
          body = `Price reached ${currentPrice.toFixed(4).replace(/\\.?0+$/, '')} SFL (Target: ≥ ${targetVal})`;
        }
      } else if (rule.rule_type === "below") {
        const targetVal = parseFloat(rule.target_value);
        if (!isNaN(targetVal) && currentPrice <= targetVal) {
          triggered = true;
          title = `⚠️ Price Drop: ${itemName}`;
          body = `Price fell to ${currentPrice.toFixed(4).replace(/\\.?0+$/, '')} SFL (Target: ≤ ${targetVal})`;
        }
      }

      if (triggered) {
        // Cooldown check (only alert every 4 hours per rule unless price moved further)
        const lastTriggered = rule.last_triggered_at ? new Date(rule.last_triggered_at) : null;
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        if (lastTriggered && lastTriggered > fourHoursAgo) {
          continue;
        }

        const pushSubscription = {
          endpoint: rule.endpoint,
          keys: {
            p256dh: rule.p256dh,
            auth: rule.auth
          }
        };

        const payload = JSON.stringify({
          title: title,
          body: body,
          icon: "https://sfl.world/favicon.ico"
        });

        try {
          await webpush.sendNotification(pushSubscription, payload);
          sentCount++;
          triggeredRuleIds.push(rule.rule_id);
        } catch (sendErr) {
          failedCount++;
          // If subscription is expired/unregistered (404/410), clean it up
          if (sendErr.statusCode === 404 || sendErr.statusCode === 410) {
            await db.execute({
              sql: `DELETE FROM push_subscriptions WHERE id = ?;`,
              args: [rule.subscription_id]
            });
          }
        }
      }
    }
  }

  // Update last_triggered_at for all triggered rules
  if (triggeredRuleIds.length > 0) {
    for (const rid of triggeredRuleIds) {
      await db.execute({
        sql: `UPDATE push_alert_rules SET last_triggered_at = datetime('now') WHERE id = ?;`,
        args: [rid]
      });
    }
  }

  return { sent: sentCount, failed: failedCount };
}
