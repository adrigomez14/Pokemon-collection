import { z } from 'zod'
import { briefSchema, cardSchema, type Language } from './models'
import { rarityRank } from './rarity'

const BASE = 'https://api.tcgdex.net/v2'
export const PAGE_SIZE = 24
export const LATEST_SET = '__latest__'
export const sortOptions = {
  'rarity-desc': 'Rareza: más raras primero',
  catalog: 'Orden del catálogo', 'name-asc': 'Nombre: A → Z', 'name-desc': 'Nombre: Z → A',
  'number-asc': 'Número: ascendente', 'number-desc': 'Número: descendente',
} as const
export type Search = {
  name: string; set: string; number: string; page: number;
  exactName?: boolean; category?: string; rarity?: string; type?: string; imageOnly?: boolean;
  sort?: keyof typeof sortOptions;
}
export type FilterField = 'categories' | 'rarities' | 'types'

/** Por defecto, las expansiones se presentan de mayor a menor rareza. */
export function catalogSort(search: Search): keyof typeof sortOptions {
  return search.sort ?? (search.set.trim() ? 'rarity-desc' : 'catalog')
}

const rarityCache = new Map<string, { expires: number; ranks: Map<string, number> }>()

/** Invalida la clasificación al solicitar una actualización manual del catálogo. */
export function clearRarityCache(language?: Language) {
  for (const key of rarityCache.keys()) {
    if (!language || key.startsWith(`${language}:`)) rarityCache.delete(key)
  }
}

export const setSchema = z.object({
  id: z.string().min(1), name: z.string().min(1),
  cardCount: z.object({ total: z.number().int().nonnegative(), official: z.number().int().nonnegative() }),
})

async function request(path: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(`${BASE}/${path}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw new Error(response.status === 404 ? 'Esta carta no está disponible en ese idioma.' : 'El catálogo no está disponible. Inténtalo de nuevo más tarde.')
  return response.json() as Promise<unknown>
}

export async function searchCards(language: Language, search: Search, signal?: AbortSignal) {
  const sort = catalogSort(search)
  if (sort === 'rarity-desc' && !search.set.trim()) throw new Error('Selecciona una expansión para ordenar por rareza.')
  const params = new URLSearchParams({ 'pagination:page': String(search.page), 'pagination:itemsPerPage': String(PAGE_SIZE) })
  if (search.name.trim()) params.set('name', `${search.exactName ? 'eq:' : 'like:'}${search.name.trim()}`)
  if (search.set.trim() && search.set !== LATEST_SET) params.set('set.id', `eq:${search.set.trim()}`)
  if (search.number.trim()) {
    const number = search.number.trim()
    if (!/^[a-zA-Z0-9-]+$/.test(number)) throw new Error('Usa el número o código de la carta, sin barras ni comodines (ej. 025 o SVP001).')
    // localId=eq:200 devolvía [] para cartas válidas. El ID termina en -<localId>.
    params.set('id', `like:*-${number}`)
  }
  if (search.category) params.set('category', `eq:${search.category}`)
  if (search.rarity) params.set('rarity', `eq:${search.rarity}`)
  if (search.type) params.set('types', `eq:${search.type}`)
  if (search.imageOnly) params.set('image', 'notnull:')
  if (sort !== 'catalog' && sort !== 'rarity-desc') {
    params.set('sort:field', sort.startsWith('name-') ? 'name' : 'localId')
    params.set('sort:order', sort.endsWith('-desc') ? 'DESC' : 'ASC')
  }
  if (search.set === LATEST_SET) {
    // La API ordena expansiones por lanzamiento, pero ignora ese campo en cartas.
    const ordered = z.array(setSchema).parse(await request(`${language}/sets?sort:field=releaseDate&sort:order=DESC`, signal))
    const latest = ordered.find((set) => set.cardCount.total > 0)
    if (!latest) return []
    params.set('set.id', `eq:${latest.id}`)
    if (sort === 'catalog') {
      params.set('sort:field', 'localId')
      params.set('sort:order', 'ASC')
    }
  }
  if (sort === 'rarity-desc') {
    // Ordenar TODA la selección antes de paginar, no solo las 24 cartas visibles.
    params.delete('pagination:page')
    params.delete('pagination:itemsPerPage')
    const cards = z.array(briefSchema).parse(await request(`${language}/cards?${params}`, signal))
    if (!cards.length) return []
    // Con un filtro de rareza todas las cartas comparten categoría: basta desempatar por número.
    const ranks = search.rarity ? new Map<string, number>() : await getRarityRanks(language, params.get('set.id')!, signal)
    const compare = new Intl.Collator(language, { numeric: true }).compare
    cards.sort((a, b) => (ranks.get(b.id) ?? 25) - (ranks.get(a.id) ?? 25)
      || compare(b.localId, a.localId) || compare(a.id, b.id))
    return cards.slice((search.page - 1) * PAGE_SIZE, search.page * PAGE_SIZE)
  }
  return z.array(briefSchema).parse(await request(`${language}/cards?${params}`, signal))
}

/**
 * El listado REST omite la rareza. Consultamos grupos localizados de rarezas por expansión,
 * no una ficha por carta. TCGdex admite valores unidos con | y listados sin paginación.
 * Caché de resultados completos: 5 minutos, 8 expansiones/idiomas como máximo.
 */
async function getRarityRanks(language: Language, setFilter: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const key = `${language}:${setFilter}`
  const cached = rarityCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.ranks
  rarityCache.delete(key)
  const rarities = await getFilterValues(language, 'rarities', signal)
  if (!rarities.length) throw new Error('No se pudo clasificar la rareza. Reintenta o selecciona «Orden del catálogo».')
  const groups = new Map<number, string[]>()
  for (const rarity of rarities) {
    const rank = rarityRank(rarity)
    // Las categorías desconocidas y las cartas sin rareza comparten el nivel neutro.
    if (rank !== 25) groups.set(rank, [...groups.get(rank) ?? [], rarity])
  }
  const queue = [...groups.entries()]
  const ranks = new Map<string, number>()
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let next = 0
  async function worker() {
    while (next < queue.length) {
      combined.throwIfAborted()
      const [rank, names] = queue[next++]
      const params = new URLSearchParams({ 'set.id': setFilter, rarity: `eq:${names.join('|')}` })
      const cards = z.array(briefSchema).parse(await request(`${language}/cards?${params}`, combined))
      for (const card of cards) ranks.set(card.id, rank)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()))
    combined.throwIfAborted()
    while (rarityCache.size >= 8) rarityCache.delete(rarityCache.keys().next().value!)
    rarityCache.set(key, { expires: Date.now() + 5 * 60 * 1000, ranks })
    return ranks
  } catch (error) {
    controller.abort()
    throw error
  }
}

export async function getCard(language: Language, id: string, signal?: AbortSignal) {
  return cardSchema.parse(await request(`${language}/cards/${encodeURIComponent(id)}`, signal))
}

/** El índice se obtiene del proveedor en ejecución, no de una lista compilada. */
export async function getSets(language: Language, signal?: AbortSignal) {
  const sets = z.array(setSchema).parse(await request(`${language}/sets`, signal))
  return sets.sort((a, b) => a.name.localeCompare(b.name, language, { numeric: true }))
}

/** Vocabularios localizados: no enviar términos españoles al catálogo japonés. */
export async function getFilterValues(language: Language, field: FilterField, signal?: AbortSignal) {
  return z.array(z.string().min(1)).parse(await request(`${language}/${field}`, signal))
    .sort((a, b) => a.localeCompare(b, language, { numeric: true }))
}
