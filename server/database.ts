import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Dataset, DataMode, Entity } from "../shared/domain";
import { emptyDataset, seed } from "./seed";
import { migrateIdentityAndScores } from "./migrate";
import type { RepositoryContract } from "./repository";

const startupPause = (ms: number) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const busy = (error: unknown) =>
  error instanceof Error &&
  /SQLITE_BUSY|database is locked/i.test(error.message);
export class SqliteRepository implements RepositoryContract {
  db!: DatabaseSync;
  constructor(
    path: string,
    public mode: DataMode,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    let last: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      this.db = new DatabaseSync(path);
      try {
        this.initialize();
        return;
      } catch (error) {
        last = error;
        this.db.close();
        if (!busy(error) || attempt === 9) throw error;
        startupPause(25 * (attempt + 1));
      }
    }
    throw last;
  }
  private initialize() {
    this.db
      .exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('DEMO','LIVE')), created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,kind,id));
      CREATE INDEX IF NOT EXISTS records_kind ON records(workspace_id,kind,updated_at);
      INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));`);
    this.transaction(() => {
      const existing = this.db
        .prepare("SELECT mode FROM workspaces WHERE id=?")
        .get("default") as { mode: string } | undefined;
      if (existing && existing.mode !== this.mode)
        throw new Error(
          "Database mode mismatch. Use a separate DATABASE_PATH for LIVE and DEMO.",
        );
      if (!existing) {
        this.db
          .prepare("INSERT INTO workspaces VALUES(?,?,?)")
          .run("default", this.mode, new Date().toISOString());
        const dataset = seed(this.mode);
        for (const kind of Object.keys(dataset) as (keyof Dataset)[])
          for (const entity of dataset[kind]) this.put(kind, entity);
      }
    });
    migrateIdentityAndScores(this);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  list<K extends keyof Dataset>(kind: K): Dataset[K] {
    return this.db
      .prepare(
        "SELECT data FROM records WHERE workspace_id=? AND kind=? ORDER BY updated_at,id",
      )
      .all("default", kind)
      .map((row) => JSON.parse(String(row.data))) as Dataset[K];
  }
  get<K extends keyof Dataset>(kind: K, id: string): Dataset[K][number] {
    const row = this.db
      .prepare(
        "SELECT data FROM records WHERE workspace_id=? AND kind=? AND id=?",
      )
      .get("default", kind, id);
    if (!row) throw new Error(`${kind} record not found`);
    return JSON.parse(String(row.data)) as Dataset[K][number];
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
    const dataset = emptyDataset();
    for (const kind of Object.keys(dataset) as (keyof Dataset)[])
      Object.assign(dataset, { [kind]: this.list(kind) });
    return dataset;
  }
  close() {
    this.db.close();
  }
}
export { SqliteRepository as Repository };
