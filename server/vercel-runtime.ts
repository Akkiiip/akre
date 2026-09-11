import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Repository } from "./database";
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

export function createVercelServer(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.AKRE_MODE || "DEMO";
  if (mode !== "DEMO")
    throw new DeploymentConfigurationError(
      mode === "LIVE" ? "DURABLE_BACKEND_REQUIRED" : "INVALID_MODE",
      mode === "LIVE"
        ? "LIVE mode requires a durable backend; this Vercel deployment supports DEMO only."
        : "AKRE_MODE must be DEMO for this deployment.",
    );
  const password = env.AKRE_ADMIN_PASSWORD || undefined;
  const sessionSecret = env.AKRE_SESSION_SECRET || undefined;
  if (
    password &&
    (password.length < 16 || !sessionSecret || sessionSecret.length < 32)
  )
    throw new DeploymentConfigurationError(
      "INVALID_AUTH_CONFIG",
      "Password-protected DEMO requires an admin password of at least 16 characters and a session secret of at least 32 characters.",
    );
  const origin = env.PUBLIC_ORIGIN || undefined;
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin) throw new Error();
    } catch {
      throw new DeploymentConfigurationError(
        "INVALID_ORIGIN",
        "PUBLIC_ORIGIN must be the exact HTTPS application origin without a trailing slash.",
      );
    }
  }
  const databasePath = env.DATABASE_PATH || join(tmpdir(), "akre.sqlite");
  if (databasePath !== ":memory:") {
    const path = relative(resolve(tmpdir()), resolve(databasePath));
    if (
      !path ||
      path === ".." ||
      path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(path)
    )
      throw new DeploymentConfigurationError(
        "INVALID_DEMO_STORAGE",
        "Vercel DEMO storage must be a file inside the temporary directory or :memory:.",
      );
  }
  const repo = new Repository(databasePath, "DEMO");
  try {
    // Providers are intentionally unconfigured in the isolated public demonstration.
    const service = new Service(
      repo,
      new ShopifyProvider({}),
      new YouTubeProvider(),
    );
    const app = createApp(service, {
      password,
      sessionSecret,
      origin,
      serverlessDemo: true,
    });
    return { app, service };
  } catch (error) {
    repo.close();
    throw error;
  }
}
