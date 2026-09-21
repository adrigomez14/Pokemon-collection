import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const origin = 'http://127.0.0.1:4175'
const assets = ['/pwa/offline.html', '/pwa/offline.css', '/pwa/offline.js',
  '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png'].sort()
const deployment = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const controlHeaders = { 'x-pwa-test': 'local-fixture' }

async function control(request: APIRequestContext, action: string, data = {}) {
  const response = await request.post(`${origin}/__pwa_test__/${action}`, { headers: controlHeaders, data })
  expect(response.ok()).toBe(true)
}

async function serverState(request: APIRequestContext) {
  const response = await request.get(`${origin}/__pwa_test__/state`, { headers: controlHeaders })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<{ version: string; revision: string; requests: string[] }>
}

// No page.route mocks for localhost: all worker/install/update/offline traffic is real HTTP.
// Every nonlocal browser request is fulfilled/aborted before transport, including new tabs.
const test = base.extend<{ isolatedNetwork: void }>({
  isolatedNetwork: [async ({ context, request }, use) => {
    await control(request, 'reset')
    const unexpected: string[] = []
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin === origin) return route.continue()
      if (url.hostname === 'api.tcgdex.net') return route.fulfill({ json: [] })
      if (url.hostname === 'pokefolio-pwa-fixture.supabase.co') return route.fulfill({ status: 503, json: { error: 'offline test fixture: no auth' } })
      if (!['assets.tcgdex.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'pagead2.googlesyndication.com'].includes(url.hostname)) {
        unexpected.push(url.origin)
      }
      return route.abort('blockedbyclient')
    })
    await use()
    expect(unexpected, 'Ningún servicio/cuenta de producción debe solicitarse').toEqual([])
  }, { auto: true }],
})

async function ready(page: Page, path = '/catalogo') {
  await page.goto(path)
  await expect(page.getByRole('button', { name: 'Instalar app', exact: true })).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated')
  expect(await page.evaluate(() => isSecureContext)).toBe(true)
}

async function cachesSnapshot(page: Page) {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {}
    for (const name of await caches.keys()) {
      result[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname).sort()
    }
    return result
  })
}

async function assertSixAssets(page: Page) {
  const snapshot = await cachesSnapshot(page)
  const own = Object.keys(snapshot).filter((key) => key.startsWith('pokefolio-offline-'))
  expect(own).toHaveLength(1)
  expect(snapshot[own[0]]).toEqual(assets)
  // También comprobar URLs completas: ni queries, credenciales, externos ni duplicados.
  expect(await page.evaluate(async (name) => (await (await caches.open(name)).keys()).every((r) => {
    const url = new URL(r.url)
    return url.origin === location.origin && !url.search && !url.hash && r.method === 'GET'
  }), own[0])).toBe(true)
}

function navigations(page: Page) {
  const urls: string[] = []
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) urls.push(frame.url()) })
  return urls
}

async function authDraft(page: Page, value: string) {
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
  await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(value)
}

test('primer install real: initialize de producción reclama cliente sin recarga ni aviso de actualización', async ({ page, request }) => {
  const visits = navigations(page)
  await ready(page)
  expect(visits).toHaveLength(1)
  await expect(page.getByRole('complementary', { name: 'Actualizaciones de Pokéfolio' })).toHaveCount(0)
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return { script: registration.active?.scriptURL, scope: registration.scope, waiting: !!registration.waiting, cache: registration.updateViaCache }
  })).toEqual({ script: `${origin}/sw.js`, scope: `${origin}/`, waiting: false, cache: 'none' })
  const { version } = await serverState(request)
  expect(Object.keys(await cachesSnapshot(page))).toEqual([`pokefolio-offline-${version}`])
  await assertSixAssets(page)
})

