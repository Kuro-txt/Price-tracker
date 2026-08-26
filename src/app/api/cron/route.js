import { NextResponse } from "next/server";
import { db, initDatabase } from "@/lib/turso";

export const dynamic = "force-dynamic";

export async function GET(request) {
  // Verify secret token
  const authHeader = request.headers.get("authorization");
  const secretParam = new URL(request.url).searchParams.get("secret");
  const isAuthorized = 
    authHeader === `Bearer ${process.env.CRON_SECRET}` || 
    secretParam === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Ensure table exists
    await initDatabase();

    // 2. Fetch live prices from SFL
    const res = await fetch("https://sfl.world/api/v1/prices", { cache: "no-store" });
    if (!res.ok) throw new Error(`SFL API status: ${res.status}`);
    const data = await res.json();

    const timestamp = new Date().toISOString();
    const batch = [];

    // 3. Prepare batch inserts
    if (Array.isArray(data)) {
      data.forEach(item => {
        const name = item.name || item.resource;
        const price = parseFloat(item.price ?? item.sfl ?? 0);
        if (name) {
          batch.push({
            sql: "INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, ?)",
            args: [name, price, timestamp],
          });
        }
      });
    } else {
      Object.entries(data).forEach(([name, val]) => {
        const price = typeof val === "object" ? parseFloat(val.price ?? val.sfl ?? 0) : parseFloat(val);
        batch.push({
          sql: "INSERT INTO resource_prices (item_name, price, recorded_at) VALUES (?, ?, ?)",
          args: [name, price, timestamp],
        });
      });
    }

    // 4. Write to Turso in a single batch
    await db.batch(batch, "write");

    return NextResponse.json({
      success: true,
      recordsInserted: batch.length,
      timestamp,
    });
  } catch (error) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
