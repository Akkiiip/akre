import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Repository } from "./database";
import { PostgresRepository } from "./postgres-repository";
import { Service } from "./service";
import { ShopifyProvider, YouTubeProvider } from "./providers";
import { createApp } from "./app";

export class DeploymentConfigurationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
type AppHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;
function appConfig(env: NodeJS.ProcessEnv, live: boolean) {
  const password = env.AKRE_ADMIN_PASSWORD || undefined,
    sessionSecret = env.AKRE_SESSION_SECRET || undefined,
    origin = env.PUBLIC_ORIGIN || undefined;
  if (
    live &&
    (!password ||
      password.length < 16 ||
      !sessionSecret ||
      sessionSecret.length < 32 ||
      !origin)
  )
    throw new DeploymentConfigurationError(
      "INVALID_AUTH_CONFIG",
      "LIVE requires AKRE_ADMIN_PASSWORD (16+), AKRE_SESSION_SECRET (32+) and exact HTTPS PUBLIC_ORIGIN.",
    );
  if (
    password &&
    (password.length < 16 || !sessionSecret || sessionSecret.length < 32)
  )
    throw new DeploymentConfigurationError(
      "INVALID_AUTH_CONFIG",
      "Password protection requires an admin password of at least 16 characters and a session secret of at least 32 characters.",
    );
  if (origin)
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin) throw new Error();
    } catch {
      throw new DeploymentConfigurationError(
        "INVALID_ORIGIN",
        "PUBLIC_ORIGIN must be the exact HTTPS application origin without a trailing slash.",
      );
    }
  return { password, sessionSecret, origin };
}
function makeProviders(env: NodeJS.ProcessEnv, demo: boolean) {
  return [
    new ShopifyProvider(
      demo
        ? {}
        : {
            shop: env.SHOPIFY_SHOP,
            token: env.SHOPIFY_ADMIN_TOKEN,
            version: env.SHOPIFY_API_VERSION ?? "2026-07",
          },
    ),
    new YouTubeProvider(demo ? undefined : env.YOUTUBE_API_KEY),
  ] as const;
}
function demoPath(env: NodeJS.ProcessEnv) {
  const path = env.DATABASE_PATH || join(tmpdir(), "akre.sqlite");
  if (path !== ":memory:") {
    const r = relative(resolve(tmpdir()), resolve(path));
    if (
      !r ||
      r === ".." ||
      r.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
      isAbsolute(r)
    )
      throw new DeploymentConfigurationError(
        "INVALID_DEMO_STORAGE",
        "Vercel DEMO storage must be a file inside the temporary directory or :memory:.",
      );
  }
  return path;
}
function unavailable(res: ServerResponse, error: unknown) {
  const code =
    error instanceof DeploymentConfigurationError
      ? error.code
      : "INITIALIZATION_FAILED";
  console.error(
    JSON.stringify({
      event: "akre_api_initialization_failed",
      code,
      node: process.version,
    }),
  );
  if (!res.headersSent) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: "AKRE backend unavailable",
        code,
        detail:
          error instanceof DeploymentConfigurationError
            ? error.message
            : "Backend initialization failed. Check server logs using the error code.",
      }),
    );
  } else res.end();
}
function liveHandler(
  storage: PostgresRepository,
  env: NodeJS.ProcessEnv,
  config: ReturnType<typeof appConfig>,
): AppHandler {
  return async (req, res) => {
    let session:
      Awaited<ReturnType<PostgresRepository["openSession"]>> | undefined;
    try {
      session = await storage.openSession();
      const [shopify, youtube] = makeProviders(env, false);
      const service = new Service(session.repo, shopify, youtube);
      const app = createApp(service, {
        ...config,
        serverlessLive: true,
        executeJobsInline: true,
      });
      const originalEnd = res.end.bind(res);
      let finishing = false;
      res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
        if (finishing) return res;
        finishing = true;
        void session!
          .commit()
          .then(() =>
            originalEnd(chunk as never, encoding as never, callback as never),
          )
          .catch((error) => {
            console.error(
              JSON.stringify({
                event: "akre_postgres_commit_failed",
                type: error instanceof Error ? error.name : "UnknownError",
              }),
            );
            if (!res.headersSent) unavailable(res, error);
            else {
              res.statusCode = 500;
              originalEnd(
                JSON.stringify({ error: "AKRE durable storage commit failed" }),
              );
            }
          });
        return res;
      }) as typeof res.end;
      app(req, res);
    } catch (error) {
      await session?.rollback();
      unavailable(res, error);
    }
  };
}
export async function createVercelServer(
  env: NodeJS.ProcessEnv = process.env,
  dependencies?: { storage?: PostgresRepository },
): Promise<{ app: AppHandler }> {
  const mode = env.AKRE_MODE || "DEMO";
  if (mode !== "DEMO" && mode !== "LIVE")
    throw new DeploymentConfigurationError(
      "INVALID_MODE",
      "AKRE_MODE must be DEMO or LIVE.",
    );
  const live = mode === "LIVE",
    config = appConfig(env, live);
  if (!live) {
    const repo = new Repository(demoPath(env), "DEMO"),
      [shopify, youtube] = makeProviders(env, true);
    return {
      app: createApp(new Service(repo, shopify, youtube), {
        ...config,
        serverlessDemo: true,
        executeJobsInline: true,
      }),
    };
  }
  if (!env.DATABASE_URL)
    throw new DeploymentConfigurationError(
      "DATABASE_URL_REQUIRED",
      "LIVE requires DATABASE_URL. AKRE will not fall back to SQLite or /tmp.",
    );
  const storage =
    dependencies?.storage ?? new PostgresRepository(env.DATABASE_URL);
  await storage.initialize();
  return { app: liveHandler(storage, env, config) };
}
