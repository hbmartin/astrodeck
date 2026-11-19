// Isolated Chromium accessibility oracle: page.setContent needs neither Astro nor dist/.
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser-oracle',
  outputDir: './test-results/image-name-oracle',
  forbidOnly: !!process.env.CI,
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
