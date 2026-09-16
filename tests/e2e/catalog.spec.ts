import { test, expect } from '@playwright/test'
import { card } from '../fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url())
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
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