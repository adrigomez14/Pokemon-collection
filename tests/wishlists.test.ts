import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageUrl, type CardBrief, type Language } from '../src/lib/models'
import {
  addWishlistItem, createWishlist, deleteWishlist, isCardWished, loadWishlists,
  removeWishlistItem, renameWishlist, updateWishlistItemTargetPrice, wishlistCardKey, wishlistErrorMessage, wishlistNameSchema,
  type Wishlist, type WishlistItem,
} from '../src/lib/wishlists'

const { client, requireClient } = vi.hoisted(() => {
  const client = { auth: { getUser: vi.fn() }, from: vi.fn() }
  return { client, requireClient: vi.fn(() => client) }
})
// No importar la configuración ni construir un cliente Supabase real.
vi.mock('../src/lib/supabase', () => ({ requireSupabase: requireClient }))

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const listId = '33333333-3333-4333-8333-333333333333'
const otherListId = '44444444-4444-4444-8444-444444444444'
const card: CardBrief = { id: 'base1-1', name: 'Alakazam', localId: '1', image: 'https://assets.tcgdex.net/en/base/base1/1' }
const list: Wishlist = { id: listId, user_id: alice, name: 'Favoritas', created_at: '2026-09-17T00:00:00+00:00' }
const item: WishlistItem = { list_id: listId, user_id: alice, card_id: card.id, language: 'en', card_snapshot: card, target_price: null, created_at: list.created_at }
type Result = { data: unknown; error: unknown }
const results: (Result | Promise<Result>)[] = []
function builder(table: string) {
  const result = results.shift() ?? { data: null, error: null }
  const query = {
    table, select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), abortSignal: vi.fn(),
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(), upsert: vi.fn(), single: vi.fn(),
    then: (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  }
  for (const method of [query.select, query.eq, query.order, query.range, query.abortSignal, query.insert, query.update, query.delete, query.upsert, query.single]) method.mockReturnValue(query)
  // El SDK devuelve un builder final sin abortSignal después de single().
  query.single.mockReturnValue({ then: query.then })
  return query
}
const queries: ReturnType<typeof builder>[] = []
const writes = [
  ['create', (id: string, signal?: AbortSignal) => createWishlist(id, 'Favoritas', signal)],
  ['rename', (id: string, signal?: AbortSignal) => renameWishlist(id, listId, 'Favoritas', signal)],
  ['delete', (id: string, signal?: AbortSignal) => deleteWishlist(id, listId, signal)],
  ['add', (id: string, signal?: AbortSignal) => addWishlistItem(id, listId, card, 'en', signal)],
  ['target price', (id: string, signal?: AbortSignal) => updateWishlistItemTargetPrice(id, listId, card.id, 'en', 12.5, signal)],
  ['remove', (id: string, signal?: AbortSignal) => removeWishlistItem(id, listId, card.id, 'en', signal)],
] as const

beforeEach(() => {
  vi.resetAllMocks()
  results.length = 0
  queries.length = 0
  requireClient.mockReturnValue(client)
  client.auth.getUser.mockResolvedValue({ data: { user: { id: alice, is_anonymous: false } }, error: null })
  client.from.mockImplementation((table: string) => { const query = builder(table); queries.push(query); return query })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Las pruebas no admiten red') }))
})
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  expect(queries.every((query) => ['wishlists', 'wishlist_items'].includes(query.table))).toBe(true)
  vi.unstubAllGlobals()
})

