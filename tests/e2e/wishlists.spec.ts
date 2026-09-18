import { test, expect, type Page } from '@playwright/test'
import { card, entry, holoOnlyCard } from '../fixtures'
import type { Card, Language } from '../../src/lib/models'
import type { Wishlist, WishlistItem } from '../../src/lib/wishlists'

const alice = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'alice@example.com', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: '2026-09-17T00:00:00Z' }
const bob = { ...alice, id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com' }
const firstId = '33333333-3333-4333-8333-333333333333'
const snapshot = { id: card.id, localId: card.localId, name: card.name, image: 'https://assets.tcgdex.net/en/sv/sv03.5/200' }
const firstList = { id: firstId, user_id: alice.id, name: 'Favoritas', created_at: '2026-09-17T00:00:00Z' }
const wished = { list_id: firstId, user_id: alice.id, card_id: card.id, language: 'es' as const, card_snapshot: snapshot, target_price: null, created_at: firstList.created_at }
const heart = (page: Page) => page.getByRole('button', { name: 'Listas de deseos de Pikachu', exact: true })
const nav = (page: Page) => page.getByRole('navigation', { name: 'Navegación principal', exact: true })

async function login(page: Page, email = alice.email) {
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only-123')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function setup(page: Page, signedIn = true) {
  const state = { user: alice, lists: [] as Wishlist[], items: [] as WishlistItem[], missing: false, failWrite: false, writes: 0, collectionWrites: 0, deleted: false, releaseWrite: undefined as (() => void) | undefined, holdWrite: false }
  let serial = 3
  await page.route('https://pokefolio-test.supabase.co/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const table = url.pathname.split('/').at(-1)
    if (table === 'token') {
      state.user = request.postDataJSON().email === bob.email ? bob : alice
      const now = Math.floor(Date.now() / 1000)
      const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: state.user.id, role: 'authenticated', is_anonymous: false, exp: now + 3600, amr: [{ method: 'password', timestamp: now }] })).toString('base64url'), 'test-signature'].join('.')
      return route.fulfill({ json: { user: state.user, access_token: token, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer' } })
    }
    if (table === 'user') return route.fulfill({ json: state.user })
    if (table === 'logout') return route.fulfill({ status: 204 })
    if (table === 'wishlist_price_alerts' && method === 'GET') return route.fulfill({ json: [] })
    if (table === 'delete_own_account') {
      state.deleted = true; state.lists = []; state.items = []
      return route.fulfill({ json: null })
    }
    if (table === 'collection_entries') {
      if (method !== 'GET') state.collectionWrites++
      return route.fulfill({ json: state.deleted ? [] : [{ ...entry, id: '55555555-5555-4555-8555-555555555555', user_id: state.user.id, updated_at: firstList.created_at, language: 'es', quantity: 2 }] })
    }
    if (table === 'wishlists' || table === 'wishlist_items') {
      if (state.missing) return route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'test missing table' } })
      const owner = url.searchParams.get('user_id')?.slice(3)
      expect(owner).toBe(state.user.id)
      const id = url.searchParams.get('id')?.slice(3), listId = url.searchParams.get('list_id')?.slice(3)
      if (method === 'GET') return route.fulfill({ json: (table === 'wishlists' ? state.lists : state.items).filter((row) => row.user_id === owner) })
      state.writes++
      if (state.holdWrite) await new Promise<void>((resolve) => { state.releaseWrite = resolve })
      if (state.failWrite) return route.fulfill({ status: 400, json: { code: 'test', message: 'test failure' } })
      if (table === 'wishlists') {
        if (method === 'POST') {
          const row = { ...request.postDataJSON(), id: `${String(serial++).repeat(8)}-3333-4333-8333-333333333333`, created_at: firstList.created_at } as Wishlist
          state.lists.push(row)
          return route.fulfill({ json: row })
        }
        if (method === 'PATCH') {
          state.lists = state.lists.map((row) => row.id === id ? { ...row, name: request.postDataJSON().name } : row)
          return route.fulfill({ json: { id } })
        }
        state.lists = state.lists.filter((row) => row.id !== id)
        state.items = state.items.filter((row) => row.list_id !== id)
      } else if (method === 'POST') {
        const item = request.postDataJSON() as WishlistItem
        expect(Object.keys(item.card_snapshot).sort()).toEqual(['id', 'image', 'localId', 'name'])
        expect(item).not.toHaveProperty('target_price')
        if (!state.items.some((row) => row.list_id === item.list_id && row.card_id === item.card_id && row.language === item.language)) state.items.push({ ...item, target_price: null, created_at: firstList.created_at })
      } else if (method === 'PATCH') {
        state.items = state.items.map((row) => row.list_id === listId && row.card_id === url.searchParams.get('card_id')?.slice(3) && row.language === url.searchParams.get('language')?.slice(3) ? { ...row, target_price: request.postDataJSON().target_price } : row)
        return route.fulfill({ json: { list_id: listId } })
      } else state.items = state.items.filter((row) => !(row.list_id === listId && row.card_id === url.searchParams.get('card_id')?.slice(3) && row.language === url.searchParams.get('language')?.slice(3)))
      return route.fulfill({ status: 204 })
    }
    if (method !== 'GET' && url.pathname.includes('/rest/')) state.collectionWrites++
    return route.fulfill({ status: 404 })
  })
  await page.route('https://api.tcgdex.net/v2/**', (route) => {
    const url = new URL(route.request().url())
    const cards = [{ ...card, ...snapshot }, { ...card, id: 'base1-1', localId: '1', name: 'Bulbasaur' }]
    if (url.pathname.endsWith('/sets')) return route.fulfill({ json: [{ id: 'base1', name: 'Base Set', cardCount: { total: 2, official: 2 } }] })
    if (url.pathname.endsWith('/sets/base1')) return route.fulfill({ json: { id: 'base1', name: 'Base Set', serie: { id: 'base' }, cardCount: { total: 2, official: 2 }, cards } })
    if (url.pathname.endsWith('/rarities')) return route.fulfill({ json: ['Common'] })
    if (/\/(categories|types)$/.test(url.pathname)) return route.fulfill({ json: [] })
    if (url.pathname.endsWith('/cards')) return route.fulfill({ json: cards })
    return route.fulfill({ json: { ...card, ...snapshot } })
  })
  await page.route('https://assets.tcgdex.net/**', (route) => route.abort())
  await page.goto('/')
  if (signedIn) await login(page)
  await expect(heart(page)).toBeVisible()
  return state
}

