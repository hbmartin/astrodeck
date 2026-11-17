import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';
import { siteOrigin } from './scripts/lib/site-check-config.mjs';

const external = process.env.PLAYWRIGHT_BASE_URL;
const local = 'http://127.0.0.1:4329';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: 'test-results',
  use: {
    baseURL: external ? siteOrigin(external, { loopback: true }).origin : local,
    trace: 'retain-on-failure',
  },
  webServer: external
    ? undefined
    : { command: 'pnpm run preview:smoke', url: local, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
