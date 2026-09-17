import { test, expect } from '@playwright/test'
import { card, holoOnlyCard } from '../fixtures'

test('el tema de entrenador conserva controles legibles sin desbordar en distintas pantallas', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Tu aventura Pokémon TCG' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tu aventura empieza')
  await expect(page.locator('.search-panel').getByRole('button', { name: 'Refrescar catálogo', exact: true })).toHaveText('Refrescar')
  await expect(page.locator('.catalog-sync')).toHaveCount(0)
  await expect(page.getByText('expansiones disponibles', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Última consulta:', { exact: false })).toHaveCount(0)
  for (const width of [320, 390, 768, 1365]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: 'Buscar cartas', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: testInfo.project.name === 'mobile' ? 390 : 1365, height: 950 })
  await page.screenshot({ path: testInfo.outputPath('tema-entrenador.png'), fullPage: true })
})

test('inicia sin nombre y consulta la expansión más reciente sin fijar su ID', async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/es/sets?**', (route) => route.fulfill({ json: [
    { id: 'latest-test', name: 'Última expansión', cardCount: { total: 50, official: 50 } },
    { id: 'old-test', name: 'Anterior', cardCount: { total: 100, official: 100 } },
  ] }))
  await page.route('https://api.tcgdex.net/v2/es/cards?**', (route) => {
    const url = new URL(route.request().url())
    const sets = url.searchParams.get('set.id')?.slice(3).split('|')
    return route.fulfill({ json: url.searchParams.has('set.serie.id') ? [] : ['latest-test', 'old-test'].filter((id) => sets?.includes(id)).map((id) => ({ ...card, id: `${id}-58` })) })
  })
  const first = page.waitForRequest((request) => new URL(request.url()).pathname === '/v2/es/cards')
  await page.goto('/')
  const url = new URL((await first).url())
  expect(url.searchParams.has('name')).toBe(false)
  expect(url.searchParams.get('set.id')).toBe('eq:latest-test')
  await expect(page.getByLabel('Ordenar por', { exact: true })).toHaveValue('rarity-desc')
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('')
  await expect(page.getByLabel('Expansión', { exact: true })).toHaveValue('__latest__')
  await expect(page.getByLabel('Resultados del catálogo').getByRole('button')).toHaveCount(1)
  const all = page.waitForRequest((request) => {
    const u = new URL(request.url())
    return u.pathname === '/v2/es/cards' && u.searchParams.get('set.id') === 'eq:old-test|latest-test'
  })
  await page.getByLabel('Expansión', { exact: true }).selectOption('')
  expect(new URL((await all).url()).searchParams.has('set.serie.id')).toBe(false)
  await expect(page.getByLabel('Resultados del catálogo').getByRole('button')).toHaveCount(2)
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('')
})

