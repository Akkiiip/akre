import { Repository } from "../server/database";
import { Service } from "../server/service";
import { ShopifyProvider, YouTubeProvider } from "../server/providers";
import { createApp } from "../server/app";

const mode = process.env.AKRE_MODE ?? "DEMO";
if (mode !== "DEMO" && mode !== "LIVE")
  throw new Error("AKRE_MODE must be DEMO or LIVE");

const globalState = globalThis as typeof globalThis & {
  __akreServer?: {
    app: ReturnType<typeof createApp>;
    service: Service;
  };
};

function getServer() {
  if (globalState.__akreServer) return globalState.__akreServer;

  const repo = new Repository(process.env.DATABASE_PATH ?? "/tmp/akre.sqlite", mode);
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
  const { app, service } = getServer();

  // Vercel does not keep a background interval alive reliably. Advance one
  // queued job opportunistically on API traffic instead of pretending that a
  // worker is continuously running in a serverless function.
  try {
    await service.runNext();
  } catch (error) {
    console.error("AKRE worker step failed", error);
  }

  return app(req, res);
}
