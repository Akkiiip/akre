import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Dataset, DataMode, Entity } from "../shared/domain";
import { emptyDataset, seed } from "./seed";
import { migrateIdentityAndScores } from "./migrate";
export class Repository {
  db: DatabaseSync;
  constructor(
    path: string,
    public mode: DataMode,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')), created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS records(id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,kind,id));
   CREATE INDEX IF NOT EXISTS records_kind ON records(workspace_id,kind,updated_at);
   INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));`);
    const existing = this.db
      .prepare("SELECT mode FROM workspaces WHERE id=?")
      .get("default");
    if (existing && existing.mode !== mode)
      throw new Error(
        "Database mode mismatch. Use a separate DATABASE_PATH for LIVE and DEMO.",
      );
    if (!existing)
      this.transaction(() => {
        this.db
          .prepare("INSERT INTO workspaces VALUES(?,?,?)")
          .run("default", mode, new Date().toISOString());
        const d = seed(mode);
        for (const kind of Object.keys(d) as (keyof Dataset)[])
          for (const entity of d[kind]) this.put(kind, entity);
      });
    migrateIdentityAndScores(this);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  list<K extends keyof Dataset>(kind: K): Dataset[K] {
    return this.db
      .prepare(
        "SELECT data FROM records WHERE workspace_id=? AND kind=? ORDER BY updated_at,id",
      )
      .all("default", kind)
      .map((r) => JSON.parse(String(r.data))) as Dataset[K];
  }
  get<K extends keyof Dataset>(kind: K, id: string): Dataset[K][number] {
    const row = this.db
      .prepare(
        "SELECT data FROM records WHERE workspace_id=? AND kind=? AND id=?",
      )
      .get("default", kind, id);
    if (!row) throw new Error(`${kind} record not found`);
    return JSON.parse(String(row.data));
  }
  put<K extends keyof Dataset>(kind: K, entity: Dataset[K][number]) {
    if (entity.workspaceId !== "default" || entity.mode !== this.mode)
      throw new Error("Workspace or mode mismatch");
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      )
      .run(
        entity.id,
        entity.workspaceId,
        kind,
        JSON.stringify(entity),
        entity.updatedAt,
      );
  }
  snapshot(): Dataset {
    const d = emptyDataset();
    for (const k of Object.keys(d) as (keyof Dataset)[])
      Object.assign(d, { [k]: this.list(k) });
    return d;
  }
  close() {
    this.db.close();
  }
}
