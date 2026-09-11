import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import {
  mkdtemp,
  copyFile,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
const output = resolve(".vercel/output");
async function host(t, env = {}, sharedPath) {
  const dir = await mkdtemp(join(tmpdir(), "akre-function-test-"));
  const bundle = join(dir, "index.cjs");
  await copyFile(join(output, "functions/api.func/index.cjs"), bundle);
  const cleanEnv = { ...process.env };
  for (const k of [
    "AKRE_MODE",
    "DATABASE_PATH",
    "AKRE_ADMIN_PASSWORD",
    "AKRE_SESSION_SECRET",
    "PUBLIC_ORIGIN",
    "SHOPIFY_SHOP",
    "SHOPIFY_ADMIN_TOKEN",
    "YOUTUBE_API_KEY",
  ])
    delete cleanEnv[k];
  const child = fork(resolve("tests/vercel/serve.mjs"), {
    cwd: dir,
    env: {
      ...cleanEnv,
      AKRE_TEST_OUTPUT: output,
      AKRE_TEST_HANDLER: bundle,
      DATABASE_PATH: sharedPath ?? join(dir, "demo.sqlite"),
      ...env,
    },
    silent: true,
    execArgv: [],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.resume();
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const ready = await Promise.race([
    once(child, "message").then(([m]) => m),
    once(child, "exit").then(() => {
      throw new Error(stderr);
    }),
  ]);
  const base = `http://127.0.0.1:${ready.port}`;
  return {
    base,
    dir,
    child,
    logs: () => stderr,
    request: (path, options) => fetch(base + path, options),
  };
}
async function json(response, status = 200) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type"), /application\/json/);
  return response.json();
}
test("artifact pins Node 24 and contains the entire dependency tree", async () => {
  const config = JSON.parse(
    await readFile(join(output, "functions/api.func/.vc-config.json"), "utf8"),
  );
  assert.equal(config.runtime, "nodejs24.x");
  assert.equal(config.handler, "index.cjs");
  const source = await readFile(
    join(output, "functions/api.func/index.cjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /(?:require\(|from\s+)["']\.\.\/server\//);
});
test("cold/warm/concurrent requests boot real SQLite without provider credentials", async (t) => {
  const h = await host(t);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => h.request("/api/state")),
  );
  for (const r of responses) {
    const s = await json(r);
    assert.equal(s.mode, "DEMO");
    assert.equal(s.data.products.length, 6);
    assert.equal(s.storage.durable, false);
    assert.equal(
      s.integrations.find((i) => i.provider === "Shopify").status,
      "NOT CONFIGURED",
    );
  }
  const health = await json(await h.request("/api/health"));
  assert.equal(health.storage, "ephemeral");
  assert.equal(health.status, "ok");
  await json(await h.request("/api/does-not-exist"), 404);
  const r = await h.request("/api/products/product-1/lifecycle", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lifecycle: "SHORTLISTED" }),
  });
  await json(r);
  assert.equal(
    (await json(await h.request("/api/state"))).data.products.find(
      (p) => p.id === "product-1",
    ).lifecycle,
    "SHORTLISTED",
  );
  await json(
    await h.request("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ECONOMICS_RECALCULATION",
        source: "internal",
        payload: {},
      }),
    }),
    202,
  ).then((j) => assert.equal(j.status, "COMPLETED"));
});
test("API routing never falls through to the SPA; all eight page reloads work", async (t) => {
  const h = await host(t);
  for (const route of [
    "radar",
    "products",
    "suppliers",
    "store",
    "content",
    "experiments",
    "analytics",
    "settings",
  ]) {
    const r = await h.request("/" + route);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
  }
  await json(await h.request("/api"), 404);
  await json(await h.request("/api/missing/deep"), 404);
});
test("authentication and HTTPS origin validation remain enforced", async (t) => {
  const password = "test-only-long-password",
    h = await host(t, {
      AKRE_ADMIN_PASSWORD: password,
      AKRE_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
      PUBLIC_ORIGIN: "https://akre.example",
    });
  await json(await h.request("/api/health"));
  await json(await h.request("/api/state"), 401);
  await json(
    await h.request("/api/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    }),
    403,
  );
  const login = await h.request("/api/login", {
    method: "POST",
    headers: {
      Origin: "https://akre.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  await json(login);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  await json(
    await h.request("/api/state", {
      headers: { Cookie: login.headers.get("set-cookie").split(";")[0] },
    }),
  );
});
test("LIVE and invalid filesystem configuration fail as sanitized JSON, never false health", async (t) => {
  for (const env of [
    { AKRE_MODE: "LIVE" },
    { DATABASE_PATH: resolve("private-secret.sqlite") },
    { AKRE_ADMIN_PASSWORD: "short" },
  ]) {
    const h = await host(t, env);
    const body = await json(await h.request("/api/health"), 503);
    assert.equal(body.error, "AKRE backend unavailable");
    assert.doesNotMatch(
      JSON.stringify(body),
      /private-secret|short|stack|node_modules/,
    );
  }
});
test("database initialization failures are sanitized and retry after repair", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "akre-repair-"));
  const file = join(dir, "demo.sqlite");
  await writeFile(file, "invalid sqlite file");
  const h = await host(t, {}, file);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const failed = await json(await h.request("/api/state"), 503);
  assert.doesNotMatch(
    JSON.stringify(failed),
    new RegExp(dir.replaceAll("\\", "\\\\")),
  );
  await rm(file);
  await json(await h.request("/api/state"));
  assert.match(h.logs(), /akre_api_initialization_failed/);
});
test("independent function instances initialize the same temporary database safely", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "akre-shared-"));
  const file = join(dir, "demo.sqlite");
  const instances = await Promise.all(
    Array.from({ length: 3 }, () => host(t, {}, file)),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Promise.all(
    instances.map(async (h) =>
      assert.equal(
        (await json(await h.request("/api/state"))).data.products.length,
        6,
      ),
    ),
  );
});
