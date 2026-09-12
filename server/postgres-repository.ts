import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import type { DataMode, Dataset } from "../shared/domain";
import { emptyDataset } from "./seed";
import { Repository } from "./database";
import { datasetKinds, type RepositoryContract } from "./repository";

neonConfig.webSocketConstructor = ws;

type Queryable = {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  release?: () => void;
};
type PoolLike = Queryable & {
  connect(): Promise<Queryable>;
  end?: () => Promise<void>;
};
type RecordRow = {
  kind: keyof Dataset;
  id: string;
  data: unknown;
  updated_at: string | Date;
};

const MIGRATIONS = [
  {
    version: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, mode text NOT NULL CHECK (mode IN ('DEMO','LIVE')), created_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id text NOT NULL, workspace_id text NOT NULL REFERENCES workspaces(id), kind text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL, PRIMARY KEY (workspace_id, kind, id));
    CREATE INDEX IF NOT EXISTS records_workspace_kind_updated ON records(workspace_id, kind, updated_at, id);
  `,
  },
  {
    version: 2,
    sql: `
    CREATE OR REPLACE FUNCTION akre_preserve_evidence() RETURNS trigger AS $$
    BEGIN
      IF OLD.kind IN ('scoreHistory','audit') THEN RAISE EXCEPTION 'Historical evidence is append-only'; END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS immutable_evidence_update ON records;
    DROP TRIGGER IF EXISTS immutable_evidence_delete ON records;
    CREATE TRIGGER immutable_evidence_update BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION akre_preserve_evidence();
    CREATE TRIGGER immutable_evidence_delete BEFORE DELETE ON records FOR EACH ROW EXECUTE FUNCTION akre_preserve_evidence();
  `,
  },
  {
    version: 3,
    sql: `
    CREATE INDEX IF NOT EXISTS records_intelligence_history ON records(workspace_id, kind, updated_at DESC) WHERE kind IN ('opportunities','scoreHistory');
  `,
  },
];

function copyDataset(dataset: Dataset): Dataset {
  return structuredClone(dataset);
}
function key(kind: string, id: string) {
  return `${kind}\u0000${id}`;
}

/**
 * Durable PostgreSQL storage. It deliberately preserves AKRE's compact JSON-record
 * model while the existing synchronous domain engine runs against a request-scoped
 * in-memory SQLite copy. Reads, conflict serialization and writes occur in one
 * real PostgreSQL transaction and no LIVE data is written to the filesystem.
 */
export class PostgresRepository {
  readonly mode: DataMode = "LIVE";
  private initialized?: Promise<void>;
  constructor(
    private databaseUrl: string,
    private pool: PoolLike = new Pool({ connectionString: databaseUrl }),
  ) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl))
      throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  async initialize() {
    this.initialized ??= this.bootstrap();
    return this.initialized;
  }
  private async bootstrap() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "akre-schema-v1",
      ]);
      // Migration 1 creates schema_migrations itself, so it must precede lookup.
      await client.query(MIGRATIONS[0].sql);
      for (const migration of MIGRATIONS) {
        const seen = await client.query<{ version: number }>(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [migration.version],
        );
        if (!seen.rows.length) {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO schema_migrations(version) VALUES($1)",
            [migration.version],
          );
        }
      }
      await client.query(
        "INSERT INTO workspaces(id,mode,created_at) VALUES('default','LIVE',now()) ON CONFLICT (id) DO NOTHING",
      );
      const workspace = await client.query<{ mode: string }>(
        "SELECT mode FROM workspaces WHERE id='default'",
      );
      if (workspace.rows[0]?.mode !== "LIVE")
        throw new Error(
          "Database workspace mode mismatch. LIVE requires its own DATABASE_URL.",
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      this.initialized = undefined;
      throw error;
    } finally {
      client.release?.();
    }
  }
  async openSession(): Promise<PostgresSession> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "akre-workspace-default",
      ]);
      const rows = await client.query<RecordRow>(
        "SELECT kind,id,data,updated_at FROM records WHERE workspace_id='default' ORDER BY updated_at,id",
      );
      const before = emptyDataset();
      for (const row of rows.rows) {
        if (datasetKinds.includes(row.kind))
          (before[row.kind] as unknown[]).push(row.data);
      }
      const local = new Repository(":memory:", "LIVE");
      for (const kind of datasetKinds)
        for (const entity of before[kind]) local.put(kind, entity);
      return new PostgresSession(client, local, before);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release?.();
      throw error;
    }
  }
  async close() {
    await this.pool.end?.();
  }
}

export class PostgresSession {
  private complete = false;
  constructor(
    private client: Queryable,
    readonly repo: RepositoryContract,
    private before: Dataset,
  ) {}
  async commit() {
    if (this.complete) return;
    const after = this.repo.snapshot();
    try {
      const previous = new Map<string, unknown>();
      const next = new Map<string, unknown>();
      for (const kind of datasetKinds) {
        for (const item of this.before[kind])
          previous.set(key(kind, item.id), item);
        for (const item of after[kind]) next.set(key(kind, item.id), item);
      }
      for (const [recordKey, prior] of previous) {
        const current = next.get(recordKey);
        const [kind, id] = recordKey.split("\u0000") as [keyof Dataset, string];
        if (current === undefined) {
          if (kind === "audit" || kind === "scoreHistory")
            throw new Error("Historical evidence is append-only");
          await this.client.query(
            "DELETE FROM records WHERE workspace_id='default' AND kind=$1 AND id=$2",
            [kind, id],
          );
        } else if (JSON.stringify(prior) !== JSON.stringify(current)) {
          if (kind === "audit" || kind === "scoreHistory")
            throw new Error("Historical evidence is append-only");
          await this.write(kind, current as Dataset[typeof kind][number]);
        }
      }
      for (const [recordKey, current] of next)
        if (!previous.has(recordKey)) {
          const [kind] = recordKey.split("\u0000") as [keyof Dataset, string];
          await this.write(kind, current as Dataset[typeof kind][number]);
        }
      await this.client.query("COMMIT");
      this.complete = true;
    } catch (error) {
      await this.rollback();
      throw error;
    } finally {
      this.repo.close();
      this.client.release?.();
    }
  }
  private async write(
    kind: keyof Dataset,
    entity: { id: string; updatedAt: string },
  ) {
    await this.client.query(
      "INSERT INTO records(id,workspace_id,kind,data,updated_at) VALUES($1,'default',$2,$3::jsonb,$4::timestamptz) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      [entity.id, kind, JSON.stringify(entity), entity.updatedAt],
    );
  }
  async rollback() {
    if (this.complete) return;
    this.complete = true;
    await this.client.query("ROLLBACK").catch(() => undefined);
    this.repo.close();
    this.client.release?.();
  }
}