test.beforeEach(async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url())
    if (/\/sets\/[^/]+$/.test(url.pathname)) return route.fulfill({ json: { id: decodeURIComponent(url.pathname.split('/').at(-1)!), name: 'Base Set', serie: { id: 'base' }, cardCount: { total: 2, official: 2 }, cards: [card, { id: 'base1-1', name: 'Sin imagen', localId: '1', image: null }] } })
    if (url.pathname.endsWith('/sets')) return route.fulfill({ json: [{ id: 'base1', name: 'Base Set', cardCount: { total: 102, official: 102 } }] })
    if (url.pathname.endsWith('/categories')) return route.fulfill({ json: ['Pokémon', 'Entrenador', 'Energía'] })
    if (url.pathname.endsWith('/types')) return route.fulfill({ json: ['Agua', 'Rayo'] })
    if (url.pathname.endsWith('/rarities')) return route.fulfill({ json: ['Común', 'Rara Ilustración Especial'] })
    if (url.pathname.endsWith('/cards') && url.searchParams.has('set.serie.id')) return route.fulfill({ json: [] })
    const detail = /\/cards\//.test(url.pathname)
    const noResults = url.searchParams.get('name') === 'like:no-existe'
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
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('')
  await expect(page.getByRole('button', { name: /base1-58.*Pikachu/ })).toBeVisible()
  await page.getByRole('button', { name: /base1-58.*Pikachu/ }).click()
  await expect(page.getByRole('link', { name: 'Buscar en Cardmarket' })).toHaveAttribute('href', /language=7/)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('incorpora expansiones nuevas al recargar y seleccionarlas elimina el nombre anterior', async ({ page }) => {
  let includeNew = false
  await page.route('https://api.tcgdex.net/v2/es/cards?**', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('set.id') !== 'eq:future-test') return route.fallback()
    return route.fulfill({ json: url.searchParams.has('set.serie.id') ? [] : [{ ...card, id: 'future-test-58' }] })
  })
  await page.route('https://api.tcgdex.net/v2/es/sets?**', (route) => new URL(route.request().url()).searchParams.has('sort:field') ? route.fallback() : route.fulfill({ json: [
    { id: 'base1', name: 'Base Set', cardCount: { total: 102, official: 102 } },
    ...(includeNew ? [{ id: 'future-test', name: 'Nueva expansión de prueba', cardCount: { total: 120, official: 100 } }] : []),
  ] }))
  await page.goto('/')
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option')).toHaveCount(3)
  await page.getByLabel('Nombre de carta').fill('Pikachu')
  includeNew = true
  await page.getByRole('button', { name: 'Refrescar catálogo', exact: true }).click()
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option')).toHaveCount(4)
  const request = page.waitForRequest((req) => new URL(req.url()).searchParams.get('set.id') === 'eq:future-test')
  await page.getByLabel('Expansión', { exact: true }).selectOption('future-test')
  const url = new URL((await request).url())
  expect(url.searchParams.has('name')).toBe(false)
  expect(url.searchParams.has('pagination:page')).toBe(false)
  expect(url.searchParams.has('set.serie.id')).toBe(false)
  await expect(page.getByRole('button', { name: /future-test-58.*Pikachu/ })).toBeVisible()
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('actualiza automáticamente el índice de expansiones con el catálogo abierto', async ({ page }) => {
  await page.clock.install()
  let queries = 0
  let includeNew = false
  await page.route('https://api.tcgdex.net/v2/es/sets?**', (route) => {
    if (new URL(route.request().url()).searchParams.has('sort:field')) return route.fallback()
    queries++
    return route.fulfill({ json: [{ id: includeNew ? 'new-test' : 'initial-test', name: 'Expansión de prueba', cardCount: { total: 1, official: 1 } }] })
  })
  await page.goto('/')
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option[value="initial-test"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Refrescar catálogo', exact: true })).toBeEnabled()
  const initialQueries = queries
  includeNew = true
  await page.clock.fastForward('15:00')
  await expect.poll(() => queries).toBeGreaterThan(initialQueries)
  await expect(page.getByLabel('Expansión', { exact: true }).locator('option[value="new-test"]')).toHaveCount(1)
})

test('un fallo del índice de opciones no impide mostrar novedades del índice físico ordenado', async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/es/sets?**', (route) => new URL(route.request().url()).searchParams.has('sort:field') ? route.fallback() : route.fulfill({ status: 503, body: 'Unavailable' }))
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
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible()
})

