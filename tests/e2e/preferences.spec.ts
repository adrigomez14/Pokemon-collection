import { test, expect, type Page } from '@playwright/test'

const aliceId = '11111111-1111-4111-8111-111111111111'
const bobId = '22222222-2222-4222-8222-222222222222'
const listId = '33333333-3333-4333-8333-333333333333'
const created = '2026-09-17T00:00:00Z'
const cards = Array.from({ length: 53 }, (_, i) => ({ id: `base1-${i + 1}`, localId: String(i + 1), name: `Carta ${i + 1}`, rarity: i === 0 ? 'Secret Rare' : 'Common' }))
const rareOrder = [cards[0], ...cards.slice(1).reverse()].map((card) => card.name)
const nav = (page: Page) => page.getByRole('navigation', { name: 'Navegación principal', exact: true })
const results = (page: Page) => page.getByLabel('Resultados del catálogo').getByRole('heading')
const user = (id = aliceId, size = 12) => ({ id, aud: 'authenticated', role: 'authenticated', email: id === aliceId ? 'alice@example.com' : 'bob@example.com', is_anonymous: false, app_metadata: {}, user_metadata: { language: 'es', catalog_layout: 'grid', page_size: size, theme: 'light', price_alert_email: false }, created_at: created })
function session(account: ReturnType<typeof user>) {
  const now = Math.floor(Date.now() / 1000)
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: account.id, exp: now + 3600 })).toString('base64url'), 'test-signature'].join('.')
  return { user: account, access_token: token, refresh_token: 'test-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer' }
}

async function setup(page: Page, size = 12, blocked = false) {
  const state = {
    user: user(aliceId, size), failPreference: false, failAlerts: false, failMark: false,
    holdPreference: false, releasePreference: undefined as (() => void) | undefined,
    holdMark: false, releaseMark: undefined as (() => void) | undefined,
    writes: [] as Record<string, unknown>[], marks: [] as string[][], reads: [] as string[], errors: [] as string[],
    alerts: Array.from({ length: 25 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, user_id: aliceId, list_id: listId, card_id: `base1-${i + 1}`, language: 'es', target_price: 10, observed_price: 9, created_at: created, read_at: null })),
  }
  page.on('pageerror', (error) => state.errors.push(error.message))
  // Ninguna petición externa puede salir del navegador, incluidas rutas no previstas.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') return route.continue()
    return route.abort()
  })
  if (blocked) await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError') } })
  })
  await page.route('https://pokefolio-test.supabase.co/**', async (route) => {
    const request = route.request(), url = new URL(request.url())
    const table = url.pathname.split('/').at(-1)
    if (table === 'token') return route.fulfill({ json: session(state.user) })
    if (table === 'user') {
      if (request.method() === 'PUT') {
        const patch = request.postDataJSON().data
        const owner = structuredClone(state.user)
        state.writes.push(patch)
        if (state.holdPreference) await new Promise<void>((resolve) => { state.releasePreference = resolve })
        if (state.failPreference) return route.abort()
        const updated = { ...owner, user_metadata: { ...owner.user_metadata, ...patch } }
        if (state.user.id === owner.id) state.user = updated
        return route.fulfill({ json: updated })
      }
      return route.fulfill({ json: state.user })
    }
    if (table === 'logout') return route.fulfill({ status: 204 })
    if (table === 'collection_entries' || table === 'wishlist_items') return route.fulfill({ json: [] })
    if (table === 'wishlists') return route.fulfill({ json: [{ id: listId, user_id: state.user.id, name: 'Favoritas', created_at: created }] })
    if (table === 'wishlist_price_alerts') {
      const owner = url.searchParams.get('user_id')?.slice(3) ?? ''
      if (request.method() === 'PATCH') {
        expect(url.searchParams.get('read_at')).toBe('is.null')
        const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',')
        state.marks.push(ids)
        if (state.holdMark) await new Promise<void>((resolve) => { state.releaseMark = resolve })
        if (state.failMark) return route.abort()
        state.alerts = state.alerts.filter((alert) => alert.user_id !== owner || !ids.includes(alert.id))
        return route.fulfill({ status: 204 })
      }
      state.reads.push(owner)
      if (state.failAlerts) return route.fulfill({ status: 403, json: { message: 'offline' } })
      expect(url.searchParams.get('limit')).toBe('20')
      return route.fulfill({ json: state.alerts.filter((alert) => alert.user_id === owner).slice(0, 20) })
    }
    return route.fulfill({ status: 404 })
  })
  await page.route('https://api.tcgdex.net/v2/**', (route) => {
    const url = new URL(route.request().url()), path = url.pathname
    const set = { id: 'base1', name: 'Base Set', serie: { id: 'base' }, cardCount: { total: cards.length, official: cards.length } }
    if (path.endsWith('/sets')) return route.fulfill({ json: [set] })
    if (path.endsWith('/sets/base1')) return route.fulfill({ json: { ...set, cards } })
    if (path.endsWith('/rarities')) return route.fulfill({ json: ['Common', 'Secret Rare'] })
    if (/\/(categories|types)$/.test(path)) return route.fulfill({ json: [] })
    if (path.endsWith('/cards')) {
      const rarity = url.searchParams.get('rarity')?.slice(3).split('|')
      let found = rarity ? cards.filter((card) => rarity.includes(card.rarity)) : cards
      const size = Number(url.searchParams.get('pagination:itemsPerPage'))
      if (size) { const offset = (Number(url.searchParams.get('pagination:page')) - 1) * size; found = found.slice(offset, offset + size) }
      return route.fulfill({ json: found })
    }
    return route.fulfill({ status: 404 })
  })
  await page.goto('/')
  await expect(results(page)).toHaveCount(24)
  if (!blocked) {
    await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
    await page.getByLabel('Correo electrónico', { exact: true }).fill(state.user.email)
    await page.getByLabel('Contraseña', { exact: true }).fill('only-mocked-password-123')
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(results(page)).toHaveCount(size)
  }
  return state
}

