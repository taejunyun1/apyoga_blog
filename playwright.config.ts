import { defineConfig, devices } from "@playwright/test"

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL
const authSuite = process.env.PLAYWRIGHT_AUTH === "1"
const localBaseUrl = "http://127.0.0.1:43917"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: authSuite ? "**/auth-flow.spec.ts" : undefined,
  testIgnore: authSuite ? undefined : "**/auth-flow.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  expect: { timeout: 30_000 },
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } }
    },
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }
    }
  ],
  webServer: externalBaseUrl ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 43917 --strictPort",
    url: localBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000
  }
})