describe('Validación y utilidades de deseos privados', () => {
  it('recorta el nombre y acepta los extremos 1 y 80', () => {
    expect(wishlistNameSchema.parse(' \t Favoritas \n')).toBe('Favoritas')
    expect(wishlistNameSchema.parse('a')).toBe('a')
    expect(wishlistNameSchema.parse('a'.repeat(80))).toHaveLength(80)
  })
  it.each(['', ' \t\n', '\u00a0\u2000\ufeff', 'a'.repeat(81)])('rechaza nombre %j', (name) => {
    expect(wishlistNameSchema.safeParse(name).success).toBe(false)
  })
  it('distingue idiomas y listas sin colisiones de delimitadores', () => {
    expect(wishlistCardKey('a|en', 'es')).not.toBe(wishlistCardKey('a', 'en'))
    expect(wishlistCardKey(card.id, 'en')).toBe(wishlistCardKey(card.id, 'en'))
    expect(wishlistCardKey(card.id, 'es')).not.toBe(wishlistCardKey(card.id, 'en'))
    expect(isCardWished([item], card.id, 'en')).toBe(true)
    expect(isCardWished([item], card.id, 'en', listId)).toBe(true)
    expect(isCardWished([item], card.id, 'en', otherListId)).toBe(false)
    expect(isCardWished([item], card.id, 'es')).toBe(false)
    expect(isCardWished([item], 'otra', 'en')).toBe(false)
    expect(isCardWished([], card.id, 'en')).toBe(false)
  })
  it.each([undefined, null, 'secret-token', new Error('secret-token'), { message: 'secret-token' }, { code: 'unexpected', details: 'secret-token' }])('oculta errores arbitrarios %j', (error) => {
    expect(wishlistErrorMessage(error)).toContain('No se han podido')
    expect(wishlistErrorMessage(error)).not.toContain('secret-token')
  })
  it.each(['42P01', 'PGRST205', 'PGRST204', '42703'])('orienta sobre 007 para %s', (code) => {
    expect(wishlistErrorMessage({ code, message: 'secret' })).toContain('migración 007')
  })
  it.each(['42501', 'PGRST301', 'PGRST302'])('oculta detalles de sesión %s', (code) => {
    expect(wishlistErrorMessage({ code })).toContain('Inicia sesión')
  })
  it.each(['23514', '23502', '22023', '22P02'])('traduce validación SQL %s', (code) => {
    expect(wishlistErrorMessage({ code })).toContain('no son válidos')
  })
  it('traduce FK y cancelación sin detalles del servidor', () => {
    expect(wishlistErrorMessage({ code: '23503' })).toContain('no pertenece')
    expect(wishlistErrorMessage(new DOMException('secret', 'AbortError'))).toBe('Operación cancelada.')
  })
})

