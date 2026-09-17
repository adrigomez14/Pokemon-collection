import { test, expect, type Page } from '@playwright/test'
import { card, entry } from '../fixtures'
import type { Entry } from '../../src/lib/models'

const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'album@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-09-17T00:00:00Z' }
const other = { ...card, id: 'base1-1', localId: '1', name: 'Bulbasaur', rarity: 'Rara' }
const catalogCards = [{ ...card, rarity: 'Común' }, other]

async function setup(page: Page) {
  let rows: Entry[] = [
    { ...entry, id: '22222222-2222-4222-8222-222222222222', user_id: user.id, updated_at: '2026-09-17', language: 'es', quantity: 3 },
    { ...entry, id: '33333333-3333-4333-8333-333333333333', user_id: user.id, updated_at: '2026-09-17', language: 'es', variant: 'holo', quantity: 1 },
    { ...entry, id: '44444444-4444-4444-8444-444444444444', user_id: user.id, updated_at: '2026-09-17', language: 'en', card_id: other.id, card_snapshot: other, quantity: 1 },
  ]
  const now = Math.floor(Date.now() / 1000)
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: now + 3600, amr: [{ method: 'password', timestamp: now }] })).toString('base64url'), 'test-signature'].join('.')
  const state = { failDeletion: true, deleteCalls: 0, changedPassword: false }
  await page.route('https://pokefolio-test.supabase.co/**', async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: { user, access_token: token, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer' } })
    if (url.pathname.endsWith('/user')) {
      if (request.method() === 'PUT') state.changedPassword = Boolean(request.postDataJSON().password)
      return route.fulfill({ json: user })
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/delete_own_account')) {
      state.deleteCalls++
      expect(request.postDataJSON()).toEqual({ confirmation: 'ELIMINAR' })
      expect(request.headers().authorization).toBe(`Bearer ${token}`)
      if (state.failDeletion) return route.fulfill({ status: 403, json: { code: '42501', message: 'test rejection' } })
      rows = []
      return route.fulfill({ json: null })
    }
    if (url.pathname.endsWith('/collection_entries')) {
      if (request.method() === 'PATCH') {
        const id = url.searchParams.get('id')?.slice(3)
        rows = rows.map((row) => row.id === id ? { ...row, ...request.postDataJSON() } : row)
        return route.fulfill({ json: { id } })
      }
      return route.fulfill({ json: rows })
    }
    return route.fulfill({ status: 404 })
  })
  await page.route('https://api.tcgdex.net/v2/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/sets')) {
      expect(url.searchParams.get('serie.id')).toBe('neq:tcgp')
      return route.fulfill({ json: [{ id: 'base1', name: 'Base Set', cardCount: { total: 2, official: 2 } }] })
    }
    if (url.pathname.endsWith('/sets/base1')) return route.fulfill({ json: { id: 'base1', name: 'Base Set', serie: { id: 'base' }, cardCount: { total: 2, official: 2 }, cards: catalogCards } })
    if (url.pathname.endsWith('/rarities')) return route.fulfill({ json: ['Común', 'Rara'] })
    if (/\/(categories|types)$/.test(url.pathname)) return route.fulfill({ json: [] })
    if (/\/cards\//.test(url.pathname)) return route.fulfill({ json: url.pathname.endsWith('/base1-1') ? other : card })
    if (url.pathname.endsWith('/cards')) {
      expect(url.searchParams.has('set.serie.id')).toBe(false)
      expect(url.searchParams.get('set.id')).toBe('eq:base1')
      const rarity = url.searchParams.get('rarity')?.slice(3).split('|')
      return route.fulfill({ json: rarity ? catalogCards.filter((item) => rarity.includes(item.rarity)) : catalogCards })
    }
    return route.fulfill({ status: 404 })
  })
  await page.route('https://assets.tcgdex.net/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico', { exact: true }).fill(user.email)
  await page.getByLabel('Contraseña', { exact: true }).fill('password-test-only-123')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return state
}