test('el corazón sin cuenta abre acceso, no una ficha ni un guardado ficticio', async ({ page }) => {
  const state = await setup(page, false)
  await heart(page).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeVisible()
  expect(state.writes).toBe(0)
})

test('varias listas, idiomas, renombrado y borrado independiente persisten sin modificar colección', async ({ page }) => {
  const state = await setup(page)
  await heart(page).click()
  const modal = page.getByRole('dialog')
  for (const name of ['Favoritas', 'Para regalar']) {
    await modal.getByLabel('Nueva lista privada', { exact: true }).fill(name)
    await modal.getByRole('button', { name: 'Crear lista', exact: true }).click()
    const checkbox = modal.getByRole('checkbox', { name, exact: true })
    await expect(checkbox).toBeEnabled()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    await expect(checkbox).toBeEnabled()
  }
  expect(state.items).toHaveLength(2)
  await modal.getByRole('checkbox', { name: 'Favoritas', exact: true }).click()
  await expect(modal.getByRole('checkbox', { name: 'Favoritas', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1')
  await page.getByLabel('Idioma de las cartas').selectOption('en')
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'false')
  await page.getByLabel('Idioma de las cartas').selectOption('es')
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'true')
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  await page.getByRole('navigation', { name: 'Mis listas privadas' }).getByRole('button', { name: /Para regalar/ }).click()
  await page.getByRole('button', { name: 'Renombrar', exact: true }).click()
  await page.getByLabel('Nombre de la lista', { exact: true }).fill('Mi próxima carta')
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/\/deseos$/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await page.getByRole('navigation', { name: 'Mis listas privadas' }).getByRole('button', { name: /Mi próxima carta/ }).click()
  await page.getByRole('button', { name: /Quitar Pikachu en Español/ }).click()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(state.items).toHaveLength(1)
  await page.getByRole('button', { name: /Quitar Pikachu en Español/ }).click()
  await page.getByRole('button', { name: 'Confirmar quitar carta', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await page.getByRole('button', { name: 'Eliminar lista', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar eliminación', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect(state.lists.map((list) => list.name)).toEqual(['Favoritas'])
  expect(state.items).toHaveLength(0)
  expect(state.collectionWrites).toBe(0)
  await nav(page).getByRole('button', { name: /Mi colección/ }).click()
  await expect(page.getByRole('region', { name: 'Resumen de tu colección', exact: true })).toContainText('2 ejemplares')
})

test('el objetivo se guarda, persiste y no arrastra borradores entre listas', async ({ page }) => {
  const state = await setup(page)
  const secondId = '44444444-4444-4444-8444-444444444444'
  state.lists = [firstList, { ...firstList, id: secondId, name: 'Para regalar' }]
  state.items = [{ ...wished }, { ...wished, list_id: secondId }]
  await page.reload()
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  const lists = page.getByRole('navigation', { name: 'Mis listas privadas' })
  const field = page.getByRole('spinbutton', { name: 'Precio objetivo (€)', exact: true })
  const save = page.locator('.wishlist-target-price').getByRole('button', { name: 'Guardar', exact: true })
  await lists.getByRole('button', { name: /Favoritas/ }).click()
  await field.fill('99')
  await lists.getByRole('button', { name: /Para regalar/ }).click()
  await expect(field).toHaveValue('')
  await field.fill('12.50')
  await save.click()
  await expect(save).toBeEnabled()
  await expect(field).toHaveValue('12.5')
  expect(state.items.find((item) => item.list_id === secondId)?.target_price).toBe(12.5)
  expect(state.items.find((item) => item.list_id === firstId)?.target_price).toBeNull()
  await page.reload()
  await lists.getByRole('button', { name: /Para regalar/ }).click()
  await expect(field).toHaveValue('12.5')
  state.failWrite = true
  await field.fill('15')
  await save.click()
  await expect(page.locator('.wishlist-error')).toBeVisible()
  expect(state.items.find((item) => item.list_id === secondId)?.target_price).toBe(12.5)
  state.failWrite = false
  await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
  await expect(field).toBeEnabled()
  await field.fill('')
  await save.click()
  await expect(save).toBeEnabled()
  await expect(field).toHaveValue('')
  expect(state.items.every((item) => item.target_price === null)).toBe(true)
  expect(state.collectionWrites).toBe(0)
})

test('un error de escritura no marca el corazón y bloquea duplicados hasta confirmar la recarga', async ({ page }) => {
  const state = await setup(page)
  state.lists = [firstList]
  await page.reload()
  await heart(page).click()
  const checkbox = page.getByRole('checkbox', { name: 'Favoritas', exact: true })
  await expect(checkbox).toBeEnabled()
  state.failWrite = true; state.holdWrite = true
  await checkbox.click()
  await expect.poll(() => state.writes).toBe(1)
  await expect(checkbox).toBeDisabled()
  await checkbox.dispatchEvent('change')
  expect(state.writes).toBe(1)
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'false')
  state.releaseWrite?.()
  await expect(page.getByRole('alert')).toContainText('No se han podido cargar o guardar')
  await expect(checkbox).not.toBeChecked()
  state.failWrite = false; state.holdWrite = false
  await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
  await expect(checkbox).toBeEnabled()
  await checkbox.click()
  await expect(checkbox).toBeChecked()
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'true')
  expect(state.writes).toBe(2)
})

test('la falta de migración tiene recuperación explícita y no se presenta como lista vacía', async ({ page }) => {
  const state = await setup(page)
  state.missing = true
  await page.reload()
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('migración 007')
  await expect(page.getByRole('heading', { name: 'Aún no tienes listas', exact: true })).toHaveCount(0)
  state.missing = false
  await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aún no tienes listas', exact: true })).toBeVisible()
  expect(state.writes).toBe(0)
})

test('cerrar sesión y entrar en otra cuenta no expone listas ni corazones anteriores', async ({ page }) => {
  const state = await setup(page)
  state.lists = [firstList]; state.items = [wished]
  await page.reload()
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'true')
  await heart(page).click()
  // Simula SIGNED_OUT recibido desde otra pestaña, con el selector abierto.
  await page.evaluate(() => new BroadcastChannel('sb-pokefolio-test-auth-token').postMessage({ event: 'SIGNED_OUT', session: null }))
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'false')
  // Limpieza real del SDK para que el siguiente inicio no herede almacenamiento.
  await page.reload()
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await login(page, bob.email)
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aún no tienes listas', exact: true })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('Favoritas')
  expect(state.lists).toHaveLength(1)
})

test('borrar cuenta mantiene la expulsión automática y elimina datos privados de la interfaz', async ({ page }) => {
  const state = await setup(page)
  state.lists = [firstList]; state.items = [wished]
  await page.reload()
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'true')
  await nav(page).getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: 'Gestionar cuenta', exact: true }).click()
  await page.getByLabel('Contraseña actual para eliminar la cuenta').fill('test-password-only-123')
  await page.getByLabel('Escribe ELIMINAR para confirmar').fill('ELIMINAR')
  await page.getByRole('button', { name: 'Eliminar mi cuenta definitivamente', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mi cuenta', exact: true })).toBeVisible()
  await expect(heart(page)).toHaveAttribute('aria-pressed', 'false')
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  await expect(page.locator('main')).not.toContainText('Favoritas')
  expect(state.deleted).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('sb-pokefolio-test-auth-token'))).toBeNull()
})