test('contrato servido: hash real, manifest, PNG, CSP/caché exactas y rewrites limitados', async ({ page, request }) => {
  await ready(page)
  const worker = await request.get('/sw.js')
  expect(await worker.text()).toMatch(/const VERSION = '[a-f0-9]{20}'/)
  expect(await worker.text()).not.toContain('__POKEFOLIO_BUILD__')
  const manifestResponse = await request.get('/manifest.webmanifest')
  expect(manifestResponse.headers()['content-type']).toBe('application/manifest+json; charset=utf-8')
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({ id: '/', name: 'Pokéfolio', short_name: 'Pokéfolio', start_url: '/catalogo', scope: '/', display: 'standalone' })
  expect(manifest.icons).toEqual([
    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ])
  for (const [path, size] of [['/pwa/icon-192.png', 192], ['/pwa/icon-512.png', 512], ['/pwa/apple-touch-icon.png', 180]] as const) {
    const response = await request.get(path)
    expect(response.headers()['content-type']).toBe('image/png')
    const png = await response.body()
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    expect(await page.evaluate(async (src) => {
      const image = new Image(); image.src = src; await image.decode()
      return [image.naturalWidth, image.naturalHeight]
    }, path)).toEqual([size, size])
  }
  for (const path of ['/catalogo', '/coleccion', '/deseos', '/contacto', '/privacidad', '/sw.js', '/manifest.webmanifest', ...assets]) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    const matching = deployment.headers.filter((rule) => rule.source === '/(.*)' || rule.source === path || (rule.source === '/pwa/(.*)' && path.startsWith('/pwa/')))
    for (const rule of matching) for (const header of rule.headers) expect(response.headers()[header.key.toLowerCase()]).toBe(header.value)
  }
  expect((await request.get('/unknown-fixture')).status()).toBe(404)
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
})

test('CacheStorage real sigue limitada a seis recursos tras rutas, API pública y datos privados sintéticos', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => localStorage.setItem('pwa-private-fixture', 'PWA_NON_SENSITIVE_FIXTURE_ONLY'))
  for (const path of ['/coleccion', '/deseos', '/contacto', '/privacidad', '/catalogo']) await page.goto(path)
  expect(await page.evaluate(async () => {
    const paths = ['/api/pwa-public-fixture', '/api/pwa-private-fixture', '/manifest.webmanifest', '/catalogo?code=fixture-not-auth']
    return Promise.all(paths.map(async (path) => {
      const response = await fetch(path, { headers: path.includes('private') ? { Authorization: 'Bearer NON_SECRET_TEST_FIXTURE' } : {} })
      return response.status
    }))
  })).toEqual([200, 200, 200, 200])
  await assertSixAssets(page)
  expect(await page.evaluate(async () => {
    for (const name of await caches.keys()) for (const response of await (await caches.open(name)).matchAll()) {
      if ((response.headers.get('content-type') || '').includes('text/') && (await response.text()).includes('PWA_NON_SENSITIVE_FIXTURE_ONLY')) return true
    }
    return false
  })).toBe(false)
})

for (const path of ['/catalogo', '/coleccion', '/deseos']) {
  test(`offline real ${path}: fallback genérico; solo manifest de red permite volver a /catalogo`, async ({ page, context, request }) => {
    await ready(page)
    await page.evaluate(() => localStorage.setItem('pwa-private-fixture', 'PWA_NON_SENSITIVE_FIXTURE_ONLY'))
    await context.setOffline(true)
    const response = await page.goto(path)
    expect(response?.fromServiceWorker()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Ahora mismo no hay conexión' })).toBeVisible()
    expect(await page.content()).not.toContain('PWA_NON_SENSITIVE_FIXTURE_ONLY')
    await expect(page.locator('#root, input, dialog')).toHaveCount(0)
    expect(await page.locator('script').evaluateAll((nodes) => nodes.map((node) => new URL((node as HTMLScriptElement).src).pathname))).toEqual(['/pwa/offline.js'])
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('status')).toContainText('No se pudo comprobar')
    await assertSixAssets(page)
    // Señal online NO es suficiente: el servidor sigue fallando aunque existe manifest HTTP previo.
    await control(request, 'configure', { faults: { '/manifest.webmanifest': 500 } })
    const failedProbe = page.waitForResponse((r) => r.url() === `${origin}/manifest.webmanifest` && r.status() === 500)
    await context.setOffline(false)
    expect((await failedProbe).fromServiceWorker()).toBe(false)
    await expect(page.getByRole('status')).toContainText('No se pudo comprobar')
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(page.locator('meta[name="pokefolio-offline"]')).toHaveCount(1)
    const before = (await serverState(request)).requests.filter((p) => p === '/manifest.webmanifest').length
    await control(request, 'configure', { faults: {} })
    const networkProbe = page.waitForResponse((r) => r.url() === `${origin}/manifest.webmanifest` && r.ok())
    await page.getByRole('button', { name: 'Reintentar' }).click()
    expect((await networkProbe).fromServiceWorker()).toBe(false)
    await expect(page).toHaveURL(`${origin}/catalogo`)
    await expect(page.getByRole('button', { name: 'Instalar app', exact: true })).toBeVisible()
    expect((await serverState(request)).requests.filter((p) => p === '/manifest.webmanifest').length).toBeGreaterThan(before)
    await assertSixAssets(page)
  })
}

