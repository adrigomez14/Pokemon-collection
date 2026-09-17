import { test, expect, type Page } from '@playwright/test'
import { card, entry } from '../fixtures'
import type { Wishlist, WishlistItem } from '../../src/lib/wishlists'

const alice = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'alice@example.com', is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: '2026-09-17T00:00:00Z' }
const bob = { ...alice, id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com' }
const firstId = '33333333-3333-4333-8333-333333333333'
const snapshot = { id: card.id, localId: card.localId, name: card.name, image: 'https://assets.tcgdex.net/en/sv/sv03.5/200' }
const firstList = { id: firstId, user_id: alice.id, name: 'Favoritas', created_at: '2026-09-17T00:00:00Z' }
const wished = { list_id: firstId, user_id: alice.id, card_id: card.id, language: 'es' as const, card_snapshot: snapshot, created_at: firstList.created_at }
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
        if (!state.items.some((row) => row.list_id === item.list_id && row.card_id === item.card_id && row.language === item.language)) state.items.push({ ...item, created_at: firstList.created_at })
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
      expect(positions[0].y).toBeLessThan(1000)
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