test('el catálogo compacto tiene dos columnas, controles táctiles y filtros que conservan su valor', async ({ page }, testInfo) => {
  await setup(page)
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await heart(page).boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    if (width < 700) {
      await expect(page.getByLabel('Número de carta', { exact: true })).toBeHidden()
      const positions = await page.locator('.catalog-card').evaluateAll((cards) => cards.map((card) => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().top + scrollY })))
      const recentHeight = await page.locator('.recent-sets').evaluate((element) => {
        const style = getComputedStyle(element)
        return element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom)
      })
      // La fila solicitada añade altura; el resto del catálogo conserva su presupuesto compacto.
      expect(recentHeight).toBeLessThan(280)
      expect(positions[0].y - recentHeight).toBeLessThan(1000)
      expect(positions[0].y).toBe(positions[1].y)
      expect(positions[0].x).toBeLessThan(positions[1].x)
      await page.screenshot({ path: testInfo.outputPath(`catalogo-${width}.png`), fullPage: true })
    }
  }
  await page.setViewportSize({ width: 390, height: 950 })
  await page.getByRole('button', { name: 'Más filtros', exact: true }).click()
  await page.getByLabel('Número de carta', { exact: true }).fill('058')
  await page.getByRole('button', { name: 'Ocultar filtros', exact: false }).click()
  await expect(page.getByLabel('Número de carta', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: /Más filtros/ }).click()
  await expect(page.getByLabel('Número de carta', { exact: true })).toHaveValue('058')
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

