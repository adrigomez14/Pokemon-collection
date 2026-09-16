import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCard, searchCards } from '../src/lib/catalog'
import { card } from './fixtures'

afterEach(() => vi.unstubAllGlobals())
describe('Cliente del catálogo', () => {
  it('envía idioma, paginación y filtros de expansión y número', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([card])))
    vi.stubGlobal('fetch', fetch)
    await searchCards('ja', { name: 'ピカチュウ', set: 'SV1', number: '025', page: 2 })
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.pathname).toBe('/v2/ja/cards')
    expect(url.searchParams.get('name')).toBe('ピカチュウ')
    expect(url.searchParams.get('set.id')).toBe('eq:SV1')
    expect(url.searchParams.get('localId')).toBe('eq:025')
    expect(url.searchParams.get('pagination:page')).toBe('2')
    expect(url.searchParams.get('pagination:itemsPerPage')).toBe('24')
  })
  it('acepta cartas sin imagen y sin precios', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...card, image: null, pricing: null }))))
    const result = await getCard('es', card.id)
    expect(result.image).toBeNull()
    expect(result.pricing).toBeNull()
  })
  it('no consulta otro idioma para rellenar un precio ausente', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...card, pricing: undefined })))
    vi.stubGlobal('fetch', fetch)
    const result = await getCard('ja', card.id)
    expect(result.pricing).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('traduce errores HTTP y rechaza respuestas mal formadas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(getCard('es', 'unknown')).rejects.toThrow('no está disponible')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"id":1}')))
    await expect(getCard('es', 'unknown')).rejects.toThrow()
  })
})