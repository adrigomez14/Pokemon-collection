import { test, expect } from '@playwright/test'
import { card } from '../fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/sets')) return route.fulfill({ json: [{ id: 'base1', name: 'Base Set', cardCount: { total: 102, official: 102 } }] })
    const detail = /\/cards\//.test(url.pathname)
    const noResults = url.searchParams.get('name') === 'no-existe'
    await route.fulfill({ json: detail ? card : noResults ? [] : [card, { id: 'base1-1', name: 'Sin imagen', localId: '1', image: null }] })
  })
  await page.route('https://assets.tcgdex.net/**', (route) => route.abort())
})

test('muestra catálogo, ficha, precio y enlace real de búsqueda', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Explora el catálogo' })).toBeVisible()
  await page.getByRole('button', { name: /base1-58.*Pikachu/ }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByRole('heading', { name: 'Pikachu' })).toBeVisible()
  await expect(modal.getByText('2,50 €', { exact: true })).toBeVisible()
  await expect(modal.getByRole('link', { name: 'Buscar en Cardmarket' })).toHaveAttribute('href', /www\.cardmarket\.com/)
  await expect(modal.getByRole('link', { name: 'Buscar en Cardmarket' })).toHaveAttribute('href', /language=4/)
  await modal.getByLabel('Enlace del producto en Cardmarket (opcional)').fill('https://www.cardmarket.com/es/Pokemon/Products/Singles/151/Blastoise-ex-V3-MEW200?language=1')
  await expect(modal.getByRole('link', { name: 'Ver producto en Cardmarket' })).toHaveAttribute('href', 'https://www.cardmarket.com/es/Pokemon/Products/Singles/151/Blastoise-ex-V3-MEW200?language=4')
  await modal.getByLabel('Variante').selectOption('reverse')
  await expect(modal.getByText('Sin precio', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
})

test('filtra, cambia a japonés y no desborda la pantalla', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Nombre de carta').fill('no-existe')
  await page.getByRole('button', { name: 'Buscar cartas' }).click()
  await expect(page.getByRole('heading', { name: 'No encontramos esas cartas' })).toBeVisible()
  await page.getByLabel('Idioma de las cartas').selectOption('ja')
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('ピカチュウ')
  await expect(page.getByRole('button', { name: /base1-58.*Pikachu/ })).toBeVisible()
  await page.getByRole('button', { name: /base1-58.*Pikachu/ }).click()
  await expect(page.getByRole('link', { name: 'Buscar en Cardmarket' })).toHaveAttribute('href', /language=7/)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('incorpora expansiones nuevas al recargar y seleccionarlas elimina el filtro Pikachu', async ({ page }) => {
  let includeNew = false
  await page.route('https://api.tcgdex.net/v2/es/sets', (route) => route.fulfill({ json: [
    { id: 'base1', name: 'Base Set', cardCount: { total: 102, official: 102 } },
    ...(includeNew ? [{ id: 'future-test', name: 'Nueva expansión de prueba', cardCount: { total: 120, official: 100 } }] : []),
  ] }))
  await page.goto('/')
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option')).toHaveCount(2)
  includeNew = true
  await page.getByRole('button', { name: 'Actualizar catálogo', exact: true }).click()
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option')).toHaveCount(3)
  const request = page.waitForRequest((req) => new URL(req.url()).searchParams.get('set.id') === 'eq:future-test')
  await page.getByLabel('Expansión', { exact: true }).selectOption('future-test')
  const url = new URL((await request).url())
  expect(url.searchParams.has('name')).toBe(false)
  expect(url.searchParams.get('pagination:page')).toBe('1')
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('actualiza automáticamente el índice de expansiones con el catálogo abierto', async ({ page }) => {
  await page.clock.install()
  let queries = 0
  let includeNew = false
  await page.route('https://api.tcgdex.net/v2/es/sets', (route) => {
    queries++
    return route.fulfill({ json: [{ id: includeNew ? 'new-test' : 'initial-test', name: 'Expansión de prueba', cardCount: { total: 1, official: 1 } }] })
  })
  await page.goto('/')
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option[value="initial-test"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Actualizar catálogo', exact: true })).toBeEnabled()
  const initialQueries = queries
  includeNew = true
  await page.clock.fastForward('15:00')
  await expect.poll(() => queries).toBeGreaterThan(initialQueries)
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option[value="new-test"]')).toHaveCount(1)
})

test('un fallo del índice no impide buscar cartas por nombre', async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/es/sets', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('No se pudo actualizar la lista')
  await expect(page.getByRole('button', { name: /base1-58.*Pikachu/ })).toBeVisible()
})

test('no simula guardado sin Supabase y explica la activación', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Activa tu colección en la nube' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir Supabase' })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Mi colección' }).click()
  await expect(page.getByRole('heading', { name: 'Tu colección empieza con una carta' })).toBeVisible()
})

test('presenta errores del proveedor y permite reintentar', async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/**', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No se pudo cargar el catálogo' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})