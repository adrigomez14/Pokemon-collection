import { defineConfig, devices } from '@playwright/test'

// Mantener los servidores de pruebas aislados de cualquier archivo .env local.
const testServer = (port: number) => `node --input-type=module -e "import { createServer } from 'vite'; const server = await createServer({ envDir: false, server: { host: '127.0.0.1', port: ${port}, strictPort: true } }); await server.listen();"`

export default defineConfig({
  // Evitar saturar Edge y los dos servidores Vite en equipos de escritorio.
  workers: 2,
  // Los recorridos completos incluyen recarga, Excel e importación, también en equipos ocupados.
  timeout: 60_000,
  testDir: './tests/e2e', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  projects: [
    { name: 'desktop', testMatch: ['catalog.spec.ts', 'recent-sets.spec.ts'], use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testMatch: ['catalog.spec.ts', 'recent-sets.spec.ts'], use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'account', testMatch: ['account.spec.ts', 'contact.spec.ts', 'album-account.spec.ts', 'wishlists.spec.ts', 'preferences.spec.ts'], use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' } },
    { name: 'account-mobile', testMatch: ['account.spec.ts', 'contact.spec.ts', 'album-account.spec.ts', 'wishlists.spec.ts', 'preferences.spec.ts'], use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://127.0.0.1:4174' } },
  ],
  webServer: [
    { command: testServer(4173), url: 'http://127.0.0.1:4173', reuseExistingServer: false, env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' } },
    { command: testServer(4174), url: 'http://127.0.0.1:4174', reuseExistingServer: false, env: { VITE_SUPABASE_URL: 'https://pokefolio-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture_not_a_real_key' } },
  ],
})
