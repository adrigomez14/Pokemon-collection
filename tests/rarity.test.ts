import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalogSort, clearRarityCache, LATEST_SET, PAGE_SIZE, searchCards, type Search } from '../src/lib/catalog'
import { rarityRank } from '../src/lib/rarity'

const search: Search = { name: '', set: 'test', number: '', page: 1 }
const brief = (number: string, rarity: string | null, set = 'test') => ({ id: `${set}-${number}`, localId: number, name: `Carta ${number}`, image: null, rarity })
const cards = [brief('099', 'Común'), brief('009', 'Uncommon'), brief('001', 'Holo Rara'), brief('100', 'Rara Ilustración Especial'), brief('010', 'Rara Híper'), brief('002', 'Promo')]

function mockCatalog(source = cards) {
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/sets')) return new Response(JSON.stringify([{ id: 'test', name: 'Nueva', cardCount: { total: source.length, official: source.length } }]))
    if (url.pathname.endsWith('/rarities')) return new Response(JSON.stringify([...new Set(source.map((item) => item.rarity).filter(Boolean))]))
    const rarities = url.searchParams.get('rarity')?.slice(3).split('|')
    const set = url.searchParams.get('set.id')?.slice(3)
    const result = source.filter((item) => (!set || item.id.startsWith(`${set}-`)) && (!rarities || rarities.includes(item.rarity ?? '')))
    return new Response(JSON.stringify(result))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => clearRarityCache())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Jerarquía de rarezas', () => {
  it('sitúa especiales antes de raras, poco comunes y comunes, no por alfabeto ni número', () => {
    expect(['Común', 'Uncommon', 'Rara', 'Holo Rara', 'Rara Doble', 'Rara Ilustración', 'Ultra Rara', 'Rara Ilustración Especial', 'Rara Híper', 'Mega Hiper Rara'].map(rarityRank))
      .toEqual([10, 20, 30, 40, 60, 80, 90, 100, 110, 120])
  })
  it('reconoce etiquetas españolas, inglesas y las inglesas usadas por el catálogo japonés', () => {
    expect(rarityRank('  COMUN ')).toBe(rarityRank('Common'))
    expect(rarityRank('Poco común')).toBe(rarityRank('Uncommon'))
    expect(rarityRank('Special illustration rare')).toBe(rarityRank('Rara Ilustración Especial'))
    expect(rarityRank('Character Super Rare')).toBeGreaterThan(rarityRank('Character Rare'))
    expect(rarityRank('Tres Estrellas')).toBeGreaterThan(rarityRank('Dos Estrellas'))
  })
  it('no inventa rareza para promos, valores nuevos o ausentes y mantiene comunes al final', () => {
    for (const value of ['Promo', 'None', 'Ninguno', 'Rareza futura', undefined, null]) expect(rarityRank(value)).toBe(25)
  })
})

