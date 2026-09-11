import { Repository } from "../server/database";
import { Service } from "../server/service";
import { ShopifyProvider, YouTubeProvider } from "../server/providers";
import { createApp } from "../server/app";

type ServerState = {
  app: ReturnType<typeof createApp>;
  service: Service;
};

const globalState = globalThis as typeof globalThis & {
  __akreServer?: ServerState;
};

function getServer(): ServerState {
  if (globalState.__akreServer) return globalState.__akreServer;

  const mode = process.env.AKRE_MODE ?? "DEMO";
  if (mode !== "DEMO" && mode !== "LIVE")
    throw new Error("AKRE_MODE must be DEMO or LIVE");

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

  globalState.__akreServer = { app, service };
  return globalState.__akreServer;
}

export default async function handler(req: any, res: any) {
  try {
    const { app } = getServer();
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