for (const status of [404, 500]) {
  test(`HTTP ${status} en ruta conocida no se enmascara como offline`, async ({ page, request }) => {
    await ready(page)
    await control(request, 'configure', { faults: { '/coleccion': status } })
    const response = await page.goto('/coleccion')
    expect(response?.status()).toBe(status)
    expect(response?.fromServiceWorker()).toBe(true)
    await expect(page.locator('body')).toContainText(`fixture HTTP ${status}`)
    await expect(page.locator('meta[name="pokefolio-offline"]')).toHaveCount(0)
    await assertSixAssets(page)
  })
}

for (const scenario of [
  { path: '/catalogo?code=fixture-not-auth', authorization: false },
  { path: '/unknown-fixture', authorization: false },
  { path: '/api/pwa-private-fixture', authorization: false },
  { path: '/catalogo', authorization: true },
]) {
  test(`offline ignora ${scenario.path}${scenario.authorization ? ' con Authorization' : ''}`, async ({ page, context }) => {
    await ready(page)
    if (scenario.authorization) await context.setExtraHTTPHeaders({ Authorization: 'Bearer NON_SECRET_TEST_FIXTURE' })
    await context.setOffline(true)
    await expect(page.goto(scenario.path)).rejects.toThrow(/net::ERR_/)
    await expect(page.locator('meta[name="pokefolio-offline"]')).toHaveCount(0)
  })
}

test('app abierta suspende dialog real; borrador vive al reconectar, no se persiste tras recarga', async ({ page, context }) => {
  const visits = navigations(page)
  await ready(page)
  const draft = 'draft-pwa-only@example.invalid'
  await authDraft(page, draft)
  await context.setOffline(true)
  await expect(page.getByRole('heading', { name: 'Sin conexión', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('.pwa-app')).toHaveAttribute('inert', '')
  expect(await page.locator('dialog input[type="email"]').inputValue()).toBe(draft)
  await page.getByRole('button', { name: 'Comprobar conexión' }).click()
  await expect(page.getByRole('status')).toContainText('No se pudo comprobar')
  await context.setOffline(false)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Correo electrónico', exact: true })).toHaveValue(draft)
  expect(visits).toHaveLength(1)
  expect(await page.evaluate((text) => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => value.includes(text)), draft)).toBe(false)
  await page.reload()
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Correo electrónico', exact: true })).toHaveValue('')
})

test('actualización real waiting: cancelar conserva borrador; consentimiento activa, limpia solo caché propia y recarga solo esta pestaña', async ({ page, context, request }) => {
  const visits = navigations(page)
  await ready(page, '/contacto')
  const draft = 'Borrador local de actualización sin envío'
  await page.getByRole('textbox', { name: 'Mensaje', exact: true }).fill(draft)
  const other = await context.newPage()
  const otherVisits = navigations(other)
  await ready(other, '/contacto')
  await other.getByRole('textbox', { name: 'Mensaje', exact: true }).fill('Borrador de la otra pestaña')
  const { version } = await serverState(request)
  await page.evaluate(async () => {
    await (await caches.open('foreign-cache-do-not-delete')).put('/foreign-fixture', new Response('foreign'))
  })
  await control(request, 'configure', { revision: 'consented-update' })
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update() })
  await expect(page.getByText('Nueva versión disponible', { exact: true })).toBeVisible()
  await expect(other.getByText('Nueva versión disponible', { exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed')
  expect(Object.keys(await cachesSnapshot(page)).sort()).toEqual([
    'foreign-cache-do-not-delete', `pokefolio-offline-${version}`, `pokefolio-offline-${version}-consented-update`,
  ].sort())
  expect(visits).toHaveLength(1)
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Los borradores y cambios sin guardar pueden perderse')
  await page.getByRole('button', { name: 'Ahora no' }).click()
  await expect(page.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveValue(draft)
  expect(visits).toHaveLength(1)
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  // No mock: mensaje WindowClient -> worker waiting, event.origin y clients.get reales de Chromium.
  await page.getByRole('button', { name: 'Actualizar y recargar' }).click()
  await expect.poll(() => visits.length).toBe(2)
  await expect(page.getByRole('button', { name: 'Instalar app', exact: true })).toBeVisible()
  await expect.poll(async () => Object.keys(await cachesSnapshot(page)).sort()).toEqual([
    'foreign-cache-do-not-delete', `pokefolio-offline-${version}-consented-update`,
  ].sort())
  await expect(other.getByText('Nueva versión disponible', { exact: true })).toHaveCount(0)
  await expect(other.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveValue('Borrador de la otra pestaña')
  expect(otherVisits).toHaveLength(1)
  expect(await page.evaluate(async () => (await (await caches.open('foreign-cache-do-not-delete')).match('/foreign-fixture'))?.text())).toBe('foreign')
  await assertSixAssets(page)
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update() })
  await expect(page.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveValue('')
  expect(visits).toHaveLength(2)
  expect(otherVisits).toHaveLength(1)
})

test('fallo HTTP durante instalación de nueva versión conserva worker/caché anterior y no ofrece actualizar', async ({ page, request }) => {
  await ready(page)
  const original = await cachesSnapshot(page)
  await control(request, 'configure', { revision: 'broken-update', faults: { '/pwa/icon-512.png': 500 } })
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const ended = new Promise<string>((resolve) => registration.addEventListener('updatefound', () => {
      const worker = registration.installing!
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(worker.state) })
    }, { once: true }))
    await registration.update()
    return ended
  })
  expect(state).toBe('redundant')
  expect(await cachesSnapshot(page)).toEqual(original)
  await expect(page.getByText('Nueva versión disponible', { exact: true })).toHaveCount(0)
})