test('muestra el precio de Blastoise holo sin confundirlo con la oferta española mínima', async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/es/sets?**', (route) => route.fulfill({ json: [{ id: 'sv03.5', name: '151', cardCount: { total: 1, official: 1 } }] }))
  await page.route('https://api.tcgdex.net/v2/es/sets/sv03.5', (route) => route.fulfill({ json: { id: 'sv03.5', name: '151', serie: { id: 'sv' }, cardCount: { total: 1, official: 1 }, cards: [holoOnlyCard] } }))
  await page.route('https://api.tcgdex.net/v2/es/cards**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({ json: url.pathname.includes('/cards/') ? holoOnlyCard : url.searchParams.has('set.serie.id') ? [] : [holoOnlyCard] })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /sv03.5-200.*Blastoise ex/ }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByLabel('Variante')).toHaveValue('holo')
  await expect(modal.getByText('134,40 €', { exact: true })).toBeVisible()
  await expect(modal.getByText('75,00 €', { exact: true })).toBeVisible()
  await expect(modal.getByText('Datos del producto asociado a la única variante holo identificada por el proveedor.')).toBeVisible()
  await expect(modal.getByText(/no están filtrados por idioma/)).toBeVisible()
  await modal.getByLabel('Enlace del producto en Cardmarket (opcional)').fill('https://www.cardmarket.com/es/Pokemon/Products/Singles/151/Blastoise-ex-V3-MEW200?language=1')
  await expect(modal.getByRole('link', { name: 'Ver producto en Cardmarket' })).toHaveAttribute('href', /language=4$/)
})

test('combina filtros, conserva la consulta al paginar y permite limpiar', async ({ page }) => {
  await page.route('https://api.tcgdex.net/v2/es/cards?**', (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.has('set.serie.id') ? [] : Array.from({ length: 24 }, (_, i) => ({ ...card, id: `base1-${i}`, name: `Carta ${i}` })) }))
  await page.goto('/')
  await page.getByLabel('Categoría de carta').selectOption('Pokémon')
  await page.getByLabel('Expansión', { exact: true }).selectOption('base1')
  await page.getByText('Más opciones de filtro', { exact: true }).click()
  await page.getByLabel('Rareza', { exact: true }).selectOption('Rara Ilustración Especial')
  await page.getByLabel('Tipo / elemento', { exact: true }).selectOption('Agua')
  await page.getByLabel('Número de carta', { exact: true }).fill('200')
  await page.getByLabel('Ordenar por', { exact: true }).selectOption('number-desc')
  await page.getByLabel('Nombre de carta').fill('Blastoise ex')
  await page.getByLabel('Nombre exacto', { exact: true }).check()
  await page.getByLabel('Sólo con imagen', { exact: true }).check()
  const submitted = page.waitForRequest((req) => new URL(req.url()).searchParams.get('name') === 'eq:Blastoise ex')
  await page.getByRole('button', { name: 'Buscar cartas', exact: true }).click()
  const url = new URL((await submitted).url())
  expect(url.searchParams.get('id')).toBe('like:*-200')
  expect(url.searchParams.get('set.id')).toBe('eq:base1')
  expect(url.searchParams.get('category')).toBe('eq:Pokémon')
  expect(url.searchParams.get('rarity')).toBe('eq:Rara Ilustración Especial')
  expect(url.searchParams.get('types')).toBe('eq:Agua')
  expect(url.searchParams.get('image')).toBe('notnull:')
  expect(url.searchParams.get('sort:order')).toBe('DESC')
  const next = page.waitForRequest((req) => new URL(req.url()).searchParams.get('pagination:page') === '2')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  const nextUrl = new URL((await next).url())
  expect(nextUrl.searchParams.get('name')).toBe('eq:Blastoise ex')
  expect(nextUrl.searchParams.get('types')).toBe('eq:Agua')
  const reset = page.waitForRequest((req) => {
    const u = new URL(req.url())
    return u.pathname.endsWith('/cards') && u.searchParams.get('pagination:page') === '1' && !u.searchParams.has('name')
  })
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
  const resetUrl = new URL((await reset).url())
  expect([...resetUrl.searchParams.keys()].sort()).toEqual(['pagination:itemsPerPage', 'pagination:page', 'set.id'])
  expect(resetUrl.searchParams.get('set.id')).toBe('eq:base1')
  await expect(page.getByLabel('Resultados del catálogo').getByRole('button')).toHaveCount(24)
  await expect(page.getByLabel('Nombre de carta')).toHaveValue('')
  await expect(page.getByLabel('Nombre exacto', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('Sólo con imagen', { exact: true })).not.toBeChecked()
  await expect(page.getByLabel('Rareza', { exact: true })).toHaveValue('')
})

