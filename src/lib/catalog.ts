import { z } from 'zod'
import { briefSchema, cardSchema, type Language } from './models'

const BASE = 'https://api.tcgdex.net/v2'
export const PAGE_SIZE = 24
export const LATEST_SET = '__latest__'
export const sortOptions = {
  catalog: 'Orden del catálogo', 'name-asc': 'Nombre: A → Z', 'name-desc': 'Nombre: Z → A',
  'number-asc': 'Número: ascendente', 'number-desc': 'Número: descendente',
} as const
export type Search = {
  name: string; set: string; number: string; page: number;
  exactName?: boolean; category?: string; rarity?: string; type?: string; imageOnly?: boolean;
  sort?: keyof typeof sortOptions;
}
export type FilterField = 'categories' | 'rarities' | 'types'

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
  if (search.sort && search.sort !== 'catalog') {
    params.set('sort:field', search.sort.startsWith('name-') ? 'name' : 'localId')
    params.set('sort:order', search.sort.endsWith('-desc') ? 'DESC' : 'ASC')
  }
  if (search.set === LATEST_SET) {
    // La API ordena expansiones por lanzamiento, pero ignora ese campo en cartas.
    const ordered = z.array(setSchema).parse(await request(`${language}/sets?sort:field=releaseDate&sort:order=DESC`, signal))
    const latest = ordered.find((set) => set.cardCount.total > 0)
    if (!latest) return []
    params.set('set.id', `eq:${latest.id}`)
    if (!search.sort || search.sort === 'catalog') {
      params.set('sort:field', 'localId')
      params.set('sort:order', 'ASC')
    }
  }
  return z.array(briefSchema).parse(await request(`${language}/cards?${params}`, signal))
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