test('UI SINTÉTICA de instalación: prompt diferido y appinstalled; NO acredita instalación nativa', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.syntheticPromptCalls = String(Number(document.documentElement.dataset.syntheticPromptCalls || 0) + 1) },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    window.dispatchEvent(event)
  })
  await page.getByRole('button', { name: 'Instalar app', exact: true }).click()
  await page.getByRole('button', { name: 'Instalar Pokéfolio', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('El navegador confirmará si se completa la instalación')
  await expect(page.locator('html')).toHaveAttribute('data-synthetic-prompt-calls', '1')
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(page.getByRole('dialog')).toContainText('ya está instalada')
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'App instalada', exact: true })).toBeVisible()
})

for (const dark of [false, true]) {
  test(`layout ${dark ? 'oscuro' : 'claro'}: ayuda/footer y offline sin desbordamiento, safe-area declarada`, async ({ page, context }) => {
    await ready(page)
    if (dark) await page.getByRole('button', { name: 'Activar modo nocturno', exact: true }).click()
    await page.getByRole('button', { name: 'Instalar app', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const modal = await page.getByRole('dialog').boundingBox()
    expect(modal!.x).toBeGreaterThanOrEqual(0)
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(await page.locator('.pwa-install-content').evaluate((node) => getComputedStyle(node).getPropertyValue('--pwa-surface').trim())).toBe(dark ? '#142532' : '#fff')
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await context.setOffline(true)
    await expect(page.getByRole('heading', { name: 'Sin conexión', exact: true })).toBeVisible()
    expect(await page.locator('.pwa-offline').evaluate((node) => {
      const style = getComputedStyle(node)
      return node.scrollWidth <= node.clientWidth && parseFloat(style.paddingLeft) >= 16 && parseFloat(style.paddingBottom) >= 20
    })).toBe(true)
    await page.goto('/coleccion')
    await expect(page.getByRole('heading', { name: 'Ahora mismo no hay conexión' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
    expect(await page.evaluate(() => {
      const style = getComputedStyle(document.body)
      return parseFloat(style.paddingLeft) >= 20 && parseFloat(style.paddingBottom) >= 24
    })).toBe(true)
    // Emulación Chromium tiene insets cero; el notch físico de Safari se valida manualmente.
    for (const file of ['../../src/pwa.css', '../../public/pwa/offline.css']) {
      const css = readFileSync(new URL(file, import.meta.url), 'utf8')
      for (const side of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`env(safe-area-inset-${side})`)
    }
  })
}
