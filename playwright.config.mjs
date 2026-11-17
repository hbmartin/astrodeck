// Browser checks for the interactive parts every site ships with (`pnpm run test:e2e`).
// The script builds first; Playwright then serves dist/ with `astro preview`.
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4329';

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: !!process.env.CI,
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    // Astro moves `preview` to the background when a coding agent runs it; --ignore-lock keeps
    // it in the foreground so Playwright owns the server and stops it after the run.
    command: 'astro preview --ignore-lock --host 127.0.0.1 --port 4329',
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
