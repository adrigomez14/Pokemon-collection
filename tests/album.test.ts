import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DuplicatesPanel } from '../src/components/DuplicatesPanel'
import { getSetCatalog, getSets, LATEST_SET, searchCards } from '../src/lib/catalog'
import { duplicateGroups, expansionProgress, ownedCardIds } from '../src/lib/progress'
import type { Entry } from '../src/lib/models'
import { card, entry } from './fixtures'

const saved = (overrides: Partial<Entry> = {}): Entry => ({ ...entry, quantity: 1, id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', updated_at: '2026-09-17', ...overrides })
const cards = Array.from({ length: 30 }, (_, i) => ({ id: `base1-${i + 1}`, name: `Carta ${i + 1}`, localId: String(i + 1), image: null }))
const set = { id: 'base1', name: 'Base Set', cardCount: { official: 28, total: 30 }, serie: { id: 'base' }, cards }
afterEach(() => vi.unstubAllGlobals())

describe('Álbum de cartas físicas', () => {
  it.each(['es', 'en', 'ja'] as const)('devuelve cartas físicas globales, seleccionadas y recientes sin el filtro incompatible (%s)', async (language) => {
    const modern = { id: 'sv03.5', name: '151', cardCount: { total: 1, official: 1 }, serie: { id: 'sv' } }
    const pocket = { id: 'A1', name: 'Pocket', cardCount: { total: 1, official: 1 }, serie: { id: 'tcgp' } }
    const modernCard = { id: 'sv03.5-200', localId: '200', name: 'Blastoise ex', image: null }
    const physical = [modernCard, ...cards]
    const source = [{ id: 'A1-1', localId: '1', name: 'Solo Pocket', image: null }, ...physical]
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/sets')) {
        const sets = [pocket, modern, set]
        return new Response(JSON.stringify(url.searchParams.get('serie.id') === 'neq:tcgp' ? sets.filter((item) => item.serie.id !== 'tcgp') : sets))
      }
      // Reproduce el fallo real: la API acepta el campo desconocido, pero devuelve cero cartas.
      if (url.searchParams.has('set.serie.id')) return new Response('[]')
      const ids = url.searchParams.get('set.id')?.slice(3).split('|')
      const filtered = source.filter((item) => !ids || ids.some((id) => item.id.startsWith(`${id}-`)))
      const start = (Number(url.searchParams.get('pagination:page') ?? 1) - 1) * 24
      return new Response(JSON.stringify(filtered.slice(start, start + 24)))
    })
    vi.stubGlobal('fetch', fetch)
    expect((await getSets(language)).map((item) => item.id)).toEqual(['sv03.5', 'base1'])
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('serie.id')).toBe('neq:tcgp')
    for (const selected of ['', 'base1', 'sv03.5', LATEST_SET]) {
      const result = await searchCards(language, { name: '', set: selected, number: '', page: 1, sort: 'catalog' })
      const expected = selected === '' ? physical.slice(0, 24) : selected === 'base1' ? cards.slice(0, 24) : [modernCard]
      expect(result.map((item) => item.id)).toEqual(expected.map((item) => item.id))
      expect(result.length).toBeGreaterThan(0)
      expect(result.some((item) => item.id.startsWith('A1-'))).toBe(false)
      const url = new URL(fetch.mock.calls.at(-1)![0])
      expect(url.pathname).toBe(`/v2/${language}/cards`)
      expect(url.searchParams.has('set.serie.id')).toBe(false)
      expect(url.searchParams.get('set.id')).toBe(selected === '' ? 'eq:sv03.5|base1' : `eq:${selected === LATEST_SET ? 'sv03.5' : selected}`)
      expect(url.searchParams.get('pagination:page')).toBe('1')
      if (selected === LATEST_SET) {
        const latestIndex = new URL(fetch.mock.calls.at(-2)![0])
        expect(latestIndex.searchParams.get('sort:field')).toBe('releaseDate')
        expect(latestIndex.searchParams.get('sort:order')).toBe('DESC')
      }
    }
    const secondPage = await searchCards(language, { name: '', set: '', number: '', page: 2, sort: 'catalog' })
    expect(secondPage.map((item) => item.id)).toEqual(physical.slice(24).map((item) => item.id))
    expect(new URL(fetch.mock.calls.at(-1)![0]).searchParams.get('pagination:page')).toBe('2')
    for (const selected of ['A1', 'unknown']) {
      const before = fetch.mock.calls.length
      expect(await searchCards(language, { name: '', set: selected, number: '', page: 1 })).toEqual([])
      expect(fetch.mock.calls.slice(before).map(([input]) => new URL(input).pathname)).toEqual([`/v2/${language}/sets`])
    }
  })
  it.each(['', 'base1'])('no consulta cartas sin un índice físico disponible (selección: %s)', async (selected) => {
    const fetch = vi.fn(async (_input: string) => new Response('[]'))
    vi.stubGlobal('fetch', fetch)
    expect(await searchCards('es', { name: '', set: selected, number: '', page: 1 })).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/v2/es/sets')
  })
  it.each(['', 'base1'])('propaga el fallo del índice en lugar de presentarlo como cartas inexistentes (%s)', async (selected) => {
    const fetch = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await expect(searchCards('es', { name: '', set: selected, number: '', page: 1 })).rejects.toThrow('catálogo')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('resuelve novedades usando exclusivamente expansiones físicas', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([set]))).mockResolvedValueOnce(new Response(JSON.stringify(set)))
    vi.stubGlobal('fetch', fetch)
    expect((await getSetCatalog('en', LATEST_SET))?.id).toBe('base1')
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get('serie.id')).toBe('neq:tcgp')
    expect(url.searchParams.get('sort:order')).toBe('DESC')
    expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/v2/en/sets/base1')
  })
  it('rechaza un acceso directo a un índice Pocket o a una expansión incorrecta', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...set, id: 'A1', serie: { id: 'tcgp' } }))).mockResolvedValueOnce(new Response(JSON.stringify(set)))
    vi.stubGlobal('fetch', fetch)
    await expect(getSetCatalog('es', 'A1')).rejects.toThrow('Pocket')
    await expect(getSetCatalog('es', 'other')).rejects.toThrow('solicitada')
  })
  it('filtra faltantes y poseídas en el conjunto completo antes de paginar', async () => {
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/sets')) return new Response(JSON.stringify([set]))
      return new Response(JSON.stringify(url.searchParams.has('set.serie.id') ? [] : cards))
    })
    vi.stubGlobal('fetch', fetch)
    const owned = new Set(cards.slice(0, 5).map((item) => item.id))
    const query = { name: '', set: 'base1', number: '', page: 1, sort: 'catalog' as const, ownership: 'missing' as const }
    expect((await searchCards('en', query, undefined, owned)).map((item) => item.id)).toEqual(cards.slice(5, 29).map((item) => item.id))
    expect((await searchCards('en', { ...query, page: 2 }, undefined, owned)).map((item) => item.id)).toEqual(['base1-30'])
    expect((await searchCards('en', { ...query, ownership: 'owned' }, undefined, owned)).map((item) => item.id)).toEqual(cards.slice(0, 5).map((item) => item.id))
    const requests = fetch.mock.calls.map(([input]) => new URL(input)).filter((url) => url.pathname.endsWith('/cards'))
    expect(requests).toHaveLength(3)
    for (const url of requests) {
      expect(url.searchParams.get('set.id')).toBe('eq:base1')
      expect(url.searchParams.has('set.serie.id')).toBe(false)
      expect(url.searchParams.has('pagination:page')).toBe(false)
      expect(url.searchParams.has('pagination:itemsPerPage')).toBe(false)
    }
  })
  it('no permite presentar todas como faltantes sin colección cargada o sin expansión', async () => {
    const query = { name: '', set: 'base1', number: '', page: 1, ownership: 'missing' as const }
    await expect(searchCards('es', query)).rejects.toThrow('inicia sesión')
    await expect(searchCards('es', { ...query, set: '' }, undefined, new Set())).rejects.toThrow('Selecciona')
  })
  it('calcula IDs únicos sin contar ejemplares, otras expansiones ni otros idiomas', () => {
    const entries = [saved({ card_id: 'base1-1', quantity: 4 }), saved({ card_id: 'base1-1', variant: 'holo', quantity: 2 }), saved({ card_id: 'base1-2', language: 'es' }), saved({ card_id: 'other-1' })]
    expect(expansionProgress([...cards, cards[0]], entries, 'en')).toEqual({ total: 30, collected: 1, missing: 29, percent: 3 })
    expect(ownedCardIds(entries, 'es')).toEqual(new Set(['base1-2']))
  })
  it('cuenta solo los IDs del índice disponible y admite conjuntos vacíos y completos', () => {
    expect(expansionProgress([], [saved()], 'en')).toEqual({ total: 0, collected: 0, missing: 0, percent: 0 })
    expect(expansionProgress([card], [saved({ quantity: 20 })], 'en')).toEqual({ total: 1, collected: 1, missing: 0, percent: 100 })
  })
})

