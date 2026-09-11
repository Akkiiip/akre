import { chromium, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Repository } from "../server/database";
import { Service } from "../server/service";
import { ShopifyProvider, YouTubeProvider } from "../server/providers";
import { createApp } from "../server/app";
const repo = new Repository(
  process.env.AKRE_LIVE_DATABASE ?? "data/live.sqlite",
  "LIVE",
);
if (
  !repo
    .list("observations")
    .some((o) => o.sourceId === "wikimedia" && o.fetchedAt)
)
  throw new Error(
    "Run actual live ingestion first; this check never seeds live data",
  );
const service = new Service(
    repo,
    new ShopifyProvider({}),
    new YouTubeProvider(),
  ),
  password = randomBytes(32).toString("hex");
const server = createApp(service, {
  password,
  sessionSecret: randomBytes(32).toString("hex"),
  staticDir: "dist",
}).listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", () => r()));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const login = await context.request.post(origin + "/api/login", {
    data: { password },
  });
  expect(login.ok()).toBe(true);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const routes = [
    "radar",
    "products",
    "suppliers",
    "store",
    "content",
    "experiments",
    "analytics",
    "settings",
  ];
  for (const route of routes) {
    await page.goto(`${origin}/${route}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.goto(`${origin}/radar`);
  await expect(page.getByRole("button", { name: /Air fryer/ })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "LIVE", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Observed topic attention" }),
  ).toBeVisible();
  await expect(page.locator(".recharts-wrapper")).toHaveCount(1);
  await expect(
    page.getByText("No purchase-demand inference.", { exact: false }),
  ).toBeVisible();
  mkdirSync("data/verification", { recursive: true });
  await page.screenshot({
    path: "data/verification/live-radar.png",
    fullPage: false,
  });
  await page.goto(`${origin}/settings`);
  await expect(
    page.getByRole("heading", { name: "Shopify integration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test Shopify connection" }),
  ).toBeDisabled();
  await expect(
    page.getByText("NOT CONFIGURED", { exact: true }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const report = {
    verifiedAt: new Date().toISOString(),
    routes,
    realPersistedObservations: repo
      .list("observations")
      .filter((o) => o.sourceId === "wikimedia").length,
    realPersistedSignals: repo
      .list("signals")
      .filter((o) => o.sourceId === "wikimedia").length,
    radarSourceState: "LIVE",
    shopifyState: "NOT CONFIGURED",
    consoleErrors: errors,
    mode: "LIVE",
    note: "Browser read actual persisted external observations; no source responses or metrics were fabricated.",
  };
  mkdirSync("docs/verification", { recursive: true });
  writeFileSync(
    "docs/verification/live-browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  repo.close();
}
