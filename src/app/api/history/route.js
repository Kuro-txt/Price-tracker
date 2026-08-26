import { NextResponse } from "next/server";
import { db, initDatabase } from "@/lib/turso";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await initDatabase();
    const { searchParams } = new URL(request.url);
    const item = searchParams.get("item");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    if (item) {
      // Query specific item history
      const result = await db.execute({
        sql: `SELECT item_name, price, recorded_at 
              FROM resource_prices 
              WHERE LOWER(item_name) = LOWER(?) 
              ORDER BY recorded_at ASC 
              LIMIT ?`,
        args: [item, limit],
      });
      return NextResponse.json(result.rows);
    }

    // Default: Get the latest price snapshot for all unique items
    const result = await db.execute(`
      SELECT item_name, price, recorded_at
      FROM resource_prices
      WHERE id IN (
        SELECT MAX(id) FROM resource_prices GROUP BY item_name
      )
      ORDER BY item_name ASC
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
