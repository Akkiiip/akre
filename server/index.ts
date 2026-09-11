import "dotenv/config";
import { Repository } from "./database";
import { Service } from "./service";
import { ShopifyProvider, YouTubeProvider } from "./providers";
import { createApp } from "./app";
const mode = process.env.AKRE_MODE ?? "DEMO";
if (mode !== "DEMO" && mode !== "LIVE")
  throw new Error("AKRE_MODE must be DEMO or LIVE");
const host = process.env.HOST ?? "127.0.0.1";
if (
  (mode === "LIVE" || !["127.0.0.1", "localhost", "::1"].includes(host)) &&
  (!process.env.AKRE_ADMIN_PASSWORD ||
    process.env.AKRE_ADMIN_PASSWORD.length < 16 ||
    !process.env.AKRE_SESSION_SECRET ||
    process.env.AKRE_SESSION_SECRET.length < 32 ||
    !process.env.PUBLIC_ORIGIN)
)
  throw new Error(
    "Hosted/LIVE mode requires a 16+ character admin password, 32+ character session secret and PUBLIC_ORIGIN",
  );
const repo = new Repository(
  process.env.DATABASE_PATH ?? "data/akre.sqlite",
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
// Never silently retry an interrupted external write: it may have succeeded remotely.
repo.transaction(() => {
  for (const j of repo.list("jobs").filter((j) => j.status === "RUNNING"))
    repo.put("jobs", {
      ...j,
      status: "ERROR",
      error: "Worker interrupted; reconcile external state before retry",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
});
const app = createApp(service, {
  password: process.env.AKRE_ADMIN_PASSWORD,
  sessionSecret: process.env.AKRE_SESSION_SECRET,
  origin: process.env.PUBLIC_ORIGIN,
  staticDir: "dist",
});
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await service.runNext();
  } catch {
    console.error("Worker storage failure");
  } finally {
    busy = false;
  }
}, 1000);
const server = app.listen(Number(process.env.PORT ?? 3001), host, () =>
  console.log(
    `AKRE ${mode} server listening on ${host}:${process.env.PORT ?? 3001}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      repo.close();
      process.exit(0);
    });
  });