describe('Lectura paginada y defensiva', () => {
  it('carga ambas tablas vacías con filtros explícitos', async () => {
    results.push({ data: [], error: null }, { data: [], error: null })
    await expect(loadWishlists(alice)).resolves.toEqual({ lists: [], items: [] })
    expect(client.auth.getUser).not.toHaveBeenCalled()
    expect(queries.map((q) => q.table)).toEqual(['wishlists', 'wishlist_items'])
    for (const q of queries) {
      expect(q.eq).toHaveBeenCalledExactlyOnceWith('user_id', alice)
      expect(q.range).toHaveBeenCalledExactlyOnceWith(0, 499)
      expect(q.select).not.toHaveBeenCalledWith('*')
    }
  })
  it('lee 501 listas y 501 cartas, con orden total y señal en todas las páginas', async () => {
    const lists = Array.from({ length: 501 }, (_, i) => ({ ...list, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
    const items = lists.map((value) => ({ ...item, list_id: value.id }))
    results.push(...[lists.slice(0, 500), lists.slice(500), items.slice(0, 500), items.slice(500)].map((data) => ({ data, error: null })))
    const signal = new AbortController().signal
    await expect(loadWishlists(alice, signal)).resolves.toEqual({ lists, items })
    for (const [index, q] of queries.entries()) {
      expect(q.eq).toHaveBeenCalledWith('user_id', alice)
      expect(q.range).toHaveBeenCalledWith(index % 2 * 500, index % 2 * 500 + 499)
      expect(q.order.mock.calls).toEqual(q.table === 'wishlists' ? [['id']] : [['list_id'], ['card_id'], ['language']])
      expect(q.abortSignal).toHaveBeenCalledExactlyOnceWith(signal)
    }
  })
  it('solicita una página vacía adicional si hay exactamente 500 filas', async () => {
    results.push({ data: Array.from({ length: 500 }, () => list), error: null }, { data: [], error: null }, { data: [], error: null })
    expect((await loadWishlists(alice)).lists).toHaveLength(500)
    expect(queries[1].range).toHaveBeenCalledWith(500, 999)
  })
  it.each([
    { ...item, card_id: 'otra' },
    { ...item, language: 'fr' },
    { ...item, card_snapshot: { ...card, name: null } },
    { ...item, card_snapshot: { ...card, localId: 1 } },
    { ...item, card_snapshot: { ...card, quantity: 2 } },
    { ...item, card_snapshot: { ...card, image: 'https://evil.example/image' } },
    { ...item, created_at: 'ayer' },
  ])('rechaza filas corruptas sin exponer su contenido %#', async (invalid) => {
    results.push({ data: [list], error: null }, { data: [invalid], error: null })
    await expect(loadWishlists(alice)).rejects.toThrow('no son válidos')
  })
  it.each(['wishlists', 'wishlist_items'])('rechaza un propietario inesperado en %s', async (table) => {
    results.push({ data: [table === 'wishlists' ? { ...list, user_id: bob } : list], error: null })
    if (table === 'wishlist_items') results.push({ data: [{ ...item, user_id: bob }], error: null })
    await expect(loadWishlists(alice)).rejects.toThrow('cuenta activa')
  })
  it('no devuelve resultados parciales si falla la segunda página', async () => {
    results.push({ data: Array.from({ length: 500 }, () => list), error: null }, { data: null, error: { message: 'secret' } })
    await expect(loadWishlists(alice)).rejects.toThrow('No se han podido')
    expect(queries).toHaveLength(2)
  })
  it('rechaza un resultado nulo sin error', async () => {
    await expect(loadWishlists(alice)).rejects.toThrow('No se han podido')
  })
})

describe('Escrituras aisladas e identidad autenticada', () => {
  it('crea y devuelve una lista normalizada con propietario explícito', async () => {
    results.push({ data: list, error: null })
    await expect(createWishlist(alice, ' Favoritas ')).resolves.toEqual(list)
    expect(queries[0].insert).toHaveBeenCalledWith({ user_id: alice, name: 'Favoritas' })
    expect(queries[0].single).toHaveBeenCalledOnce()
  })
  it('renombra únicamente la lista y el propietario indicados', async () => {
    results.push({ data: { id: listId }, error: null })
    await renameWishlist(alice, listId, ' Nueva ')
    expect(queries[0].update).toHaveBeenCalledWith({ name: 'Nueva' })
    expect(queries[0].eq.mock.calls).toEqual([['user_id', alice], ['id', listId]])
    expect(queries[0].single).toHaveBeenCalledOnce()
  })
  it('no informa éxito al renombrar una lista inexistente', async () => {
    await expect(renameWishlist(alice, listId, 'Nueva')).rejects.toThrow('no está disponible')
  })
  it('elimina solo la lista solicitada; la base gestiona la cascada', async () => {
    await deleteWishlist(alice, listId)
    expect(queries).toHaveLength(1)
    expect(queries[0].delete).toHaveBeenCalledOnce()
    expect(queries[0].eq.mock.calls).toEqual([['user_id', alice], ['id', listId]])
  })
  it('añade idempotentemente una ficha breve sin precios ni campos de posesión', async () => {
    const detailed = { ...card, set: { id: 'base1', name: 'Base' }, pricing: { secret: 99 }, quantity: 10, notes: 'private' }
    await addWishlistItem(alice, listId, detailed, 'en')
    await addWishlistItem(alice, listId, detailed, 'en')
    for (const q of queries) {
      expect(q.upsert).toHaveBeenCalledWith({ list_id: listId, user_id: alice, card_id: card.id, language: 'en', card_snapshot: card, target_price: null }, { onConflict: 'list_id,card_id,language', ignoreDuplicates: true })
      expect(q.update).not.toHaveBeenCalled()
    }
    expect(detailed.quantity).toBe(10)
  })
  it.each([undefined, null, card.image, 'https://assets.tcgdex.net/en/sv/sv03.5/200'])('admite imagen ausente, nula o TCGdex: %s', async (image) => {
    await expect(addWishlistItem(alice, listId, { ...card, image }, 'en')).resolves.toBeUndefined()
    if (image) expect(imageUrl(image)).toBe(`${image}/low.webp`)
    else expect(imageUrl(image)).toBeUndefined()
  })
  it('elimina solo la combinación lista/carta/idioma del propietario', async () => {
    await removeWishlistItem(alice, listId, card.id, 'en')
    expect(queries[0].delete).toHaveBeenCalledOnce()
    expect(queries[0].eq.mock.calls).toEqual([['user_id', alice], ['list_id', listId], ['card_id', card.id], ['language', 'en']])
  })
  it('guarda y valida el precio objetivo de una carta', async () => {
    results.push({ data: { list_id: listId }, error: null })
    await updateWishlistItemTargetPrice(alice, listId, card.id, 'en', 12.5)
    expect(queries[0].update).toHaveBeenCalledWith({ target_price: 12.5 })
    expect(queries[0].eq.mock.calls).toEqual([['user_id', alice], ['list_id', listId], ['card_id', card.id], ['language', 'en']])
    await expect(updateWishlistItemTargetPrice(alice, listId, card.id, 'en', -1)).rejects.toThrow('no son válidos')
  })
  it.each(writes)('%s comprueba getUser antes de escribir y propaga la señal', async (_name, write) => {
    results.push({ data: list, error: null })
    const signal = new AbortController().signal
    await write(alice, signal)
    expect(client.auth.getUser).toHaveBeenCalledOnce()
    expect(client.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(client.from.mock.invocationCallOrder[0])
    expect(queries[0].eq).toHaveBeenCalledWith('user_id', alice)
    expect(queries[0].abortSignal).toHaveBeenCalledWith(signal)
  })
  it.each(writes)('%s rechaza otra cuenta sin escribir', async (_name, write) => {
    await expect(write(bob)).rejects.toThrow('cuenta activa')
    expect(client.from).not.toHaveBeenCalled()
  })
  it.each(writes)('%s valida UUID antes de conectar', async (_name, write) => {
    await expect(write('invalid')).rejects.toThrow('no son válidos')
    expect(requireClient).not.toHaveBeenCalled()
  })
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: alice, is_anonymous: true } }, error: null },
    { data: { user: { id: alice } }, error: null },
    { data: { user: { id: alice, is_anonymous: false } }, error: { message: 'secret' } },
  ])('rechaza sesión inválida en todas las escrituras %#', async (response) => {
    client.auth.getUser.mockResolvedValue(response)
    for (const [, write] of writes) await expect(write(alice)).rejects.toThrow('cuenta activa')
    expect(client.from).not.toHaveBeenCalled()
  })
  it.each(writes)('%s sanitiza un error SQL', async (_name, write) => {
    results.push({ data: null, error: { code: '23503', message: 'secret' } })
    await expect(write(alice)).rejects.toThrow('no pertenece')
  })
  it('sanitiza rechazos de autenticación y transporte', async () => {
    client.auth.getUser.mockRejectedValueOnce(new Error('secret JWT'))
    await expect(deleteWishlist(alice, listId)).rejects.toThrow('No se han podido')
    client.from.mockImplementationOnce(() => { throw new Error('secret connection') })
    await expect(loadWishlists(alice)).rejects.toThrow('No se han podido')
  })
  it('valida nombres, lista, carta e idioma antes de conectar', async () => {
    await expect(createWishlist(alice, ' ')).rejects.toThrow('no son válidos')
    await expect(renameWishlist(alice, listId, 'x'.repeat(81))).rejects.toThrow('no son válidos')
    await expect(deleteWishlist(alice, 'invalid')).rejects.toThrow('no son válidos')
    await expect(addWishlistItem(alice, listId, { ...card, id: '' }, 'en')).rejects.toThrow('no son válidos')
    await expect(removeWishlistItem(alice, listId, '', 'en')).rejects.toThrow('no son válidos')
    await expect(addWishlistItem(alice, listId, card, 'fr' as Language)).rejects.toThrow('no son válidos')
    await expect(removeWishlistItem(alice, listId, card.id, 'fr' as Language)).rejects.toThrow('no son válidos')
    await expect(loadWishlists('invalid')).rejects.toThrow('no son válidos')
    expect(requireClient).not.toHaveBeenCalled()
  })
  it.each(['http://assets.tcgdex.net/en/a', 'https://assets.tcgdex.net.evil.example/a', 'https://evil.example/a', 'javascript:alert(1)', 'https://assets.tcgdex.net@evil.example/a', 'https://assets.tcgdex.net/a?tracking=1', 'https://assets.tcgdex.net:444/a', 'https://assets.tcgdex.net/a\n'])('rechaza imágenes externas o ambiguas: %j', async (image) => {
    await expect(addWishlistItem(alice, listId, { ...card, image }, 'en')).rejects.toThrow('no son válidos')
    expect(client.from).not.toHaveBeenCalled()
  })
})

describe('Cancelación', () => {
  it('no conecta si la señal ya está cancelada', async () => {
    const controller = new AbortController()
    controller.abort('secret reason')
    await expect(loadWishlists(alice, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Operación cancelada.' })
    for (const [, write] of writes) await expect(write(alice, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(requireClient).not.toHaveBeenCalled()
  })
  it.each(writes)('%s no escribe después de cancelar durante getUser', async (_name, write) => {
    const controller = new AbortController()
    let finish!: (value: unknown) => void
    client.auth.getUser.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const pending = write(alice, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    finish({ data: { user: { id: alice, is_anonymous: false } }, error: null })
    await Promise.resolve()
    expect(client.from).not.toHaveBeenCalled()
  })
  it('cancela una página pendiente sin iniciar más consultas', async () => {
    const controller = new AbortController()
    let finish!: (value: Result) => void
    results.push(new Promise((resolve) => { finish = resolve }))
    const pending = loadWishlists(alice, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    finish({ data: Array.from({ length: 500 }, () => list), error: null })
    await Promise.resolve()
    expect(queries).toHaveLength(1)
  })
})
