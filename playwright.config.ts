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
    command: "npm start",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3101",
      HOST: "127.0.0.1",
      DATABASE_PATH: ":memory:",
      AKRE_MODE: "DEMO",
      AKRE_ADMIN_PASSWORD: "",
      PUBLIC_ORIGIN: "http://127.0.0.1:3101",
    },
    timeout: 60000,
  },
});