test('cambia entre lista y cuadrícula sin perder resultados ni abrir otra búsqueda', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Resultados del catálogo').getByRole('button')).toHaveCount(2)
  let searches = 0
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/cards')) searches++ })
  await page.getByRole('button', { name: 'Ver lista', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ver lista', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Resultados del catálogo')).toHaveClass('cards-list')
  await expect(page.getByLabel('Resultados del catálogo').getByRole('button')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: /base1-58.*Pikachu/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Ver cuadrícula', exact: true }).click()
  await expect(page.getByLabel('Resultados del catálogo')).toHaveClass('cards-grid')
  expect(searches).toBe(0)
})

test('un fallo de las opciones avanzadas no bloquea la búsqueda y permite recargarlas', async ({ page }) => {
  let failing = true
  await page.route('https://api.tcgdex.net/v2/es/rarities', (route) => failing ? route.fulfill({ status: 503 }) : route.fulfill({ json: ['Común'] }))
  await page.goto('/')
  await page.getByText('Más opciones de filtro', { exact: true }).click()
  await expect(page.getByText('No se pudieron cargar las opciones.', { exact: false })).toBeVisible()
  await page.getByLabel('Nombre de carta').fill('no-existe')
  await page.getByRole('button', { name: 'Buscar cartas', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No encontramos esas cartas' })).toBeVisible()
  failing = false
  await page.getByRole('button', { name: 'Refrescar catálogo', exact: true }).click()
  await page.getByLabel('Rareza', { exact: true }).selectOption('Común')
  await expect(page.getByText('No se pudieron cargar las opciones.', { exact: false })).toHaveCount(0)
})

test('cambiar idioma elimina categorías y filtros traducidos de la consulta anterior', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Categoría de carta').selectOption('Pokémon')
  await page.getByLabel('Nombre exacto', { exact: true }).check()
  const request = page.waitForRequest((req) => new URL(req.url()).pathname === '/v2/ja/cards')
  await page.getByLabel('Idioma de las cartas').selectOption('ja')
  const url = new URL((await request).url())
  expect(url.searchParams.has('name')).toBe(false)
  expect(url.searchParams.has('category')).toBe(false)
  await expect(page.getByLabel('Categoría de carta')).toHaveValue('')
  await expect(page.getByLabel('Nombre exacto', { exact: true })).not.toBeChecked()
})

test('ordena toda la expansión por rareza antes de paginar y permite volver al orden de catálogo', async ({ page }) => {
  const cards = Array.from({ length: 30 }, (_, i) => ({ id: `base1-${i + 1}`, localId: String(i + 1), name: `Carta ${i + 1}`, rarity: i < 5 ? 'Rara Ilustración Especial' : 'Común' }))
  await page.route('https://api.tcgdex.net/v2/es/cards?**', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('set.serie.id')) return route.fulfill({ json: [] })
    const rarity = url.searchParams.get('rarity')?.slice(3).split('|')
    let result = rarity ? cards.filter((card) => rarity.includes(card.rarity)) : cards
    if (url.searchParams.has('pagination:page')) {
      const start = (Number(url.searchParams.get('pagination:page')) - 1) * 24
      result = result.slice(start, start + 24)
    }
    return route.fulfill({ json: result })
  })
  await page.goto('/')
  const tiles = page.getByLabel('Resultados del catálogo').getByRole('heading', { level: 3 })
  await expect(tiles).toHaveCount(24)
  await expect(tiles.first()).toHaveText('Carta 5')
  await expect(tiles.nth(5)).toHaveText('Carta 30')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(tiles).toHaveText(['Carta 11', 'Carta 10', 'Carta 9', 'Carta 8', 'Carta 7', 'Carta 6'])
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeDisabled()
  await page.getByLabel('Ordenar por', { exact: true }).selectOption('catalog')
  await expect(tiles.first()).toHaveText('Carta 1')
  await expect(tiles).toHaveCount(24)
  await page.getByLabel('Ordenar por', { exact: true }).selectOption('rarity-desc')
  await expect(tiles.first()).toHaveText('Carta 5')
  await page.getByLabel('Expansión', { exact: true }).selectOption('')
  await expect(page.getByLabel('Ordenar por', { exact: true })).toHaveValue('catalog')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const language of ['es', 'en', 'ja']) {
  test(`muestra resultados físicos no vacíos en novedades, global y expansiones sin incluir Pocket (${language})`, async ({ page }) => {
    const physicalCards = [holoOnlyCard, card]
    const pocketCard = { ...card, id: 'A1-1', name: 'Solo Pocket' }
    const sets = [
      { id: 'A1', name: 'Pocket', serie: { id: 'tcgp' }, cardCount: { total: 1, official: 1 } },
      { id: 'sv03.5', name: '151', serie: { id: 'sv' }, cardCount: { total: 1, official: 1 } },
      { id: 'base1', name: 'Base Set', serie: { id: 'base' }, cardCount: { total: 1, official: 1 } },
    ]
    const cardRequests: URL[] = []
    await page.route('https://api.tcgdex.net/v2/**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/sets')) return route.fulfill({ json: url.searchParams.get('serie.id') === 'neq:tcgp' ? sets.filter((set) => set.serie.id !== 'tcgp') : sets })
      if (/\/sets\/[^/]+$/.test(url.pathname)) {
        const set = sets.find((set) => url.pathname.endsWith(`/${set.id}`))!
        return route.fulfill({ json: { ...set, cards: [...physicalCards, pocketCard].filter((item) => item.id.startsWith(`${set.id}-`)) } })
      }
      if (url.pathname.endsWith('/rarities')) return route.fulfill({ json: [...new Set(physicalCards.map((item) => item.rarity))] })
      if (/\/(categories|types)$/.test(url.pathname)) return route.fulfill({ json: [] })
      if (url.pathname.endsWith('/cards')) {
        cardRequests.push(url)
        // Igual que la API real: el filtro anidado no soportado produce un falso vacío.
        if (url.searchParams.has('set.serie.id')) return route.fulfill({ json: [] })
        const ids = url.searchParams.get('set.id')?.slice(3).split('|')
        const rarities = url.searchParams.get('rarity')?.slice(3).split('|')
        const result = [...physicalCards, pocketCard].filter((item) => (!ids || ids.some((id) => item.id.startsWith(`${id}-`))) && (!rarities || rarities.includes(item.rarity!)))
        return route.fulfill({ json: result })
      }
      return route.fulfill({ status: 404 })
    })
    await page.goto('/')
    if (language !== 'es') await page.getByLabel('Idioma de las cartas').selectOption(language)
    const results = page.getByLabel('Resultados del catálogo').getByRole('heading', { level: 3 })
    await expect(results).toHaveText(['Blastoise ex'])
    const expansion = page.getByLabel('Expansión', { exact: true })
    await expect(expansion.locator('option[value="A1"]')).toHaveCount(0)
    await expansion.selectOption('')
    await expect(results).toHaveText(['Blastoise ex', 'Pikachu'])
    await expansion.selectOption('base1')
    await expect(results).toHaveText(['Pikachu'])
    await expansion.selectOption('sv03.5')
    await expect(results).toHaveText(['Blastoise ex'])
    const requests = cardRequests.filter((url) => url.pathname === `/v2/${language}/cards`)
    expect(requests.map((url) => url.searchParams.get('set.id'))).toEqual(expect.arrayContaining(['eq:sv03.5', 'eq:base1', 'eq:sv03.5|base1']))
    for (const url of requests) {
      expect(url.searchParams.has('set.serie.id')).toBe(false)
      expect(url.searchParams.get('set.id')).not.toContain('A1')
      if (url.searchParams.has('rarity')) expect([...url.searchParams.keys()].sort()).toEqual(['rarity', 'set.id'])
    }
    await expect(page.getByRole('heading', { name: 'No encontramos esas cartas' })).toHaveCount(0)
  })
}
