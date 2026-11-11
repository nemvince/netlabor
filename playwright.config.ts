import { defineConfig } from '@playwright/test';

const baseURL = process.env.NB_E2E_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { browserName: 'chromium', storageState: 'e2e/.auth/state.json' },
      dependencies: ['setup'],
    },
  ],
});