test('progreso, faltantes y repetidas respetan idiomas, variantes y edición de cantidades', async ({ page }, testInfo) => {
  await setup(page)
  const progress = page.getByRole('region', { name: 'Progreso de la expansión' })
  await expect(progress).toContainText('1 / 2')
  await expect(progress.getByRole('progressbar')).toHaveAttribute('value', '1')
  await page.getByRole('button', { name: 'Me faltan', exact: true }).click()
  const results = page.getByLabel('Resultados del catálogo')
  await expect(results.getByRole('heading')).toHaveText(['Bulbasaur'])
  await expect(progress).toContainText('1 / 2')
  await page.getByRole('button', { name: 'Ya tengo', exact: true }).click()
  await expect(results.getByRole('heading')).toHaveText(['Pikachu'])
  await page.getByLabel('Idioma de las cartas').selectOption('en')
  await page.getByRole('button', { name: 'Me faltan', exact: true }).click()
  await expect(results.getByRole('heading')).toHaveText(['Pikachu'])
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await page.getByLabel('Mostrar en mi colección').selectOption('duplicates')
  const duplicates = page.getByRole('region', { name: 'Gestión de repetidas' })
  await expect(duplicates).toContainText('2 ejemplares extra')
  await expect(duplicates.getByRole('article')).toHaveCount(1)
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: testInfo.project.name.includes('mobile') ? 390 : 1440, height: 950 })
  await duplicates.screenshot({ path: testInfo.outputPath('repetidas.png'), style: '.header { visibility:hidden !important; }', scale: 'css' })
  await duplicates.getByRole('button', { name: 'Editar 3 × Near Mint' }).click()
  await page.getByLabel('Cantidad total').fill('2')
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(duplicates).toContainText('1 ejemplar extra')
  await page.getByLabel('Expansión de mi colección').selectOption('base1')
  await page.getByLabel('Idioma de mi colección').selectOption('es')
  await expect(progress).toContainText('1 / 2')
  await progress.screenshot({ path: testInfo.outputPath('progreso.png'), style: '.header { visibility:hidden !important; }', scale: 'css' })
  await progress.getByRole('button', { name: 'Me faltan', exact: true }).click()
  await expect(results.getByRole('heading')).toHaveText(['Bulbasaur'])
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Me faltan', exact: true })).toBeDisabled()
  await expect(results.getByRole('heading')).toHaveCount(2)
})

test('la eliminación exige confirmación y contraseña y solo limpia la interfaz tras éxito', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: 'Gestionar cuenta', exact: true }).click()
  const modal = page.getByRole('dialog')
  const submit = modal.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' })
  await expect(submit).toBeDisabled()
  await modal.getByLabel('Contraseña actual para eliminar la cuenta').fill('password-test-only-123')
  await modal.getByLabel('Escribe ELIMINAR para confirmar').fill('ELIMINAR')
  await submit.click()
  await expect(modal.getByRole('alert')).toContainText('No se ha podido confirmar la eliminación')
  expect(state.deleteCalls).toBe(1)
  await expect(modal).toBeVisible()
  state.failDeletion = false
  await modal.getByLabel('Contraseña actual para eliminar la cuenta').fill('password-test-only-123')
  await modal.getByLabel('Escribe ELIMINAR para confirmar').fill('ELIMINAR')
  await submit.click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mi cuenta', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Cuenta eliminada' })).toBeVisible()
  expect(state.deleteCalls).toBe(2)
})

test('gestiona contraseña y conserva la ruta pública de privacidad al recargar', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: 'Gestionar cuenta', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Contraseña actual', { exact: true }).fill('password-test-only-123')
  await modal.getByLabel('Nueva contraseña (mínimo 12 caracteres)').fill('new-password-test-only-123')
  await modal.getByRole('button', { name: 'Guardar nueva contraseña', exact: true }).click()
  await expect(modal.getByRole('status')).toHaveText('Contraseña actualizada.')
  expect(state.changedPassword).toBe(true)
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.getByRole('link', { name: 'Privacidad y tus datos', exact: true }).click()
  await expect(page).toHaveURL(/\/privacidad$/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacidad y tus datos')
  await expect(page.locator('main')).toContainText('seis meses')
  await expect(page.locator('main')).toContainText('pokefolio14@gmail.com')
  await expect(page.locator('main')).not.toContainText(user.email)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('exporta desde la cuenta sin superponer ventanas', async ({ page }) => {
  await setup(page)
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: 'Gestionar cuenta', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar copia JSON', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.json$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('un fallo de colección no se presenta como progreso cero ni activa filtros personales', async ({ page }) => {
  await setup(page)
  // Un error definitivo evita depender del backoff de reintentos 503 del SDK.
  await page.route('https://pokefolio-test.supabase.co/rest/v1/collection_entries?**', (route) => route.fulfill({ status: 403, json: { code: '42501', message: 'test failure' } }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('No podemos determinar qué cartas tienes o te faltan', { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Me faltan', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Progreso de la expansión' })).not.toContainText('0 / 2')
  await expect(page.getByLabel('Resultados del catálogo').getByRole('heading')).toHaveCount(2)
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: 'Gestionar cuenta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Exportar copia JSON', exact: true })).toBeDisabled()
})
