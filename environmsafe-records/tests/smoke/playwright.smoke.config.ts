import { defineConfig, devices } from '@playwright/test';

// Production smoke test: run against the live site after every release.
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/smoke',
  timeout: 120_000,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: '../../test-results/smoke-results.json' }]],
  use: { baseURL: process.env.E2E_BASE_URL || 'https://records.environmsafe.com', serviceWorkers: 'block', screenshot: 'on' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