async function account(page: Page) {
  await nav(page).getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: 'Gestionar cuenta', exact: true }).click()
  return page.getByRole('dialog')
}

async function broadcastAccount(page: Page, account: ReturnType<typeof user> | null) {
  await page.evaluate((next) => {
    if (next) localStorage.setItem('sb-pokefolio-test-auth-token', JSON.stringify(next))
    else localStorage.removeItem('sb-pokefolio-test-auth-token')
    const channel = new BroadcastChannel('sb-pokefolio-test-auth-token')
    channel.postMessage({ event: next ? 'SIGNED_IN' : 'SIGNED_OUT', session: next }); channel.close()
  }, account ? session(account) : null)
}

test('USER_UPDATED, TOKEN_REFRESHED y SIGNED_IN de la misma cuenta conservan el catálogo; reload hidrata la cuenta', async ({ page }) => {
  const state = await setup(page)
  await page.getByLabel('Idioma de las cartas').selectOption('ja')
  await page.getByRole('combobox', { name: 'Expansión', exact: true }).selectOption('base1')
  await page.getByRole('textbox', { name: 'Nombre de carta' }).fill('Carta')
  await page.getByRole('button', { name: 'Buscar cartas', exact: true }).click()
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await page.getByRole('button', { name: 'Activar modo nocturno', exact: true }).click()
  await expect.poll(() => state.user.user_metadata.theme).toBe('dark')
  await page.evaluate(async () => {
    const path = '/src/lib/supabase.ts'
    const { supabase } = await import(/* @vite-ignore */ path)
    await supabase.auth.refreshSession()
    await supabase.auth.signInWithPassword({ email: 'alice@example.com', password: 'only-mocked-password-123' })
  })
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('ja')
  await expect(page.getByRole('combobox', { name: 'Expansión', exact: true })).toHaveValue('base1')
  await expect(page.getByRole('textbox', { name: 'Nombre de carta' })).toHaveValue('Carta')
  await expect(page.locator('.pagination')).toContainText('Página 2')
  await expect(page.getByRole('button', { name: 'Ver lista', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('es')
  await expect(page.getByRole('textbox', { name: 'Nombre de carta' })).toHaveValue('')
  await expect(page.locator('.pagination')).toContainText('Página 1')
  await expect(page.getByRole('button', { name: 'Ver cuadrícula', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Activar modo claro', exact: true })).toBeVisible()
  await expect(results(page)).toHaveCount(12)
  expect(state.errors).toEqual([])
})

test('guarda las cuatro preferencias y las restaura al recargar', async ({ page }) => {
  const state = await setup(page)
  const modal = await account(page)
  await modal.getByRole('combobox', { name: 'Idioma preferido' }).selectOption('en')
  await modal.getByRole('combobox', { name: 'Vista del catálogo' }).selectOption('list')
  await modal.getByRole('combobox', { name: 'Cartas por página' }).selectOption('48')
  await modal.getByRole('checkbox', { name: 'Activar modo nocturno' }).click()
  await expect.poll(() => state.writes.length).toBe(4)
  await expect(modal.getByText('Guardando preferencias…')).toHaveCount(0)
  await page.reload()
  await nav(page).getByRole('button', { name: 'Explorar', exact: true }).click()
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('en')
  await expect(results(page)).toHaveCount(48)
  await expect(page.getByRole('button', { name: 'Ver lista' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Activar modo claro' })).toBeVisible()
  expect(state.errors).toEqual([])
})

for (const size of [12, 24, 48]) test(`${size} cartas: ordena rarezas antes de paginar y desactiva siguiente al final`, async ({ page }) => {
  const state = await setup(page, size)
  await page.getByRole('combobox', { name: 'Expansión', exact: true }).selectOption('base1')
  await page.getByRole('combobox', { name: 'Ordenar por', exact: true }).selectOption('rarity-desc')
  await expect(results(page)).toHaveText(rareOrder.slice(0, size))
  for (let offset = size; offset < 53; offset += size) {
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await expect(results(page)).toHaveText(rareOrder.slice(offset, offset + size))
  }
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeDisabled()
  const modal = await account(page)
  await modal.getByRole('combobox', { name: 'Cartas por página' }).selectOption(String(size === 12 ? 24 : 12))
  await page.keyboard.press('Escape')
  await nav(page).getByRole('button', { name: 'Explorar', exact: true }).click()
  await expect(page.locator('.pagination')).toContainText('Página 1')
  expect(state.errors).toEqual([])
})

test('localStorage bloqueado no impide explorar ni cambiar tema/idioma', async ({ page }) => {
  const state = await setup(page, 12, true)
  await page.getByLabel('Idioma de las cartas').selectOption('ja')
  await page.getByRole('button', { name: 'Activar modo nocturno' }).click()
  await expect(results(page)).toHaveCount(24)
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('ja')
  await expect(page.getByRole('button', { name: 'Activar modo claro' })).toBeVisible()
  expect(state.errors).toEqual([])
})

test('rechazos de preferencias y correo son visibles; pendiente bloquea el doble envío', async ({ page }) => {
  const state = await setup(page)
  state.failPreference = true
  const modal = await account(page)
  await modal.getByRole('combobox', { name: 'Cartas por página' }).selectOption('24')
  await expect(modal.getByRole('alert')).toContainText('no se pudo guardar en tu cuenta')
  await page.keyboard.press('Escape')
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Enviarme también un correo' })
  await expect(checkbox).toBeEnabled()
  state.holdPreference = true
  await checkbox.click()
  await expect.poll(() => state.writes.length).toBe(2)
  await expect(checkbox).toBeDisabled()
  await checkbox.dispatchEvent('change')
  expect(state.writes).toHaveLength(2)
  state.releasePreference?.()
  await expect(page.getByRole('alert').filter({ hasText: 'No se pudo guardar la preferencia de correo' })).toBeVisible()
  await expect(checkbox).not.toBeChecked()
  state.failPreference = false; state.holdPreference = false
  await checkbox.click()
  await expect(checkbox).toBeChecked()
  await expect(page.getByText(/se ejecuta a diario/)).toContainText('reintentos')
  expect(state.errors).toEqual([])
})

test('campana muestra errores, bloquea duplicados y marca solo las 20 visibles de 25', async ({ page }) => {
  const state = await setup(page)
  state.failAlerts = true
  await page.reload()
  await page.getByRole('button', { name: /^Notificaciones/ }).click()
  const bell = page.getByRole('dialog', { name: 'Notificaciones de precios' })
  await expect(bell.getByRole('alert')).toContainText('No se pudieron cargar')
  await expect(bell).not.toContainText('No tienes avisos nuevos')
  state.failAlerts = false
  await bell.getByRole('button', { name: 'Reintentar notificaciones' }).click()
  await expect(bell.getByRole('button', { name: 'Marcar como leídas' })).toBeEnabled()
  const seen = state.alerts.slice(0, 20).map((alert) => alert.id)
  state.failMark = true; state.holdMark = true
  await bell.getByRole('button', { name: 'Marcar como leídas' }).click()
  await expect.poll(() => state.marks.length).toBe(1)
  await expect(bell.getByRole('button', { name: 'Marcando…' })).toBeDisabled()
  state.releaseMark?.()
  await expect(bell.getByRole('alert')).toContainText('No se pudieron marcar')
  state.failMark = false; state.holdMark = false
  await bell.getByRole('button', { name: 'Marcar como leídas' }).click()
  await expect(bell).toContainText('base1-25')
  expect(state.marks).toEqual([seen, seen])
  expect(state.alerts).toHaveLength(5)
  await expect(bell).not.toContainText('base1-1 ha alcanzado')
  expect(state.errors).toEqual([])
})

test('cambios rápidos de tema se guardan en orden sin pisar el idioma local', async ({ page }) => {
  const state = await setup(page)
  await page.getByLabel('Idioma de las cartas').selectOption('ja')
  state.holdPreference = true
  await page.getByRole('button', { name: 'Activar modo nocturno' }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  await page.getByRole('button', { name: 'Activar modo claro' }).click()
  expect(state.writes).toEqual([{ theme: 'dark' }])
  state.holdPreference = false; state.releasePreference?.()
  await expect.poll(() => state.writes).toEqual([{ theme: 'dark' }, { theme: 'light' }])
  await expect(page.getByText('Guardando preferencias…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Activar modo nocturno' })).toBeVisible()
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('ja')
  expect(state.user.user_metadata.theme).toBe('light')
  expect(state.errors).toEqual([])
})

test('una respuesta antigua tras cambio de cuenta no reabre la campana ni invalida la otra cuenta', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: /^Notificaciones/ }).click()
  state.holdMark = true
  await page.getByRole('button', { name: 'Marcar como leídas' }).click()
  await expect.poll(() => state.marks.length).toBe(1)
  state.user = user(bobId)
  await page.evaluate((next) => {
    // Simula el transporte entre pestañas del SDK; no usa servicios ni API privada.
    localStorage.setItem('sb-pokefolio-test-auth-token', JSON.stringify(next))
    const channel = new BroadcastChannel('sb-pokefolio-test-auth-token')
    channel.postMessage({ event: 'SIGNED_IN', session: next }); channel.close()
  }, session(state.user))
  await expect(page.locator('.account-email')).toHaveText('bob@example.com')
  await expect(page.getByRole('dialog', { name: 'Notificaciones de precios' })).toHaveCount(0)
  await expect.poll(() => state.reads.includes(bobId)).toBe(true)
  const reads = state.reads.filter((id) => id === bobId).length
  state.releaseMark?.()
  await page.getByRole('button', { name: /^Notificaciones/ }).click()
  await expect(page.getByRole('dialog', { name: 'Notificaciones de precios' })).toContainText('No tienes avisos nuevos')
  expect(state.reads.filter((id) => id === bobId)).toHaveLength(reads)
  expect(state.errors).toEqual([])
})

for (const fail of [false, true]) test(`preferencia pendiente con respuesta ${fail ? 'fallida' : 'correcta'} no afecta a la siguiente cuenta ni envía su cola`, async ({ page }) => {
  const state = await setup(page)
  state.holdPreference = true; state.failPreference = fail
  await page.getByRole('button', { name: 'Activar modo nocturno' }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  await page.getByRole('button', { name: 'Activar modo claro' }).click()
  state.user = user(bobId, 48)
  state.user.user_metadata.language = 'en'
  await broadcastAccount(page, state.user)
  await expect(page.locator('.account-email')).toHaveText('bob@example.com')
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('en')
  await expect(results(page)).toHaveCount(48)
  state.holdPreference = false; state.releasePreference?.()
  // Esperar el transporte tardío, no un timeout arbitrario.
  await page.evaluate(async () => {
    const path = '/src/lib/preferences.ts'
    const { saveAccountMetadata } = await import(/* @vite-ignore */ path)
    await saveAccountMetadata(null, '', {}, () => false)
  })
  await expect(page.locator('.account-email')).toHaveText('bob@example.com')
  await expect(page.getByRole('button', { name: 'Activar modo nocturno' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Guardando preferencias…')).toHaveCount(0)
  expect(state.writes).toEqual([{ theme: 'dark' }])
  expect(state.errors).toEqual([])
})

test('correo pendiente tras logout y nueva cuenta no escribe su caché ni restaura la identidad anterior', async ({ page }) => {
  const state = await setup(page)
  await nav(page).getByRole('button', { name: 'Deseos', exact: true }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Enviarme también un correo' })
  await expect(checkbox).toBeEnabled()
  state.holdPreference = true
  await checkbox.click()
  await expect.poll(() => state.writes.length).toBe(1)
  await broadcastAccount(page, null)
  await expect(page.getByRole('button', { name: 'Mi cuenta', exact: true })).toBeVisible()
  await expect(checkbox).toHaveCount(0)
  state.user = user(bobId)
  await broadcastAccount(page, state.user)
  await expect(page.locator('.account-email')).toHaveText('bob@example.com')
  state.holdPreference = false; state.releasePreference?.()
  await expect(checkbox).toBeEnabled()
  await expect(checkbox).not.toBeChecked()
  await expect(page.locator('.account-email')).toHaveText('bob@example.com')
  await expect(page.getByText('Guardando preferencia de correo…')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(state.user.user_metadata.price_alert_email).toBe(false)
  expect(state.errors).toEqual([])
})
