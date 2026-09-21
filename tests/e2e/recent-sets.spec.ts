import { test, expect, type Page, type Route } from '@playwright/test'
import type { Language } from '../../src/lib/models'

const ids = ['sv03.5', 'z-new', 'b-new', 'x-new', 'a-new', 'm-new', 'q-new', 'c-new', 'outside-limit']
const titles = ['Zeta', 'Beta', 'Omega', 'Delta', 'Alfa', 'Gamma', 'Kappa', 'Épsilon', 'Fuera']
const vocabulary = {
  es: { name: 'Español', common: 'Común', rare: 'Rara Ilustración Especial', category: 'Pokémon', type: 'Agua' },
  en: { name: 'Inglés', common: 'Common', rare: 'Special illustration rare', category: 'Pokemon', type: 'Water' },
  // TCGdex usa etiquetas de rareza inglesas también en su catálogo japonés.
  ja: { name: 'Japonés', common: 'Common', rare: 'Special illustration rare', category: 'ポケモン', type: '水' },
}
const setFixture = (language: Language, id: string, name: string) => ({
  id, name, serie: { id: 'sv' }, cardCount: { total: 30, official: 30 },
  logo: `https://assets.tcgdex.net/${language}/sv/${id}/logo`,
  // Estos datos no deben convertirse en precios, enlaces ni criterios de ordenación.
  pricing: { cardmarket: { trend: 987654.32, unit: 'EUR' } },
  price: 'PRICE_MUST_NOT_RENDER', metadata: { url: 'https://price.invalid/PRICE_MUST_NOT_RENDER' },
})
const setsFor = (language: Language) => ids.map((id, i) => setFixture(language, id, `${vocabulary[language].name} ${titles[i]}`))
const cardsFor = (language: Language, id: string) => Array.from({ length: 30 }, (_, i) => ({
  id: `${id}-${i + 1}`, localId: String(i + 1), name: `${language} Carta ${i + 1}`, image: null,
  rarity: i < 5 ? vocabulary[language].rare : vocabulary[language].common,
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function mockCatalog(page: Page) {
  const state = {
    mode: 'normal' as 'normal' | 'error' | 'empty',
    refreshed: false,
    gates: new Map<Language, ReturnType<typeof deferred>>(),
    requests: [] as URL[],
    images: [] as string[],
    unexpected: [] as string[],
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Ninguna petición externa usa servicios reales, cuentas o publicidad.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  await page.route('https://assets.tcgdex.net/**', (route) => {
    const url = route.request().url()
    state.images.push(url)
    if (!url.endsWith('/sv03.5/logo.webp')) return route.abort()
    // Imagen mínima válida: importa la decodificación, no el formato del fixture.
    return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
  })
  await page.route('https://api.tcgdex.net/v2/**', async (route: Route) => {
    const url = new URL(route.request().url())
    state.requests.push(url)
    const language = url.pathname.split('/')[2] as Language
    const words = vocabulary[language]
    if (!words) { state.unexpected.push(url.href); return route.fulfill({ status: 404 }) }
    const sets = setsFor(language)
    if (state.refreshed) sets.unshift(setFixture(language, 'future-test', `${words.name} Nueva llegada`))
    if (url.pathname.endsWith('/sets')) {
      const sorted = url.searchParams.get('sort:field') === 'releaseDate'
      if (sorted) {
        // Capturar la respuesta antes de liberar el bloqueo simula una respuesta antigua tardía.
        const mode = state.mode
        await state.gates.get(language)?.promise
        if (mode === 'error') return route.fulfill({ status: 503, body: 'Unavailable' })
        if (mode === 'empty') return route.fulfill({ json: [] })
      }
      return route.fulfill({ json: sets })
    }
    if (/\/sets\/[^/]+$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!)
      return route.fulfill({ json: { ...sets.find((set) => set.id === id), cards: cardsFor(language, id) } })
    }
    if (url.pathname.endsWith('/rarities')) return route.fulfill({ json: [words.common, words.rare] })
    if (url.pathname.endsWith('/categories')) return route.fulfill({ json: [words.category] })
    if (url.pathname.endsWith('/types')) return route.fulfill({ json: [words.type] })
    if (url.pathname.endsWith('/cards')) {
      if (url.searchParams.has('set.serie.id')) return route.fulfill({ json: [] })
      const selected = url.searchParams.get('set.id')?.slice(3).split('|') ?? []
      const rarities = url.searchParams.get('rarity')?.slice(3).split('|')
      let cards = selected.flatMap((id) => cardsFor(language, id)).filter((card) => !rarities || rarities.includes(card.rarity))
      if (url.searchParams.has('pagination:page')) {
        const start = (Number(url.searchParams.get('pagination:page')) - 1) * 24
        cards = cards.slice(start, start + 24)
      }
      return route.fulfill({ json: cards })
    }
    // Fallar explícitamente si la fila intenta obtener precios o fichas por carta.
    state.unexpected.push(url.href)
    return route.fulfill({ status: 404 })
  })
  return state
}

const region = (page: Page) => page.getByRole('region', { name: 'Últimas expansiones', exact: true })
const shortcuts = (page: Page) => region(page).getByRole('button', { name: /^Ver expansión / })
const results = (page: Page) => page.getByLabel('Resultados del catálogo').locator('.card-tile')
const expansionSelect = (page: Page) => page.getByRole('combobox', { name: 'Expansión', exact: true })

async function refreshAfterFifteenMinutes(page: Page, language: Language = 'es') {
  const updated = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === `/v2/${language}/sets` && url.searchParams.get('sort:field') === 'releaseDate'
  })
  await page.clock.fastForward('15:00')
  await (await updated).finished()
}

async function openFilters(page: Page) {
  const more = page.getByRole('button', { name: 'Más filtros', exact: true })
  if (await more.isVisible()) await more.click()
  await page.getByText('Más opciones de filtro', { exact: true }).click()
}

// Montar el componente de producción permite probar ownership sin cuentas ni Supabase.
async function mountSearch(page: Page, ownership: 'missing' | 'owned' = 'missing') {
  // Reutilizar las URLs transformadas por Vite (incluido ?v=) evita duplicar React/QueryContext.
  const searchModule = await (await page.request.get('/src/components/CatalogSearch.tsx')).text()
  const mainModule = await (await page.request.get('/src/main.tsx')).text()
  const dependency = (source: string, file: string) => {
    const url = [...source.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]).find((url) => url.includes(`/${file}.js`))
    if (!url) throw new Error(`No se pudo resolver ${file} desde el módulo transformado`)
    return JSON.stringify(url)
  }
  await page.route('**/recent-sets-harness', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const reactModule = await import(${dependency(searchModule, 'react')});
      const React = reactModule.default ?? reactModule;
      const domModule = await import(${dependency(mainModule, 'react-dom_client')});
      const { createRoot } = domModule.default ?? domModule;
      const { QueryClient, QueryClientProvider } = await import(${dependency(searchModule, '@tanstack_react-query')});
      const { CatalogSearch } = await import('/src/components/CatalogSearch.tsx');
      await import('/src/index.css'); await import('/src/theme.css'); await import('/src/mobile.css');
      function Harness() {
        const [search, setSearch] = React.useState({ name: 'old-name', number: '025', set: 'old-set', page: 4,
          category: 'old-category', type: 'old-type', rarity: 'old-rarity', exactName: true, imageOnly: true,
          ownership: '${ownership}', sort: 'name-asc' });
        return React.createElement(React.Fragment, null,
          React.createElement(CatalogSearch, { language: 'es', search, onSearch: setSearch }),
          React.createElement('output', { 'data-testid': 'search-state' }, JSON.stringify(search)));
      }
      createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(Harness)));
    </script></body></html>` }))
  await page.goto('/recent-sets-harness')
  await expect(shortcuts(page)).toHaveCount(8)
}

test('conserva ocho expansiones en orden del proveedor, activa LATEST y coloca la fila entre buscador y progreso', async ({ page }) => {
  const state = await mockCatalog(page)
  await page.goto('/')
  await expect(shortcuts(page)).toHaveCount(8)
  await expect(shortcuts(page).locator('.recent-set-info > strong')).toHaveText(setsFor('es').slice(0, 8).map((set) => set.name))
  await expect(expansionSelect(page)).toHaveValue('__latest__')
  await expect(shortcuts(page).first()).toHaveAttribute('aria-pressed', 'true')
  await expect(region(page).locator('[aria-pressed="true"]')).toHaveCount(1)
  await expect(page.locator('.search-panel + .recent-sets + .set-progress')).toHaveCount(1)
  await expect(results(page)).toHaveCount(24)
  const boxes = await page.locator('.search-panel, .recent-sets, .set-progress').evaluateAll((elements) => elements.map((element) => {
    const { top, bottom } = element.getBoundingClientRect(); return { top, bottom }
  }))
  expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom)
  expect(boxes[2].top).toBeGreaterThanOrEqual(boxes[1].bottom)
  await expect(region(page)).not.toContainText(/PRICE_MUST_NOT_RENDER|987654|987\.654|€/)
  await expect(region(page).getByRole('link')).toHaveCount(0)
  await expect(region(page)).toContainText('No ofrece precio del set completo')
  expect(state.unexpected).toEqual([])
  for (const url of state.requests.filter((url) => url.pathname.endsWith('/sets') && url.searchParams.has('sort:field'))) {
    expect(Object.fromEntries(url.searchParams)).toEqual({ 'serie.id': 'neq:tcgp', 'sort:field': 'releaseDate', 'sort:order': 'DESC' })
  }
})

test('seleccionar una expansión limpia filtros visibles y vuelve de página 2 a 1 con rareza descendente', async ({ page }) => {
  const state = await mockCatalog(page)
  await page.goto('/')
  await expect(results(page)).toHaveCount(24)
  await page.getByRole('combobox', { name: 'Ordenar por', exact: true }).selectOption('name-asc')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(page.locator('.pagination')).toContainText('Página 2')
  await openFilters(page)
  await page.getByRole('textbox', { name: 'Nombre de carta', exact: true }).fill('old-name')
  await page.getByRole('textbox', { name: 'Número de carta', exact: true }).fill('025')
  await page.getByRole('combobox', { name: 'Categoría de carta', exact: true }).selectOption('Pokémon')
  await page.getByRole('combobox', { name: 'Rareza', exact: true }).selectOption('Común')
  await page.getByRole('combobox', { name: 'Tipo / elemento', exact: true }).selectOption('Agua')
  await page.getByRole('checkbox', { name: 'Nombre exacto', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Sólo con imagen', exact: true }).check()
  const request = page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname === '/v2/es/cards' && url.searchParams.get('set.id') === 'eq:z-new' && !url.searchParams.has('rarity')
  })
  await region(page).getByRole('button', { name: 'Ver expansión Español Beta', exact: true }).click()
  const url = new URL((await request).url())
  expect(Object.fromEntries(url.searchParams)).toEqual({ 'set.id': 'eq:z-new' })
  await expect(expansionSelect(page)).toHaveValue('z-new')
  await expect(page.getByRole('combobox', { name: 'Ordenar por', exact: true })).toHaveValue('rarity-desc')
  for (const name of ['Nombre de carta', 'Número de carta']) await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('')
  for (const name of ['Categoría de carta', 'Rareza', 'Tipo / elemento']) await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue('')
  for (const name of ['Nombre exacto', 'Sólo con imagen']) await expect(page.getByRole('checkbox', { name, exact: true })).not.toBeChecked()
  await expect(page.locator('.pagination')).toContainText('Página 1')
  await expect(results(page)).toHaveCount(24)
  await expect(results(page).first()).toContainText('z-new-5')
  await expect(region(page).getByRole('button', { name: 'Ver expansión Español Beta', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(shortcuts(page).first()).toHaveAttribute('aria-pressed', 'false')
  expect(state.unexpected).toEqual([])
})

for (const ownership of ['missing', 'owned'] as const) {
  test(`CatalogSearch.apply elimina también ownership=${ownership} y todos los filtros aplicados`, async ({ page }) => {
    const state = await mockCatalog(page)
    await mountSearch(page, ownership)
    const output = page.getByTestId('search-state')
    expect(JSON.parse((await output.textContent())!)).toMatchObject({ ownership, page: 4, exactName: true, imageOnly: true })
    // Solo hay una consulta al índice reciente: no se monta el catálogo principal.
    expect(state.requests.filter((url) => url.searchParams.get('sort:field') === 'releaseDate')).toHaveLength(1)
    expect(state.requests.some((url) => /\/cards(?:\/|$)/.test(url.pathname))).toBe(false)
    await region(page).getByRole('button', { name: 'Ver expansión Español Beta', exact: true }).click()
    await expect.poll(async () => JSON.parse((await output.textContent())!)).toEqual({ name: '', number: '', set: 'z-new', page: 1, ownership: 'all', sort: 'rarity-desc' })
    await expect(expansionSelect(page)).toHaveValue('z-new')
    await region(page).getByRole('button', { name: 'Todas las expansiones', exact: true }).click()
    await expect.poll(async () => JSON.parse((await output.textContent())!)).toEqual({ name: '', number: '', set: '', page: 1, ownership: 'all', sort: 'catalog' })
    await expect(expansionSelect(page)).toHaveValue('')
    await expect(region(page).locator('[aria-pressed="true"]')).toHaveCount(0)
  })
}

test('Todas las expansiones sincroniza el selector, la consulta global y la página', async ({ page }) => {
  const state = await mockCatalog(page)
  await page.goto('/')
  await expect(results(page)).toHaveCount(24)
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(page.locator('.pagination')).toContainText('Página 2')
  const request = page.waitForRequest((req) => {
    const url = new URL(req.url())
    return url.pathname.endsWith('/cards') && url.searchParams.get('pagination:page') === '1'
  })
  await region(page).getByRole('button', { name: 'Todas las expansiones', exact: true }).click()
  const url = new URL((await request).url())
  expect([...url.searchParams.keys()].sort()).toEqual(['pagination:itemsPerPage', 'pagination:page', 'set.id'])
  expect(url.searchParams.get('set.id')?.slice(3).split('|').sort()).toEqual([...ids].sort())
  await expect(expansionSelect(page)).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Ordenar por', exact: true })).toHaveValue('catalog')
  await expect(page.locator('.pagination')).toContainText('Página 1')
  await expect(page.locator('.set-progress')).toHaveCount(0)
  await expect(region(page).locator('[aria-pressed="true"]')).toHaveCount(0)
  await expect(results(page)).toHaveCount(24)
  expect(state.unexpected).toEqual([])
})

test('es/en/ja tienen índices propios y no muestran la fila anterior durante la carga', async ({ page }) => {
  const state = await mockCatalog(page)
  await page.goto('/')
  await expect(shortcuts(page).first()).toHaveAccessibleName('Ver expansión Español Zeta')
  for (const language of ['en', 'ja'] as const) {
    const gate = deferred()
    state.gates.set(language, gate)
    try {
      await page.getByRole('combobox', { name: 'Idioma de las cartas' }).selectOption(language)
      await expect(region(page).getByRole('status')).toContainText('Cargando últimas expansiones')
      await expect(shortcuts(page)).toHaveCount(0)
      await expect(region(page)).toContainText(`${vocabulary[language].name} · Cartas físicas`)
    } finally { gate.resolve(); state.gates.delete(language) }
    await expect(shortcuts(page).locator('.recent-set-info > strong')).toHaveText(setsFor(language).slice(0, 8).map((set) => set.name))
    await expect(shortcuts(page).first()).toHaveAttribute('aria-pressed', 'true')
    await expect(results(page).first()).toContainText(`${language} Carta`)
    expect(state.requests.some((url) => url.pathname === `/v2/${language}/sets` && url.searchParams.get('sort:order') === 'DESC')).toBe(true)
  }
  await expect(region(page)).not.toContainText(/Español|Inglés/)
  expect(state.unexpected).toEqual([])
})

test('una respuesta tardía de otro idioma no reemplaza las expansiones actuales', async ({ page }) => {
  const state = await mockCatalog(page)
  await page.goto('/')
  await expect(shortcuts(page)).toHaveCount(8)
  const gate = deferred()
  state.gates.set('en', gate)
  try {
    await page.getByRole('combobox', { name: 'Idioma de las cartas' }).selectOption('en')
    await expect.poll(() => state.requests.filter((url) => url.pathname === '/v2/en/sets' && url.searchParams.has('sort:field')).length).toBeGreaterThan(0)
    await expect(shortcuts(page)).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Idioma de las cartas' }).selectOption('ja')
    await expect(shortcuts(page).first()).toHaveAccessibleName('Ver expansión Japonés Zeta')
  } finally { gate.resolve(); state.gates.delete('en') }
  await expect(results(page).first()).toContainText('ja Carta')
  await expect(shortcuts(page).locator('.recent-set-info > strong')).toHaveText(setsFor('ja').slice(0, 8).map((set) => set.name))
  await expect(region(page)).not.toContainText(/Español|Inglés/)
})

test('los logos usan .webp sin /low y los errores o URLs inseguras muestran alternativa', async ({ page }) => {
  const state = await mockCatalog(page)
  await page.route('https://api.tcgdex.net/v2/es/sets?**', (route) => {
    const sets = setsFor('es')
    sets[2].logo = 'https://price.invalid/unsafe/logo'
    return route.fulfill({ json: sets })
  })
  await page.goto('/')
  const logo = region(page).getByRole('img', { name: 'Logo de Español Zeta', exact: true })
  await logo.scrollIntoViewIfNeeded()
  await expect(logo).toHaveAttribute('src', 'https://assets.tcgdex.net/es/sv/sv03.5/logo.webp')
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const aborted = region(page).getByRole('button', { name: 'Ver expansión Español Beta', exact: true })
  await aborted.scrollIntoViewIfNeeded()
  await expect(aborted).toContainText('Logo no disponible')
  await expect(aborted.getByRole('img')).toHaveCount(0)
  const invalid = region(page).getByRole('button', { name: 'Ver expansión Español Omega', exact: true })
  await expect(invalid).toContainText('Logo no disponible')
  await expect(invalid.getByRole('img')).toHaveCount(0)
  expect(state.images).toContain('https://assets.tcgdex.net/es/sv/z-new/logo.webp')
  expect(state.images.every((url) => url.endsWith('/logo.webp') && !url.includes('/low'))).toBe(true)
})

for (const mode of ['error', 'empty'] as const) {
  test(`la fila ${mode} tras actualizarse automáticamente conserva las cartas y se recupera ${mode === 'error' ? 'al reintentar' : 'en el siguiente intervalo'}`, async ({ page }) => {
    await page.clock.install()
    const state = await mockCatalog(page)
    await page.goto('/')
    await region(page).getByRole('button', { name: 'Ver expansión Español Beta', exact: true }).click()
    await expect(results(page).first()).toContainText('z-new-5')
    // El catálogo usa ahora un ID explícito: el fallo es solo del índice reciente.
    state.mode = mode
    await refreshAfterFifteenMinutes(page)
    if (mode === 'error') {
      await expect(region(page).getByRole('status')).toContainText('Se conserva la última consulta')
      await expect(shortcuts(page)).toHaveCount(8)
      await expect(shortcuts(page).locator('.recent-set-info > strong')).toHaveText(setsFor('es').slice(0, 8).map((set) => set.name))
    } else {
      await expect(region(page)).toContainText('No hay expansiones físicas disponibles en este idioma')
      await expect(shortcuts(page)).toHaveCount(0)
    }
    await expect(results(page)).toHaveCount(24)
    await expect(results(page).first()).toContainText('z-new-5')
    await expect(page.getByRole('heading', { name: 'No se pudo cargar el catálogo', exact: true })).toHaveCount(0)
    state.mode = 'normal'
    state.refreshed = true
    if (mode === 'error') {
      const recovered = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/v2/es/sets' && url.searchParams.has('sort:field') && response.ok()
      })
      await region(page).getByRole('button', { name: 'Reintentar expansiones', exact: true }).click()
      await (await recovered).finished()
    } else {
      await refreshAfterFifteenMinutes(page)
    }
    await expect(shortcuts(page).first()).toHaveAccessibleName('Ver expansión Español Nueva llegada')
    await expect(shortcuts(page)).toHaveCount(8)
    await expect(region(page).getByRole('status')).toHaveCount(0)
    await expect(results(page)).toHaveCount(24)
    await expect(results(page).first()).toContainText('z-new-5')
    await expect(expansionSelect(page)).toHaveValue('z-new')
    await expect(region(page).getByRole('button', { name: 'Ver expansión Español Beta', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(shortcuts(page).first()).toHaveAttribute('aria-pressed', 'false')
    await expect(region(page)).not.toContainText('No hay expansiones físicas disponibles en este idioma')
    expect(state.unexpected).toEqual([])
  })
}

test('un error inicial de la fila conserva el buscador y el botón de todas las expansiones', async ({ page }) => {
  const state = await mockCatalog(page)
  state.mode = 'error'
  // En la aplicación real pasar a búsqueda global evita depender del índice de novedades.
  await page.goto('/')
  await region(page).getByRole('button', { name: 'Todas las expansiones', exact: true }).click()
  await expect(region(page).getByRole('status')).toContainText('Puedes seguir usando el buscador')
  await expect(results(page)).toHaveCount(24)
  await expect(shortcuts(page)).toHaveCount(0)
  state.mode = 'normal'
  await region(page).getByRole('button', { name: 'Reintentar expansiones', exact: true }).click()
  await expect(shortcuts(page)).toHaveCount(8)
  await expect(results(page)).toHaveCount(24)
})

for (const language of ['es', 'en', 'ja'] as const) {
  test(`la actualización automática a los 15 minutos mueve LATEST al nuevo set sin aplicar el borrador de filtros (${language})`, async ({ page }) => {
    await page.clock.install()
    const state = await mockCatalog(page)
    await page.goto('/')
    if (language !== 'es') await page.getByRole('combobox', { name: 'Idioma de las cartas' }).selectOption(language)
    await expect(results(page)).toHaveCount(24)
    await expect(results(page).first()).toContainText(`${language} Carta`)
    await expect(shortcuts(page).first()).toHaveAccessibleName(`Ver expansión ${vocabulary[language].name} Zeta`)
    await expect(page.getByRole('button', { name: 'Refrescar catálogo', exact: true })).toHaveCount(0)
    await openFilters(page)
    await page.getByRole('textbox', { name: 'Nombre de carta', exact: true }).fill('old-name')
    await page.getByRole('textbox', { name: 'Número de carta', exact: true }).fill('025')
    await page.getByRole('combobox', { name: 'Categoría de carta', exact: true }).selectOption(vocabulary[language].category)
    await page.getByRole('combobox', { name: 'Rareza', exact: true }).selectOption(vocabulary[language].common)
    await page.getByRole('combobox', { name: 'Tipo / elemento', exact: true }).selectOption(vocabulary[language].type)
    await page.getByRole('checkbox', { name: 'Nombre exacto', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Sólo con imagen', exact: true }).check()
    const before = state.requests.length
    state.refreshed = true
    const cards = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === `/v2/${language}/cards` && url.searchParams.get('set.id') === 'eq:future-test' && response.ok()
    })
    await refreshAfterFifteenMinutes(page, language)
    await (await cards).finished()
    await expect(shortcuts(page).first()).toHaveAccessibleName(`Ver expansión ${vocabulary[language].name} Nueva llegada`)
    await expect(shortcuts(page)).toHaveCount(8)
    await expect(shortcuts(page).first()).toHaveAttribute('aria-pressed', 'true')
    await expect(region(page).locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(expansionSelect(page)).toHaveValue('__latest__')
    await expect(expansionSelect(page).locator('option[value="future-test"]')).toHaveCount(1)
    await expect(results(page).first()).toContainText('future-test-5')
    await expect(results(page)).toHaveCount(24)
    await expect(results(page).locator('h3')).toHaveText([5, 4, 3, 2, 1, ...Array.from({ length: 19 }, (_, i) => 30 - i)].map((number) => `${language} Carta ${number}`))
    await expect(page.locator('.pagination')).toContainText('Página 1')
    await expect(page.getByRole('textbox', { name: 'Nombre de carta', exact: true })).toHaveValue('old-name')
    const updates = state.requests.slice(before)
    expect(updates.some((url) => url.pathname === `/v2/${language}/sets` && url.searchParams.has('sort:field'))).toBe(true)
    const newCards = updates.filter((url) => url.pathname.endsWith('/cards'))
    expect(newCards.length).toBeGreaterThan(0)
    for (const url of newCards) {
      expect(url.pathname).toBe(`/v2/${language}/cards`)
      expect(url.searchParams.get('set.id')).toBe('eq:future-test')
      expect([...url.searchParams.keys()].sort()).toEqual(url.searchParams.has('rarity') ? ['rarity', 'set.id'] : ['set.id'])
    }
    expect(state.unexpected).toEqual([])
  })
}

test('teclado y desplazamiento mantienen accesibles las ocho expansiones sin desbordar a 320/390/768/1440', async ({ page }) => {
  await mockCatalog(page)
  await page.goto('/')
  await expect(shortcuts(page)).toHaveCount(8)
  const track = region(page).getByRole('list', { name: 'Expansiones recientes' })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await region(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await track.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    const next = region(page).getByRole('button', { name: 'Ver más expansiones en la fila', exact: true })
    const previous = region(page).getByRole('button', { name: 'Ver expansiones anteriores en la fila', exact: true })
    // Cambiar de ancho con foco en el último botón puede restaurar su posición de scroll.
    await region(page).getByRole('button', { name: 'Todas las expansiones', exact: true }).focus()
    // La guía de instalación desplaza la fila más abajo: preparar también el scroll vertical.
    await track.scrollIntoViewIfNeeded()
    await track.evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }))
    await expect(shortcuts(page).first()).toBeInViewport()
    // scroll-snap puede alinear el primer elemento con los 3px de padding del track.
    await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeLessThanOrEqual(3)
    if (width > 700) {
      const start = await track.evaluate((element) => element.scrollLeft)
      await expect(next).toBeEnabled()
      await next.click()
      await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(start + 10)
      await expect(previous).toBeEnabled()
      await previous.click()
      await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeLessThanOrEqual(start + 1)
    } else {
      await expect(next).toBeHidden()
      await expect(previous).toBeHidden()
      expect(await track.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto')
    }
    // Recorrido real de foco: Tab desplaza la fila también cuando las flechas están ocultas.
    await shortcuts(page).first().focus()
    for (let i = 1; i < 8; i++) {
      await page.keyboard.press('Tab')
      await expect(shortcuts(page).nth(i)).toBeFocused()
    }
    await expect(shortcuts(page).last()).toBeInViewport()
    await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.keyboard.press('Enter')
  await expect(expansionSelect(page)).toHaveValue('c-new')
  await expect(shortcuts(page).last()).toHaveAttribute('aria-pressed', 'true')
  await region(page).getByRole('button', { name: 'Todas las expansiones', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(expansionSelect(page)).toHaveValue('')
})
