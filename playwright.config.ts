import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    command: process.env.AKRE_TEST_VERCEL
      ? "node tests/vercel/serve.mjs"
      : "npm start",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3101",
      HOST: "127.0.0.1",
      DATABASE_PATH: ":memory:",
      AKRE_MODE: "DEMO",
      AKRE_ADMIN_PASSWORD: "",
      PUBLIC_ORIGIN: process.env.AKRE_TEST_VERCEL
        ? ""
        : "http://127.0.0.1:3101",
      AKRE_TEST_TLS_PROXY: process.env.AKRE_TEST_VERCEL ? "1" : "0",
    },
    timeout: 60000,
  },
});
