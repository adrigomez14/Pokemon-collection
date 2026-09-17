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
  it('excluye Pocket del índice y de todas las búsquedas antes de paginar', async () => {
    const fetch = vi.fn(async (_input: string) => new Response('[]'))
    vi.stubGlobal('fetch', fetch)
    await getSets('es')
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('serie.id')).toBe('neq:tcgp')
    for (const selected of ['', 'A1', 'base1']) {
      await searchCards('es', { name: '', set: selected, number: '', page: 2, sort: 'catalog' })
      const url = new URL(fetch.mock.calls.at(-1)![0])
      expect(url.searchParams.get('set.serie.id')).toBe('neq:tcgp')
      expect(url.searchParams.get('pagination:page')).toBe('2')
    }
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
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(cards)))
    vi.stubGlobal('fetch', fetch)
    const owned = new Set(cards.slice(0, 5).map((item) => item.id))
    const query = { name: '', set: 'base1', number: '', page: 1, sort: 'catalog' as const, ownership: 'missing' as const }
    expect((await searchCards('en', query, undefined, owned)).map((item) => item.id)).toEqual(cards.slice(5, 29).map((item) => item.id))
    expect((await searchCards('en', { ...query, page: 2 }, undefined, owned)).map((item) => item.id)).toEqual(['base1-30'])
    expect((await searchCards('en', { ...query, ownership: 'owned' }, undefined, owned)).map((item) => item.id)).toEqual(cards.slice(0, 5).map((item) => item.id))
    expect(new URL(fetch.mock.calls[0][0]).searchParams.has('pagination:page')).toBe(false)
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
