type ServerState = {
  app: (req: any, res: any) => unknown;
  service: import("../server/service").Service;
};

type AkreGlobal = typeof globalThis & {
  __akreServerPromise?: Promise<ServerState>;
};

const globalState = globalThis as AkreGlobal;

async function getServer(): Promise<ServerState> {
  if (globalState.__akreServerPromise) return globalState.__akreServerPromise;

  globalState.__akreServerPromise = (async () => {
    const mode = process.env.AKRE_MODE ?? "DEMO";
    if (mode !== "DEMO" && mode !== "LIVE")
      throw new Error("config: AKRE_MODE must be DEMO or LIVE");

    let Repository: typeof import("../server/database").Repository;
    let Service: typeof import("../server/service").Service;
    let ShopifyProvider: typeof import("../server/providers").ShopifyProvider;
    let YouTubeProvider: typeof import("../server/providers").YouTubeProvider;
    let createApp: typeof import("../server/app").createApp;

    try {
      ({ Repository } = await import("../server/database"));
    } catch (error) {
      throw new Error(`database import: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      ({ Service } = await import("../server/service"));
    } catch (error) {
      throw new Error(`service import: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      ({ ShopifyProvider, YouTubeProvider } = await import("../server/providers"));
    } catch (error) {
      throw new Error(`provider import: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      ({ createApp } = await import("../server/app"));
    } catch (error) {
      throw new Error(`app import: ${error instanceof Error ? error.message : String(error)}`);
    }

    let repo: InstanceType<typeof Repository>;
    try {
      repo = new Repository(
        process.env.DATABASE_PATH ?? "/tmp/akre.sqlite",
        mode,
      );
    } catch (error) {
      throw new Error(`database initialization: ${error instanceof Error ? error.message : String(error)}`);
    }

    const service = new Service(
      repo,
      new ShopifyProvider({
        shop: process.env.SHOPIFY_SHOP,
        token: process.env.SHOPIFY_ADMIN_TOKEN,
        version: process.env.SHOPIFY_API_VERSION ?? "2026-07",
      }),
      new YouTubeProvider(process.env.YOUTUBE_API_KEY),
    );

    let app: ReturnType<typeof createApp>;
    try {
      app = createApp(service, {
        password: process.env.AKRE_ADMIN_PASSWORD,
        sessionSecret: process.env.AKRE_SESSION_SECRET,
        origin: process.env.PUBLIC_ORIGIN,
      });
    } catch (error) {
      throw new Error(`app initialization: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { app, service };
  })();

  try {
    return await globalState.__akreServerPromise;
  } catch (error) {
    globalState.__akreServerPromise = undefined;
    throw error;
  }
}

export default async function handler(req: any, res: any) {
  try {
    const { app } = await getServer();
    return app(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("AKRE API initialization/request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "AKRE backend failed to initialize",
        detail: message,
        runtime: process.version,
      });
    } else {
      res.end();
    }
  }
}
