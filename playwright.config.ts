import { defineConfig, devices } from "@playwright/test";

const port = 4178;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1100 } } }],
  webServer: {
    command: "pnpm build && node tests/e2e/server.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