describe('Catálogo por rareza', () => {
  it('activa rareza en expansiones y novedades, conserva la búsqueda global y los órdenes elegidos', () => {
    expect(catalogSort(search)).toBe('rarity-desc')
    expect(catalogSort({ ...search, set: LATEST_SET })).toBe('rarity-desc')
    expect(catalogSort({ ...search, set: '' })).toBe('catalog')
    expect(catalogSort({ ...search, sort: 'catalog' })).toBe('catalog')
    expect(catalogSort({ ...search, sort: 'number-asc' })).toBe('number-asc')
  })
  it('ordena toda la expansión y conserva las cartas sin imagen', async () => {
    const fetch = mockCatalog()
    const result = await searchCards('es', search)
    expect(result.map((item) => item.localId)).toEqual(['010', '100', '001', '002', '009', '099'])
    expect(result.every((item) => item.image === null)).toBe(true)
    expect(fetch.mock.calls.every(([input]) => !new URL(input).pathname.includes('/cards/'))).toBe(true)
    expect(fetch.mock.calls.every(([input]) => !new URL(input).searchParams.has('pagination:page'))).toBe(true)
  })
  it('resuelve primero la última expansión y después aplica rareza', async () => {
    const fetch = mockCatalog()
    const result = await searchCards('es', { ...search, set: LATEST_SET })
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('sort:order')).toBe('DESC')
    expect(result[0].id).toBe('test-010')
  })
  it('pagina después de ordenar, sin duplicados y con desempate numérico descendente', async () => {
    const source = Array.from({ length: 30 }, (_, i) => brief(String(i + 1), i < 5 ? 'Rara' : 'Común'))
    const fetch = mockCatalog(source)
    const first = await searchCards('es', search)
    const calls = fetch.mock.calls.length
    const second = await searchCards('es', { ...search, page: 2 })
    expect(first).toHaveLength(PAGE_SIZE)
    expect(first.slice(0, 7).map((item) => item.localId)).toEqual(['5', '4', '3', '2', '1', '30', '29'])
    expect(second.map((item) => item.localId)).toEqual(['11', '10', '9', '8', '7', '6'])
    expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(30)
    expect(fetch.mock.calls.length - calls).toBe(1) // Se reutiliza la clasificación de rareza.
    expect(await searchCards('es', { ...search, page: 3 })).toEqual([])
  })
  it('combina rarezas del mismo nivel en una petición con el filtro OR verificado', async () => {
    const fetch = mockCatalog([brief('1', 'Rare Holo'), brief('2', 'Holo Rare')])
    await searchCards('en', search)
    const grouped = fetch.mock.calls.map(([input]) => new URL(input).searchParams.get('rarity')).filter(Boolean)
    expect(grouped).toEqual(['eq:Holo Rare|Rare Holo'])
  })
  it('conserva filtros en el listado y no vuelve a clasificar si ya se elige una sola rareza', async () => {
    const fetch = mockCatalog([brief('2', 'Común'), brief('10', 'Común')])
    const result = await searchCards('es', { ...search, name: 'Carta', exactName: true, number: '2', category: 'Pokémon', type: 'Agua', imageOnly: true, rarity: 'Común' })
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get('name')).toBe('eq:Carta')
    expect(url.searchParams.get('id')).toBe('like:*-2')
    expect(url.searchParams.get('category')).toBe('eq:Pokémon')
    expect(url.searchParams.get('types')).toBe('eq:Agua')
    expect(url.searchParams.get('image')).toBe('notnull:')
    expect(url.searchParams.get('rarity')).toBe('eq:Común')
    expect(result.map((item) => item.localId)).toEqual(['10', '2'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('no consulta rarezas cuando la búsqueda no devuelve cartas', async () => {
    const fetch = mockCatalog([])
    expect(await searchCards('es', search)).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('separa la caché por idioma y expansión y la invalida al actualizar', async () => {
    const fetch = mockCatalog([...cards, brief('1', 'Rara', 'other')])
    await searchCards('es', search)
    await searchCards('ja', search)
    await searchCards('es', { ...search, set: 'other' })
    expect(fetch.mock.calls.filter(([input]) => new URL(input).pathname.endsWith('/rarities'))).toHaveLength(3)
    clearRarityCache('es')
    await searchCards('es', search)
    await searchCards('ja', search)
    expect(fetch.mock.calls.filter(([input]) => new URL(input).pathname.endsWith('/rarities'))).toHaveLength(4)
  })
  it('renueva la clasificación al caducar cinco minutos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetch = mockCatalog()
    await searchCards('es', search)
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
    await searchCards('es', search)
    expect(fetch.mock.calls.filter(([input]) => new URL(input).pathname.endsWith('/rarities'))).toHaveLength(2)
  })
  it('no oculta fallos de clasificación ni guarda resultados parciales', async () => {
    const fetch = mockCatalog()
    const normal = fetch.getMockImplementation()!
    let fail = true
    fetch.mockImplementation(async (input) => fail && new URL(input).searchParams.has('rarity') ? new Response('', { status: 503 }) : normal(input))
    await expect(searchCards('es', search)).rejects.toThrow('catálogo')
    fail = false
    expect((await searchCards('es', search))[0].id).toBe('test-010')
    expect(fetch.mock.calls.filter(([input]) => new URL(input).pathname.endsWith('/rarities'))).toHaveLength(2)
  })
  it('rechaza un vocabulario vacío y permite elegir el orden de catálogo sin depender de él', async () => {
    const fetch = mockCatalog()
    const normal = fetch.getMockImplementation()!
    fetch.mockImplementation(async (input) => new URL(input).pathname.endsWith('/rarities') ? new Response('[]') : normal(input))
    await expect(searchCards('es', search)).rejects.toThrow('clasificar la rareza')
    expect(await searchCards('es', { ...search, sort: 'catalog' })).toHaveLength(cards.length)
  })
  it('no clasifica ni almacena una petición cancelada', async () => {
    mockCatalog()
    const controller = new AbortController()
    controller.abort()
    await expect(searchCards('es', search, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect((await searchCards('es', search))[0].id).toBe('test-010')
  })
  it('requiere expansión para rareza explícita y mantiene otros órdenes paginados por el servidor', async () => {
    const fetch = mockCatalog()
    await expect(searchCards('es', { ...search, set: '', sort: 'rarity-desc' })).rejects.toThrow('Selecciona una expansión')
    expect(fetch).not.toHaveBeenCalled()
    await searchCards('es', { ...search, sort: 'number-desc', page: 2 })
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get('sort:field')).toBe('localId')
    expect(url.searchParams.get('sort:order')).toBe('DESC')
    expect(url.searchParams.get('pagination:page')).toBe('2')
  })
})