// Extensión del setup existente: los servicios privados y sus contadores no se sustituyen.
function priceItem(detail: Card, language: Language = 'es', listId = firstId, target: number | null = null): WishlistItem {
  const { id, localId, name, image } = detail
  return { ...wished, list_id: listId, card_id: id, language, target_price: target, card_snapshot: { id, localId, name, image } }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function mockCurrentPrices(page: Page, reply: (language: string, id: string) => { detail: Card; status?: number; gate?: Promise<void> }) {
  const requests: string[] = []
  // Esta ruta más específica se registra después de setup y antes de entrar en Deseos.
  await page.route(/^https:\/\/api\.tcgdex\.net\/v2\/[^/]+\/cards\/[^/?]+$/, async (route) => {
    const [, , language, , id] = new URL(route.request().url()).pathname.split('/')
    requests.push(`${language}:${id}`)
    const response = reply(language, id)
    if (response.gate) await response.gate
    await route.fulfill({ status: response.status ?? 200, json: response.status ? { error: 'Fallo público simulado' } : response.detail })
  })
  return requests
}

async function enterPriceList(page: Page) {
  await page.reload()
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  await expect(page.locator('.wishlist-card').first()).toBeAttached()
}

function priceRow(page: Page, name: string, language = 'Español') {
  return page.locator('.wishlist-card').filter({ has: page.getByRole('button', { name: `Abrir ${name} en ${language}`, exact: true }) })
}

// Barrera de render/efectos, no espera arbitraria ni sondeo de red con sleep.
async function priceEffects(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test.describe('precio Actual en Deseos', () => {
  test('normal y holo exclusiva coinciden con la ficha, preservan objetivo 90 y comparten caché entre listas', async ({ page }) => {
    const state = await setup(page)
    const secondId = '44444444-4444-4444-8444-444444444444'
    state.lists = [firstList, { ...firstList, id: secondId, name: 'Otra lista' }]
    state.items = [priceItem(card, 'es', firstId, 90), priceItem(holoOnlyCard), priceItem(card, 'es', secondId, 90)]
    const requests = await mockCurrentPrices(page, (_language, id) => ({ detail: id === holoOnlyCard.id ? holoOnlyCard : card }))
    await enterPriceList(page)
    const now = Date.now()
    await page.clock.setFixedTime(now)
    for (const [detail, amount, variant] of [[card, '2,50 €', 'normal'], [holoOnlyCard, '134,40 €', 'holo']] as const) {
      const row = priceRow(page, detail.name)
      await row.scrollIntoViewIfNeeded()
      const price = row.locator('.wishlist-current-price')
      await expect(price.locator('small')).toHaveText('Actual')
      await expect(price.locator('strong')).toHaveText(amount)
      await expect(price).toHaveAttribute('data-state', 'ready')
      await expect(price).toHaveAttribute('title', /Mismo precio inicial de la ficha/)
      await priceEffects(page)
      // StrictMode puede repetir el montaje inicial; se compara contra el baseline observado.
      const baseline = requests.filter((key) => key === `es:${detail.id}`).length
      expect(baseline).toBeGreaterThan(0)
      const actual = await price.locator('strong').textContent()
      // El importe forma parte del propio botón de abrir, no de un control independiente.
      await price.click()
      const modal = page.getByRole('dialog')
      await expect(modal.getByRole('combobox', { name: 'Variante', exact: true })).toHaveValue(variant)
      await expect(modal.locator('.price-link strong')).toHaveText(actual!)
      if (variant === 'holo') {
        await expect(price.locator('strong')).not.toHaveText('75,00 €')
        await expect(modal.locator('.market-low')).toContainText('75,00 €')
      }
      await priceEffects(page)
      expect(requests.filter((key) => key === `es:${detail.id}`)).toHaveLength(baseline)
      await page.keyboard.press('Escape')
      await expect(modal).toHaveCount(0)
    }
    await expect(priceRow(page, card.name).getByRole('spinbutton')).toHaveValue('90')
    await page.clock.setFixedTime(now + 4 * 60 * 1000)
    const baseline = requests.filter((key) => key === `es:${card.id}`).length
    await page.getByRole('navigation', { name: 'Mis listas privadas' }).getByRole('button', { name: /Otra lista/ }).click()
    const reused = priceRow(page, card.name)
    await reused.scrollIntoViewIfNeeded()
    await expect(reused.locator('.wishlist-current-price strong')).toHaveText('2,50 €')
    await expect(reused.getByRole('spinbutton')).toHaveValue('90')
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await reused.locator('.wishlist-card-open').click()
    await expect(page.getByRole('dialog').locator('.price-link strong')).toHaveText('2,50 €')
    await priceEffects(page)
    expect(requests.filter((key) => key === `es:${card.id}`)).toHaveLength(baseline)
    expect(state.items.map((item) => item.target_price)).toEqual([90, null, 90])
    expect(state.writes).toBe(0)
    expect(state.collectionWrites).toBe(0)
  })

  test('loading con gate, error sin cero y recuperación al abrir la ficha', async ({ page }) => {
    const state = await setup(page)
    state.lists = [firstList]; state.items = [priceItem(card, 'es', firstId, 90)]
    const gate = deferred(), started = deferred()
    let fail = true
    await mockCurrentPrices(page, () => {
      started.resolve()
      return { detail: card, status: fail ? 503 : undefined, gate: gate.promise }
    })
    await enterPriceList(page)
    await page.clock.install()
    const row = priceRow(page, card.name), price = row.locator('.wishlist-current-price')
    await row.scrollIntoViewIfNeeded()
    await started.promise
    await expect(price).toHaveAttribute('data-state', 'loading')
    await expect(price.locator('strong')).toHaveText('…')
    await expect(row.getByRole('spinbutton')).toHaveValue('90')
    const failure = page.waitForResponse((response) => response.url().endsWith(`/cards/${card.id}`) && response.status() === 503)
    gate.resolve()
    await (await failure).finished()
    await priceEffects(page)
    await page.clock.fastForward(1100) // Un único reintento de React Query, sin dormir un segundo real.
    await expect(price).toHaveAttribute('data-state', 'error')
    await expect(price.locator('strong')).toHaveText('No disponible')
    await expect(price).toHaveAttribute('title', /Abre la carta para reintentar/)
    await expect(price).not.toContainText('0,00')
    await expect(price).not.toContainText('Sin precio')
    fail = false
    await row.locator('.wishlist-card-open').click()
    await expect(page.getByRole('dialog').locator('.price-link strong')).toHaveText('2,50 €')
    await page.keyboard.press('Escape')
    await expect(price).toHaveAttribute('data-state', 'ready')
    await expect(price.locator('strong')).toHaveText('2,50 €')
    await expect(row.getByRole('spinbutton')).toHaveValue('90')
    expect(state.items[0].target_price).toBe(90)
    expect(state.writes).toBe(0)
    expect(state.collectionWrites).toBe(0)
  })

  test('datos cacheados conservan el importe y advierten si falla la actualización tras cinco minutos', async ({ page }) => {
    const state = await setup(page)
    state.lists = [firstList]; state.items = [priceItem(holoOnlyCard, 'es', firstId, 90)]
    let fail = false
    const gate = deferred(), started = deferred()
    const requests = await mockCurrentPrices(page, () => {
      if (fail) started.resolve()
      return { detail: holoOnlyCard, status: fail ? 503 : undefined, gate: fail ? gate.promise : undefined }
    })
    await enterPriceList(page)
    await page.clock.install()
    const row = priceRow(page, holoOnlyCard.name), price = row.locator('.wishlist-current-price')
    await row.scrollIntoViewIfNeeded()
    await expect(price.locator('strong')).toHaveText('134,40 €')
    await priceEffects(page)
    const baseline = requests.length
    fail = true
    // Cambiar Date no dispara los timeouts de fetch ni los de autenticación.
    await page.clock.setSystemTime(new Date(Date.now() + 5 * 60 * 1000 + 1000))
    // React Query escucha window; un evento sintético en document no burbujea por defecto.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await started.promise
    await expect(price.locator('strong')).toHaveText('134,40 €')
    const failure = page.waitForResponse((response) => response.url().endsWith(`/cards/${holoOnlyCard.id}`) && response.status() === 503)
    gate.resolve()
    await (await failure).finished()
    await priceEffects(page)
    await page.clock.fastForward(1100)
    await expect(price).toHaveAttribute('data-state', 'error')
    await expect(price.locator('strong')).toHaveText('134,40 €')
    await expect(price).toHaveAttribute('title', /Última referencia disponible; no se pudo actualizar/)
    expect(requests.length).toBeGreaterThan(baseline)
    fail = false
    await row.locator('.wishlist-card-open').click()
    await expect(price).toHaveAttribute('data-state', 'ready')
    await expect(price).not.toHaveAttribute('title', /no se pudo actualizar/)
    await expect(page.getByRole('dialog').locator('.price-link strong')).toHaveText('134,40 €')
    expect(state.items[0].target_price).toBe(90)
    expect(state.writes).toBe(0)
    expect(state.collectionWrites).toBe(0)
  })

  test('la misma id en español e inglés mantiene precios y cachés independientes', async ({ page }) => {
    const state = await setup(page)
    state.lists = [firstList]; state.items = [priceItem(card), priceItem(card, 'en')]
    const english: Card = { ...card, pricing: { cardmarket: { unit: 'EUR', trend: 19.95 } } }
    const requests = await mockCurrentPrices(page, (language) => ({ detail: language === 'en' ? english : card }))
    await enterPriceList(page)
    for (const [language, code, amount] of [['Español', 'es', '2,50 €'], ['Inglés', 'en', '19,95 €']] as const) {
      const row = priceRow(page, card.name, language)
      await row.scrollIntoViewIfNeeded()
      await expect(row.locator('.wishlist-current-price strong')).toHaveText(amount)
      await priceEffects(page)
      const baseline = requests.filter((key) => key === `${code}:${card.id}`).length
      expect(baseline).toBeGreaterThan(0)
      await row.locator('.wishlist-card-open').click()
      const modal = page.getByRole('dialog')
      await expect(modal.locator('.detail-art .pill')).toContainText(language)
      await expect(modal.locator('.price-link strong')).toHaveText(amount)
      await priceEffects(page)
      expect(requests.filter((key) => key === `${code}:${card.id}`)).toHaveLength(baseline)
      await page.keyboard.press('Escape')
    }
    await expect(priceRow(page, card.name).locator('.wishlist-current-price strong')).toHaveText('2,50 €')
    expect(new Set(requests)).toEqual(new Set([`es:${card.id}`, `en:${card.id}`]))
    expect(state.writes).toBe(0)
    expect(state.collectionWrites).toBe(0)
  })

  test('quote null muestra Sin precio, no cero ni low, y respeta la variante inicial de la ficha', async ({ page }) => {
    const state = await setup(page)
    const details: Card[] = [
      { ...card, id: 'test-reverse', name: 'Solo reverse', variants: { reverse: true } },
      { ...card, id: 'test-first', name: 'Primera edición', variants: { firstEdition: true } },
      { ...card, id: 'test-usd', name: 'Moneda USD', pricing: { cardmarket: { unit: 'USD', trend: 134.4, low: 75 } } },
      { ...card, id: 'test-zero', name: 'Referencia cero', pricing: { cardmarket: { unit: 'EUR', trend: 0, low: 75 } } },
    ]
    state.lists = [firstList]; state.items = details.map((detail) => priceItem(detail))
    await mockCurrentPrices(page, (_language, id) => ({ detail: details.find((detail) => detail.id === id)! }))
    await enterPriceList(page)
    for (const [index, detail] of details.entries()) {
      const row = priceRow(page, detail.name), price = row.locator('.wishlist-current-price')
      await row.scrollIntoViewIfNeeded()
      await expect(price).toHaveAttribute('data-state', 'ready')
      await expect(price.locator('strong')).toHaveText('Sin precio')
      await row.locator('.wishlist-card-open').click()
      const modal = page.getByRole('dialog')
      await expect(modal.getByRole('combobox', { name: 'Variante', exact: true })).toHaveValue(['reverse', 'firstEdition', 'normal', 'normal'][index])
      await expect(modal.locator('.price-link strong')).toHaveText('Sin precio')
      await page.keyboard.press('Escape')
    }
    expect(state.writes).toBe(0)
    expect(state.collectionWrites).toBe(0)
  })

  test('muchas cartas fuera de pantalla no consultan detalle hasta aproximarse al viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    const state = await setup(page)
    const details = Array.from({ length: 36 }, (_, index): Card => ({ ...card, id: `lazy-${index}`, name: `Carta diferida ${index}` }))
    state.lists = [firstList]; state.items = details.map((detail) => priceItem(detail))
    const requests = await mockCurrentPrices(page, (_language, id) => ({ detail: details.find((detail) => detail.id === id)! }))
    await enterPriceList(page)
    await expect(page.locator('.wishlist-card')).toHaveCount(36)
    const first = priceRow(page, details[0].name), last = priceRow(page, details[35].name)
    await first.scrollIntoViewIfNeeded()
    await expect(first.locator('.wishlist-current-price strong')).toHaveText('2,50 €')
    await priceEffects(page)
    const lastTop = await last.locator('.wishlist-current-price').evaluate((element) => element.getBoundingClientRect().top)
    expect(lastTop).toBeGreaterThan(800 + 120)
    expect(requests).not.toContain('es:lazy-35')
    await expect(last.locator('.wishlist-current-price strong')).toHaveText('…')
    expect(new Set(requests).size).toBeLessThan(36)
    // Dentro del rootMargin de 120px, todavía por debajo de la pantalla.
    await last.locator('.wishlist-current-price').evaluate((element) => {
      window.scrollTo(0, scrollY + element.getBoundingClientRect().top - innerHeight - 60)
    })
    await expect(last.locator('.wishlist-current-price strong')).toHaveText('2,50 €')
    const nearTop = await last.locator('.wishlist-current-price').evaluate((element) => element.getBoundingClientRect().top)
    expect(nearTop).toBeGreaterThanOrEqual(800)
    expect(nearTop).toBeLessThan(800 + 120)
    expect(requests).toContain('es:lazy-35')
    expect(state.writes).toBe(0)
    expect(state.collectionWrites).toBe(0)
  })

  for (const width of [320, 390, 768, 1365]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`nombre y precio a la derecha sin overflow: ${width}px ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 950 })
        const state = await setup(page)
        const long: Card = { ...card, id: 'layout-long', name: 'Pikachu edición especial de coleccionista con un nombre extraordinariamente largo', pricing: { cardmarket: { unit: 'EUR', trend: 1234567.89 } } }
        const details = [card, holoOnlyCard, long]
        state.lists = [firstList]; state.items = details.map((detail) => priceItem(detail, 'es', firstId, 90))
        await mockCurrentPrices(page, (_language, id) => ({ detail: details.find((detail) => detail.id === id)! }))
        await enterPriceList(page)
        if (theme === 'dark') await page.getByRole('button', { name: 'Activar modo nocturno', exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        for (const [index, detail] of details.entries()) {
          const row = priceRow(page, detail.name)
          await row.scrollIntoViewIfNeeded()
          await expect(row.locator('.wishlist-current-price strong')).toHaveText(['2,50 €', '134,40 €', '1.234.567,89 €'][index])
          await expect(row.getByRole('spinbutton')).toHaveValue('90')
          const geometry = await row.evaluate((element) => {
            const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect()
            const name = box('.wishlist-card-name'), price = box('.wishlist-current-price'), heading = box('.wishlist-card-heading')
            return {
              nameRight: name.right, priceLeft: price.left, priceRight: price.right, headingRight: heading.right,
              nameTop: name.top, priceTop: price.top,
              overflows: [element, ...element.querySelectorAll('.wishlist-card-open, .wishlist-card-heading, .wishlist-card-name, .wishlist-current-price, .wishlist-current-price strong')].map((node) => node.scrollWidth - node.clientWidth),
              targetInsideButton: Boolean(element.querySelector('.wishlist-card-open .wishlist-target-price')),
              documentOverflow: document.documentElement.scrollWidth - innerWidth,
            }
          })
          expect(geometry.priceLeft).toBeGreaterThanOrEqual(geometry.nameRight)
          expect(Math.abs(geometry.nameTop - geometry.priceTop)).toBeLessThanOrEqual(1)
          expect(geometry.priceRight).toBeLessThanOrEqual(geometry.headingRight + 1)
          expect(geometry.overflows.every((overflow) => overflow <= 1)).toBe(true)
          expect(geometry.documentOverflow).toBeLessThanOrEqual(1)
          expect(geometry.targetInsideButton).toBe(false)
          if ((width === 390 && theme === 'dark') || width === 1365) {
            const path = testInfo.outputPath(`actual-${width}-${theme}-${detail.id}.png`)
            await row.screenshot({ path, animations: 'disabled' })
            await testInfo.attach(`Actual ${width} ${theme} ${detail.id}`, { path, contentType: 'image/png' })
          }
        }
        expect(state.writes).toBe(0)
        expect(state.collectionWrites).toBe(0)
      })
    }
  }
})
