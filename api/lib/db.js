function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  let u = rawUrl.trim().replace(/^libsql:\/\//i, "https://");
  if (!u.startsWith("http")) u = "https://" + u;
  return u.replace(/\/$/, "");
}

export class DirectTursoClient {
  constructor(url, token) {
    this.baseUrl = normalizeUrl(url);
    this.token = (token || "").trim();
  }

  async execute(stmtOrSql) {
    let sql = "";
    let args = [];

    if (typeof stmtOrSql === "string") {
      sql = stmtOrSql;
    } else if (stmtOrSql && typeof stmtOrSql === "object") {
      sql = stmtOrSql.sql || "";
      args = stmtOrSql.args || [];
    }

    const typedArgs = args.map(arg => {
      if (arg === null || arg === undefined) return { type: "null" };
      if (typeof arg === "number") {
        return Number.isInteger(arg) ? { type: "integer", value: String(arg) } : { type: "float", value: arg };
      }
      return { type: "text", value: String(arg) };
    });

    const pipelineUrl = `${this.baseUrl}/v2/pipeline`;
    const res = await fetch(pipelineUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          { type: "execute", stmt: { sql, args: typedArgs } },
          { type: "close" }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Turso HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const resultItem = data.results && data.results[0];
    if (resultItem && resultItem.type === "error") {
      throw new Error(resultItem.error.message);
    }

    const result = resultItem && resultItem.response && resultItem.response.result;
    if (!result) return { rows: [] };

    const cols = (result.cols || []).map(c => c.name);
    const rows = (result.rows || []).map(row => {
      const obj = {};
      row.forEach((cell, i) => {
        obj[cols[i]] = (cell && cell.value !== undefined) ? cell.value : null;
      });
      return obj;
    });

    return { rows };
  }

  async batch(stmts) {
    const requests = stmts.map(s => {
      const sql = typeof s === "string" ? s : s.sql;
      const args = (typeof s === "object" && s.args) || [];
      const typedArgs = args.map(arg => {
        if (arg === null || arg === undefined) return { type: "null" };
        if (typeof arg === "number") {
          return Number.isInteger(arg) ? { type: "integer", value: String(arg) } : { type: "float", value: arg };
        }
        return { type: "text", value: String(arg) };
      });
      return { type: "execute", stmt: { sql, args: typedArgs } };
    });
    requests.push({ type: "close" });

    const pipelineUrl = `${this.baseUrl}/v2/pipeline`;
    const res = await fetch(pipelineUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Turso HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return (data.results || []).filter(r => r.type === "ok").map(r => {
      const result = r.response && r.response.result;
      if (!result) return { rows: [] };
      const cols = (result.cols || []).map(c => c.name);
      return {
        rows: (result.rows || []).map(row => {
          const obj = {};
          row.forEach((cell, i) => {
            obj[cols[i]] = (cell && cell.value !== undefined) ? cell.value : null;
          });
          return obj;
        })
      };
    });
  }
}

let dbInstance = null;

export function getDb() {
  const rawUrl = process.env.TURSO_DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Missing environment variable: TURSO_DATABASE_URL");
  }

  if (!dbInstance) {
    dbInstance = new DirectTursoClient(rawUrl, process.env.TURSO_AUTH_TOKEN);
  }

  return dbInstance;
}

export async function ensureTablesExist(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS resource_prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name   TEXT    NOT NULL,
      price       REAL    NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS market_cache (
      key        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_item_time_nocase ON resource_prices(item_name COLLATE NOCASE, recorded_at ASC);
  `);
}
