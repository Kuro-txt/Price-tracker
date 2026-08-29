import { getDb, ensureTablesExist } from "./lib/db.js";
import crypto from "crypto";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const db = getDb();
    await ensureTablesExist(db);

    if (req.method === "POST") {
      const { subscription, rules } = req.body || {};

      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: "Invalid subscription payload" });
      }

      const endpoint = subscription.endpoint;
      const p256dh = subscription.keys.p256dh;
      const auth = subscription.keys.auth;
      const subId = crypto.createHash("sha256").update(endpoint).digest("hex").substring(0, 32);

      // Upsert push_subscription
      await db.execute({
        sql: `
          INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(endpoint) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            updated_at = excluded.updated_at;
        `,
        args: [subId, endpoint, p256dh, auth]
      });

      // Clear existing rules for this subscription
      await db.execute({
        sql: `DELETE FROM push_alert_rules WHERE subscription_id = ?;`,
        args: [subId]
      });

      // Insert fresh rules
      if (Array.isArray(rules) && rules.length > 0) {
        for (const rule of rules) {
          const ruleId = rule.id || `rule_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const itemName = rule.item || "*";
          const ruleType = rule.type || "percent";
          const targetValue = parseFloat(rule.value) || 5;

          await db.execute({
            sql: `
              INSERT INTO push_alert_rules (id, subscription_id, item_name, rule_type, target_value)
              VALUES (?, ?, ?, ?, ?);
            `,
            args: [ruleId, subId, itemName, ruleType, targetValue]
          });
        }
      }

      return res.status(200).json({
        success: true,
        subscription_id: subId,
        rules_synced: Array.isArray(rules) ? rules.length : 0
      });
    }

    if (req.method === "DELETE") {
      const { endpoint } = req.body || {};
      if (endpoint) {
        const subRes = await db.execute({
          sql: `SELECT id FROM push_subscriptions WHERE endpoint = ?;`,
          args: [endpoint]
        });
        if (subRes.rows.length > 0) {
          const subId = subRes.rows[0].id;
          await db.execute({ sql: `DELETE FROM push_alert_rules WHERE subscription_id = ?;`, args: [subId] });
          await db.execute({ sql: `DELETE FROM push_subscriptions WHERE id = ?;`, args: [subId] });
        }
      }
      return res.status(200).json({ success: true, message: "Unsubscribed" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[subscribe API] Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
