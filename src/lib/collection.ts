import { z } from 'zod'
import { requireSupabase } from './supabase'
import { cardSchema, entrySchema, entryInputSchema, type Card, type EntryInput } from './models'

function databaseError(error: { code?: string; message: string }) {
  if (error.code === 'PGRST204' || error.code === '42703') return new Error('Falta actualizar la base de datos para guardar enlaces. Ejecuta la migración 002_cardmarket_links.sql, sin repetir la primera migración.')
  if (error.code === '23505') return new Error('Ya existe un registro con esa carta, idioma, variante y conservación. Modifica su cantidad en vez de duplicarlo.')
  if (error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42P01') return new Error('Falta preparar la base de datos. Ejecuta la migración SQL indicada en la guía de configuración.')
  if (error.code === '23514' || error.code === '22023') return new Error('Los datos o la cantidad no son válidos. Máximo 9999 ejemplares por registro.')
  return new Error('No se ha podido guardar o cargar la colección. Comprueba tu conexión y tu sesión e inténtalo de nuevo.')
}

export async function loadCollection(userId: string, signal?: AbortSignal) {
  const client = requireSupabase()
  const result: unknown[] = []
  // Supabase limita las respuestas: leer todas las páginas, no truncar la colección a 1000.
  for (let offset = 0; ; offset += 500) {
    let query = client.from('collection_entries').select('*').eq('user_id', userId).order('id').range(offset, offset + 499)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw databaseError(error)
    result.push(...data)
    if (data.length < 500) break
  }
  return z.array(entrySchema).parse(result)
}

export async function addEntry(input: EntryInput) {
  const client = requireSupabase()
  const entry = entryInputSchema.parse(input)
  if (entry.cardmarket_url) {
    // Evita que la RPC antigua acepte la carta pero descarte silenciosamente el enlace.
    const { error } = await client.from('collection_entries').select('cardmarket_url').limit(0)
    if (error) throw databaseError(error)
  }
  const { error } = await client.rpc('add_collection_entry', { entry })
  if (error) throw databaseError(error)
}

export async function updateEntry(id: string, input: EntryInput) {
  const { data, error } = await requireSupabase().from('collection_entries').update(entryInputSchema.parse(input)).eq('id', id).select('id').single()
  if (error || !data) throw databaseError(error ?? { message: 'Registro no encontrado' })
}

export async function removeEntry(id: string) {
  const { error } = await requireSupabase().from('collection_entries').delete().eq('id', id)
  if (error) throw databaseError(error)
}

export async function updateSnapshot(id: string, userId: string, card: Card) {
  const { error } = await requireSupabase().from('collection_entries').update({ card_snapshot: cardSchema.parse(card) }).eq('id', id).eq('user_id', userId)
  if (error) throw databaseError(error)
}

export async function importEntries(entries: EntryInput[]) {
  const { error } = await requireSupabase().rpc('import_collection', { entries })
  if (error) throw databaseError(error)
}