import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { PostgresRepository } from "../../server/postgres-repository";
import {
  createVercelServer,
  DeploymentConfigurationError,
} from "../../server/vercel-runtime";

class FakePostgres {
  rows = new Map<
    string,
    { kind: string; id: string; data: unknown; updated_at: string }
  >();
  migrations = new Set<number>();
  workspace = "LIVE";
  queries: string[] = [];
  async connect() {
    return this;
  }
  async end() {}
  async query<T = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    this.queries.push(sql);
    const compact = sql.replace(/\s+/g, " ");
    if (compact.includes("SELECT version FROM schema_migrations"))
      return {
        rows: [
          ...(this.migrations.has(Number(values[0]))
            ? [{ version: values[0] }]
            : []),
        ] as T[],
      };
    if (compact.startsWith("INSERT INTO schema_migrations")) {
      this.migrations.add(Number(values[0]));
      return { rows: [] };
    }
    if (compact.includes("SELECT mode FROM workspaces"))
      return { rows: [{ mode: this.workspace }] as T[] };
    if (compact.startsWith("SELECT kind,id,data,updated_at FROM records"))
      return { rows: [...this.rows.values()] as T[] };
    if (compact.startsWith("INSERT INTO records")) {
      const [id, kind, json, updatedAt] = values as [
        string,
        string,
        string,
        string,
      ];
      this.rows.set(`${kind}\0${id}`, {
        id,
        kind,
        data: JSON.parse(json),
        updated_at: updatedAt,
      });
      return { rows: [] };
    }
    if (compact.startsWith("DELETE FROM records")) {
      this.rows.delete(`${values[0]}\0${values[1]}`);
      return { rows: [] };
    }
    return { rows: [] };
  }
}

it("PostgresRepository bootstraps idempotently and durably commits the shared repository contract", async () => {
  const fake = new FakePostgres(),
    storage = new PostgresRepository(
      "postgres://user:password@db.example/akre",
      fake as never,
    );
  await storage.initialize();
  await storage.initialize();
  expect(fake.migrations).toEqual(new Set([1, 2]));
  const first = await storage.openSession();
  expect(first.repo.mode).toBe("LIVE");
  expect(first.repo.list("products")).toEqual([]);
  first.repo.transaction(() =>
    first.repo.put("products", {
      id: "live-product",
      workspaceId: "default",
      mode: "LIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Real candidate",
      category: "Kitchen",
      identityKey: "real candidate",
      lifecycle: "DISCOVERED",
      supplierIds: [],
    }),
  );
  await first.commit();
  expect(fake.rows.get("products\0live-product")?.kind).toBe("products");
  const second = await storage.openSession();
  expect(second.repo.get("products", "live-product").name).toBe(
    "Real candidate",
  );
  await second.commit();
});
it("PostgresRepository preserves append-only score and audit records before the database trigger", async () => {
  const storage = new PostgresRepository(
      "postgres://user:password@db.example/akre",
      new FakePostgres() as never,
    ),
    session = await storage.openSession();
  const audit = {
    id: "audit-1",
    workspaceId: "default",
    mode: "LIVE" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    actorId: "owner",
    action: "TEST",
    entityId: "x",
    evidence: {},
  };
  session.repo.put("audit", audit);
  await session.commit();
  const later = await storage.openSession();
  expect(() =>
    later.repo.put("audit", { ...audit, evidence: { changed: true } }),
  ).toThrow();
  await later.rollback();
});
it("LIVE configuration fails closed without DATABASE_URL", async () => {
  await expect(
    createVercelServer({
      AKRE_MODE: "LIVE",
      AKRE_ADMIN_PASSWORD: "0123456789abcdef",
      AKRE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      PUBLIC_ORIGIN: "https://akre.example",
    }),
  ).rejects.toMatchObject({
    code: "DATABASE_URL_REQUIRED",
  } satisfies Partial<DeploymentConfigurationError>);
});

it("LIVE boots from a durable PostgreSQL repository and reports only safe storage metadata", async () => {
  const storage = new PostgresRepository(
    "postgres://user:password@db.example/akre",
    new FakePostgres() as never,
  );
  const state = await createVercelServer(
    {
      AKRE_MODE: "LIVE",
      DATABASE_URL: "postgres://user:password@db.example/akre",
      AKRE_ADMIN_PASSWORD: "0123456789abcdef",
      AKRE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      PUBLIC_ORIGIN: "https://akre.example",
    },
    { storage },
  );
  const server = createServer(state.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      mode: "LIVE",
      storage: "postgres",
      durable: true,
    });
    const workspace = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(workspace.status).toBe(401);
    const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: "POST",
      headers: {
        Origin: "https://akre.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "0123456789abcdef" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const job = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: "POST",
      headers: {
        Origin: "https://akre.example",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "ECONOMICS_RECALCULATION",
        source: "internal",
        payload: {},
      }),
    });
    expect(job.status).toBe(202);
    expect(await job.json()).toMatchObject({ status: "COMPLETED" });
    const persisted = await storage.openSession();
    expect(persisted.repo.list("jobs")).toHaveLength(1);
    expect(
      persisted.repo.list("audit").some((a) => a.action === "JOB_COMPLETED"),
    ).toBe(true);
    await persisted.commit();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