describe('Gestión de repetidas', () => {
  it('agrupa misma carta, idioma y variante aunque cambie conservación', () => {
    const rows = [saved({ quantity: 2 }), saved({ id: '33333333-3333-4333-8333-333333333333', quantity: 1, condition: 'EX' })]
    const groups = duplicateGroups(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ copies: 3, extras: 2, entries: rows })
    expect(rows.map((item) => item.quantity)).toEqual([2, 1])
  })
  it('no considera repetidas una holo y una normal ni cartas de idiomas diferentes', () => {
    expect(duplicateGroups([saved(), saved({ variant: 'holo' }), saved({ language: 'es' })])).toEqual([])
  })
  it('suma extras por grupo y ordena primero las mayores cantidades sin mutar datos', () => {
    const rows = [saved({ quantity: 2 }), saved({ card_id: 'other', quantity: 5 }), saved({ language: 'es', quantity: 3 })]
    const original = JSON.stringify(rows)
    expect(duplicateGroups(rows).map((group) => group.extras)).toEqual([4, 2, 1])
    expect(JSON.stringify(rows)).toBe(original)
  })
  it('ofrece edición explícita por registro y nunca modifica la colección al renderizar', () => {
    const onEdit = vi.fn()
    const html = renderToStaticMarkup(createElement(DuplicatesPanel, { entries: [saved({ quantity: 3 })], busy: false, onEdit }))
    expect(html).toContain('2 ejemplares extra')
    expect(html).toContain('Editar 3 × Near Mint')
    expect(html).toContain('no se consideran repetidas')
    expect(onEdit).not.toHaveBeenCalled()
  })
})
