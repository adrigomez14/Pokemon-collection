import { z } from 'zod'
import { briefSchema, cardSchema, type Language } from './models'

const BASE = 'https://api.tcgdex.net/v2'
export const PAGE_SIZE = 24
export type Search = { name: string; set: string; number: string; page: number }

async function request(path: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(`${BASE}/${path}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw new Error(response.status === 404 ? 'Esta carta no está disponible en ese idioma.' : 'El catálogo no está disponible. Inténtalo de nuevo más tarde.')
  return response.json() as Promise<unknown>
}

export async function searchCards(language: Language, search: Search, signal?: AbortSignal) {
  const params = new URLSearchParams({ 'pagination:page': String(search.page), 'pagination:itemsPerPage': String(PAGE_SIZE) })
  if (search.name.trim()) params.set('name', search.name.trim())
  if (search.set.trim()) params.set('set.id', `eq:${search.set.trim()}`)
  if (search.number.trim()) params.set('localId', `eq:${search.number.trim()}`)
  return z.array(briefSchema).parse(await request(`${language}/cards?${params}`, signal))
}

export async function getCard(language: Language, id: string, signal?: AbortSignal) {
  return cardSchema.parse(await request(`${language}/cards/${encodeURIComponent(id)}`, signal))
}