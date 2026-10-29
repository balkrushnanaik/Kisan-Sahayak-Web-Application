import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests expect the disposable MongoDB replica set from docker-compose.yml
 * to be running and server/.env to contain local development configuration.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://localhost:4000/healthz',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:client',
      url: 'http://localhost:5173',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
