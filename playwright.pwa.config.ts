import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Build de producción aislado; nunca reutilizar un servidor dev ni cargar .env.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'pwa.spec.ts',
  fullyParallel: false,
  workers: 1, // El control HTTP en memoria es compartido: los escenarios son seriales.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/pwa',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'pwa-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1365, height: 950 } } },
    { name: 'pwa-mobile-320', use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium', viewport: { width: 320, height: 740 } } },
    { name: 'pwa-mobile-390', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: `"${process.execPath}" scripts/pwa-test-server.mjs`,
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    url: 'http://127.0.0.1:4175/__pwa_test__/ready',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
