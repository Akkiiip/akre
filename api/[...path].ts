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
      throw new Error("AKRE_MODE must be DEMO or LIVE");

    // Lazy imports make initialization failures observable through the
    // handler's JSON error response instead of becoming a generic Vercel
    // FUNCTION_INVOCATION_FAILED before the handler can run.
    const [{ Repository }, { Service }, { ShopifyProvider, YouTubeProvider }, { createApp }] =
      await Promise.all([
        import("../server/database"),
        import("../server/service"),
        import("../server/providers"),
        import("../server/app"),
      ]);

    const repo = new Repository(
      process.env.DATABASE_PATH ?? "/tmp/akre.sqlite",
      mode,
    );
    const service = new Service(
      repo,
      new ShopifyProvider({
        shop: process.env.SHOPIFY_SHOP,
        token: process.env.SHOPIFY_ADMIN_TOKEN,
        version: process.env.SHOPIFY_API_VERSION ?? "2026-07",
      }),
      new YouTubeProvider(process.env.YOUTUBE_API_KEY),
    );

    const app = createApp(service, {
      password: process.env.AKRE_ADMIN_PASSWORD,
      sessionSecret: process.env.AKRE_SESSION_SECRET,
      origin: process.env.PUBLIC_ORIGIN,
    });

    return { app, service };
  })();

  try {
    return await globalState.__akreServerPromise;
  } catch (error) {
    // Do not permanently cache a failed cold-start initialization.
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
      });
    } else {
      res.end();
    }
  }
}
