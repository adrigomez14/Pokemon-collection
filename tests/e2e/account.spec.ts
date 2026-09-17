import { test, expect } from '@playwright/test'
import { readSheet } from 'read-excel-file/node'
import { card, entry } from '../fixtures'
import type { Entry } from '../../src/lib/models'

test('inicia sesión, guarda, recarga, edita, exporta, importa y elimina', async ({ page }, testInfo) => {
  // Emula únicamente el transporte HTTP; la seguridad SQL se prueba con Postgres en database.test.ts.
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'coleccion@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-09-16T00:00:00Z' }
  let rows: Entry[] = []
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'test-signature'].join('.')
  await page.route('https://pokefolio-test.supabase.co/**', async (route) => {
    const request = route.request(); const url = new URL(request.url())
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: { access_token: token, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user } })
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: user })
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/rpc/add_collection_entry')) {
      const input = request.postDataJSON().entry
      rows.push({ ...input, id: '33333333-3333-4333-8333-333333333333', user_id: user.id, updated_at: new Date().toISOString() })
      return route.fulfill({ json: null })
    }
    if (url.pathname.endsWith('/rpc/import_collection')) {
      rows = request.postDataJSON().entries.map((input: typeof entry) => ({ ...input, id: '33333333-3333-4333-8333-333333333333', user_id: user.id, updated_at: new Date().toISOString() }))
      return route.fulfill({ json: null })
    }
    if (url.pathname.endsWith('/collection_entries')) {
      if (request.method() === 'PATCH') {
        rows = rows.map((row) => ({ ...row, ...request.postDataJSON() }))
        return route.fulfill({ json: { id: rows[0].id } })
      }
      if (request.method() === 'DELETE') { rows = []; return route.fulfill({ status: 204 }) }
      return route.fulfill({ json: rows })
    }
    return route.fulfill({ status: 404 })
  })
  await page.route('https://api.tcgdex.net/v2/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/rarities')) return route.fulfill({ json: ['Common'] })
    if (/\/(categories|types|rarities)$/.test(path)) return route.fulfill({ json: [] })
    return route.fulfill({ json: path.endsWith('/sets') ? [{ id: 'base1', name: 'Base Set', cardCount: { total: 102, official: 102 } }] : /\/cards\//.test(path) ? card : [card] })
  })
  await page.route('https://assets.tcgdex.net/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Mi cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico').fill(user.email)
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only-123')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  const summary = page.getByRole('region', { name: 'Tu archivo de entrenador', exact: true })
  await expect(summary).toContainText('Una favorita por descubrir')
  await expect(summary.getByRole('progressbar')).toHaveAttribute('value', '0')
  const viewport = page.viewportSize()!
  for (const width of [320, 390, 768, 1365]) {
    await page.setViewportSize({ width, height: 950 })
    await expect(summary.getByRole('button', { name: 'Explorar catálogo' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize(viewport)
  await summary.screenshot({ path: testInfo.outputPath('coleccion-vacia.png'), scale: 'css', style: '.header, .skip-link { visibility: hidden !important; }' })
  await summary.getByRole('button', { name: 'Explorar catálogo' }).click()
  await expect(page.getByRole('region', { name: 'Tu aventura Pokémon TCG' })).toBeVisible()
  await page.getByRole('button', { name: /base1-58.*Pikachu/ }).click()
  await page.getByLabel('Ejemplares que añadir').fill('2')
  const productUrl = 'https://www.cardmarket.com/es/Pokemon/Products/Singles/Base-Set/Pikachu?language=4'
  await page.getByLabel('Enlace del producto en Cardmarket (opcional)').fill(productUrl)
  await page.getByRole('button', { name: 'Añadir a mi colección' }).click()
  await expect(page.getByRole('status')).toContainText('Carta añadida')
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await expect(page.getByRole('button', { name: /2 ×.*Pikachu/ })).toBeVisible()
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: /Mi colección/ }).click()
  await page.getByRole('button', { name: /2 ×.*Pikachu/ }).click()
  await expect(page.getByLabel('Enlace del producto en Cardmarket (opcional)')).toHaveValue(productUrl)
  await page.getByLabel('Cantidad total').fill('3')
  await page.getByLabel('Valor manual / carta (€)').fill('12.50')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Pikachu' })).toContainText('12,50 €')
  await expect(page.getByRole('link', { name: /12,50.*Ver producto en Cardmarket/ })).toHaveAttribute('href', productUrl)
  // El enlace abre Cardmarket en otra pestaña, no el diálogo de edición.
  await page.context().route('https://www.cardmarket.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Destino simulado de prueba</p>' }))
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: /12,50.*Ver producto en Cardmarket/ }).click()
  const popup = await popupPromise
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await popup.close()
  await page.getByRole('button', { name: 'Actualizar precios', exact: true }).click()
  await expect(page.getByRole('link', { name: /12,50.*Ver producto en Cardmarket/ })).toHaveAttribute('href', productUrl)
  await expect(summary.getByRole('complementary', { name: 'Carta destacada de tu colección' })).toContainText('12,50')
  await expect(summary).toContainText('3 / 3')
  await expect(summary).toContainText('Valor manual · por ejemplar')
  await expect(summary).toContainText('Imagen no disponible')
  await summary.screenshot({ path: testInfo.outputPath('coleccion-con-cartas.png'), scale: 'css', style: '.header, .skip-link { visibility: hidden !important; }' })
  // Las estadísticas generales conservan su región y la valoración de todas las copias.
  await expect(page.getByRole('region', { name: 'Resumen de tu colección' }).filter({ has: page.getByText('Valoración orientativa', { exact: true }) })).toContainText('37,50 €')
  // Excel incluye la colección completa, incluso cuando el filtro oculta el registro.
  await page.getByLabel('Buscar en mi colección').fill('no-coincide')
  await expect(page.getByRole('heading', { name: 'Sin coincidencias' })).toBeVisible()
  const excelDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar Excel', exact: true }).click()
  const excel = await excelDownload
  expect(excel.suggestedFilename()).toMatch(/^pokemon-collection-.*\.xlsx$/)
  const excelPath = await excel.path()
  expect(excelPath).not.toBeNull()
  const sheet = await readSheet(excelPath!, 'Mi colección')
  expect(sheet[1].slice(0, 5)).toEqual(['Pikachu', 'Base Set', 12.5, 3, 37.5])
  await page.getByLabel('Buscar en mi colección').fill('')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^pokemon-collection-.*\.json$/)
  await page.locator('input[type=file]').setInputFiles({ name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, exportedAt: '2026-09-16', entries: [{ ...entry, quantity: 4 }] })) })
  await page.getByRole('button', { name: 'Confirmar importación' }).click()
  await expect(page.getByRole('button', { name: /4 ×.*Pikachu/ })).toBeVisible()
  await page.getByRole('button', { name: /4 ×.*Pikachu/ }).click()
  await page.getByRole('button', { name: 'Eliminar de mi colección' }).click()
  await page.getByRole('button', { name: 'Sí, eliminar' }).click()
  await expect(page.getByRole('heading', { name: 'El primer hueco es para tu favorita' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Exportar Excel', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tu colección empieza con una carta' })).toBeVisible()
})
