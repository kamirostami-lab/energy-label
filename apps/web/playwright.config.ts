// Browser tests for the generate flow (Build Brief 01 section 11: Playwright for the generator).
// They run against the built Worker in workerd: `pnpm build` first, then `pnpm e2e`.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a Chromium that is already installed.
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A fresh local D1 database gets the migrations; sign-in emails go to the in-memory outbox.
    command:
      'pnpm exec wrangler d1 migrations apply DB --local && pnpm exec wrangler dev --port 8787 --ip 127.0.0.1 --var MAIL_TRANSPORT:outbox',
    url: 'http://127.0.0.1:8787/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
