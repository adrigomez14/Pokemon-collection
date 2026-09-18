import { z } from 'zod'
import { briefSchema, languageSchema, type CardBrief, type Language } from './models'
import { requireSupabase } from './supabase'

export const wishlistNameSchema = z.string().trim().min(1, 'Escribe un nombre.').max(80, 'El nombre admite hasta 80 caracteres.')
const uuidSchema = z.string().uuid()
const cardIdSchema = briefSchema.shape.id
// La ficha persistida no contiene precios, enlaces externos ni datos de colección.
// CardImage sigue siendo el único responsable del renderizado mediante imageUrl.
const snapshotSchema = briefSchema.strict().extend({
  image: z.string().max(2048).regex(/^https:\/\/assets\.tcgdex\.net\/[A-Za-z0-9_./-]+$/)
    .refine((image) => image === image.trim()).nullish(),
})
const listSchema = z.object({
  id: uuidSchema, user_id: uuidSchema, name: wishlistNameSchema, created_at: z.iso.datetime({ offset: true }),
})
const itemSchema = z.object({
  list_id: uuidSchema, user_id: uuidSchema, card_id: cardIdSchema, language: languageSchema,
  card_snapshot: snapshotSchema, target_price: z.number().finite().nonnegative().nullable().default(null), created_at: z.iso.datetime({ offset: true }),
}).refine((item) => item.card_id === item.card_snapshot.id)
const priceAlertSchema = z.object({
  id: uuidSchema, user_id: uuidSchema, list_id: uuidSchema, card_id: cardIdSchema, language: languageSchema,
  target_price: z.number().finite().nonnegative(), observed_price: z.number().finite().nonnegative(),
  created_at: z.iso.datetime({ offset: true }), read_at: z.iso.datetime({ offset: true }).nullish(),
})

export type Wishlist = z.infer<typeof listSchema>
export type WishlistItem = z.infer<typeof itemSchema>
export type WishlistPriceAlert = z.infer<typeof priceAlertSchema>
export type WishlistData = { lists: Wishlist[]; items: WishlistItem[] }

class WishlistError extends Error {}
const sessionMessage = 'La cuenta activa no coincide o no está autenticada. Inicia sesión de nuevo.'
const genericMessage = 'No se han podido cargar o guardar tus listas de deseos. Comprueba tu conexión e inténtalo de nuevo.'

/** Mensajes locales: nunca presenta detalles SQL, tokens ni errores de red sin filtrar. */
export function wishlistErrorMessage(error: unknown): string {
  if (error instanceof WishlistError) return error.message
  if (error instanceof z.ZodError) return 'Los datos de la lista o de la carta no son válidos. El nombre debe tener entre 1 y 80 caracteres.'
  const fields = error !== null && typeof error === 'object' ? error as { code?: unknown; name?: unknown } : {}
  if (fields.name === 'AbortError') return 'Operación cancelada.'
  if (['PGRST205', 'PGRST204', '42P01', '42703'].includes(String(fields.code))) return 'Falta preparar las listas de deseos. Aplica la migración 007 una sola vez.'
  if (['42501', 'PGRST301', 'PGRST302'].includes(String(fields.code))) return sessionMessage
  if (['23514', '23502', '22023', '22P02'].includes(String(fields.code))) return 'Los datos de la lista o de la carta no son válidos.'
  if (fields.code === '23503') return 'La lista ya no existe o no pertenece a tu cuenta. Vuelve a cargar tus listas.'
  return genericMessage
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Operación cancelada.', 'AbortError')
}

/** getUser no admite señal; interrumpimos la espera sin continuar después con una escritura. */
async function abortable<T>(request: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal)
  if (!signal) return await request
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Operación cancelada.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(request).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function safely<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  try {
    checkAbort(signal)
    const result = await action()
    checkAbort(signal)
    return result
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new DOMException('Operación cancelada.', 'AbortError')
    }
    throw new WishlistError(wishlistErrorMessage(error))
  }
}

async function writeClient(userId: string, signal?: AbortSignal) {
  uuidSchema.parse(userId)
  checkAbort(signal)
  const client = requireSupabase()
  const { data, error } = await abortable(client.auth.getUser(), signal)
  checkAbort(signal)
  if (error || !data.user || data.user.id !== userId || data.user.is_anonymous !== false) throw new WishlistError(sessionMessage)
  // Esta comprobación evita errores de sesión en el cliente; la autorización real es RLS.
  return client
}

function ownedRows<T extends { user_id: string }>(rows: T[], userId: string): T[] {
  if (rows.some((row) => row.user_id !== userId)) throw new WishlistError(sessionMessage)
  return rows
}

/** Lee páginas de 500 filas, siempre filtradas por propietario y con orden total. */
export async function loadWishlists(userId: string, signal?: AbortSignal): Promise<WishlistData> {
  return safely(signal, async () => {
    uuidSchema.parse(userId)
    const client = requireSupabase()
    const lists: Wishlist[] = []
    const items: WishlistItem[] = []
    for (const table of ['wishlists', 'wishlist_items'] as const) {
      for (let offset = 0; ; offset += 500) {
        checkAbort(signal)
        let query = client.from(table).select(table === 'wishlists'
          ? 'id,user_id,name,created_at' : 'list_id,user_id,card_id,language,card_snapshot,target_price,created_at').eq('user_id', userId)
        query = table === 'wishlists' ? query.order('id') : query.order('list_id').order('card_id').order('language')
        query = query.range(offset, offset + 499)
        if (signal) query = query.abortSignal(signal)
        const { data, error } = await abortable(query, signal)
        checkAbort(signal)
        if (error) throw error
        if (!data) throw new WishlistError(genericMessage)
        if (table === 'wishlists') lists.push(...ownedRows(z.array(listSchema).parse(data), userId))
        else items.push(...ownedRows(z.array(itemSchema).parse(data), userId))
        if (data.length < 500) break
      }
    }
    return { lists, items }
  })
}

export async function loadWishlistPriceAlerts(userId: string, signal?: AbortSignal): Promise<WishlistPriceAlert[]> {
  return safely(signal, async () => {
    const client = await writeClient(userId, signal)
    let query = client.from('wishlist_price_alerts').select('id,user_id,list_id,card_id,language,target_price,observed_price,created_at,read_at')
      .eq('user_id', userId).is('read_at', null).order('created_at', { ascending: false }).limit(20)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await abortable(query, signal)
    if (error) throw error
    return ownedRows(z.array(priceAlertSchema).parse(data ?? []), userId)
  })
}

export async function loadPriceAlertEmailPreference(userId: string, signal?: AbortSignal): Promise<boolean> {
  const client = await writeClient(userId, signal)
  const { data, error } = await abortable(client.auth.getUser(), signal)
  if (error || !data.user || data.user.id !== userId) throw new WishlistError(sessionMessage)
  return data.user.user_metadata?.price_alert_email === true
}

export async function updatePriceAlertEmailPreference(userId: string, enabled: boolean, signal?: AbortSignal): Promise<void> {
  const client = await writeClient(userId, signal)
  const { error } = await abortable(client.auth.updateUser({ data: { price_alert_email: enabled } }), signal)
  if (error) throw new WishlistError(wishlistErrorMessage(error))
}

export async function markWishlistPriceAlertsRead(userId: string, signal?: AbortSignal): Promise<void> {
  return safely(signal, async () => {
    const client = await writeClient(userId, signal)
    let query = client.from('wishlist_price_alerts').update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).is('read_at', null)
    if (signal) query = query.abortSignal(signal)
    const { error } = await abortable(query, signal)
    if (error) throw error
  })
}

export async function createWishlist(userId: string, name: string, signal?: AbortSignal): Promise<Wishlist> {
  return safely(signal, async () => {
    const parsedName = wishlistNameSchema.parse(name)
    const client = await writeClient(userId, signal)
    let query = client.from('wishlists').insert({ user_id: userId, name: parsedName })
      .select('id,user_id,name,created_at').eq('user_id', userId)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await abortable(query.single(), signal)
    if (error) throw error
    const list = listSchema.parse(data)
    if (list.user_id !== userId) throw new WishlistError(sessionMessage)
    return list
  })
}

export async function renameWishlist(userId: string, listId: string, name: string, signal?: AbortSignal): Promise<void> {
  return safely(signal, async () => {
    uuidSchema.parse(listId)
    const parsedName = wishlistNameSchema.parse(name)
    const client = await writeClient(userId, signal)
    let query = client.from('wishlists').update({ name: parsedName }).eq('user_id', userId).eq('id', listId).select('id')
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await abortable(query.single(), signal)
    if (error) throw error
    if (!data) throw new WishlistError('La lista ya no está disponible. Vuelve a cargar tus listas.')
  })
}

export async function deleteWishlist(userId: string, listId: string, signal?: AbortSignal): Promise<void> {
  return safely(signal, async () => {
    uuidSchema.parse(listId)
    const client = await writeClient(userId, signal)
    let query = client.from('wishlists').delete().eq('user_id', userId).eq('id', listId)
    if (signal) query = query.abortSignal(signal)
    const { error } = await abortable(query, signal)
    if (error) throw error
  })
}

export async function addWishlistItem(userId: string, listId: string, card: CardBrief, language: Language, signal?: AbortSignal): Promise<void> {
  return safely(signal, async () => {
    uuidSchema.parse(listId)
    const snapshot = snapshotSchema.strip().parse(card)
    const parsedLanguage = languageSchema.parse(language)
    const client = await writeClient(userId, signal)
    let query = client.from('wishlist_items').upsert({
      list_id: listId, user_id: userId, card_id: snapshot.id, language: parsedLanguage, card_snapshot: snapshot, target_price: null,
    }, { onConflict: 'list_id,card_id,language', ignoreDuplicates: true }).eq('user_id', userId)
    if (signal) query = query.abortSignal(signal)
    const { error } = await abortable(query, signal)
    if (error) throw error
  })
}

export async function updateWishlistItemTargetPrice(userId: string, listId: string, cardId: string, language: Language, targetPrice: number | null, signal?: AbortSignal): Promise<void> {
  return safely(signal, async () => {
    uuidSchema.parse(listId)
    cardIdSchema.parse(cardId)
    const parsedLanguage = languageSchema.parse(language)
    const parsedPrice = targetPrice === null ? null : z.number().finite().nonnegative().max(9999999).parse(targetPrice)
    const client = await writeClient(userId, signal)
    let query = client.from('wishlist_items').update({ target_price: parsedPrice })
      .eq('user_id', userId).eq('list_id', listId).eq('card_id', cardId).eq('language', parsedLanguage).select('list_id')
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await abortable(query.single(), signal)
    if (error) throw error
    if (!data) throw new WishlistError('La carta ya no está en esta lista. Vuelve a cargar tus listas.')
  })
}

export async function removeWishlistItem(userId: string, listId: string, cardId: string, language: Language, signal?: AbortSignal): Promise<void> {
  return safely(signal, async () => {
    uuidSchema.parse(listId)
    cardIdSchema.parse(cardId)
    languageSchema.parse(language)
    const client = await writeClient(userId, signal)
    let query = client.from('wishlist_items').delete().eq('user_id', userId).eq('list_id', listId).eq('card_id', cardId).eq('language', language)
    if (signal) query = query.abortSignal(signal)
    const { error } = await abortable(query, signal)
    if (error) throw error
  })
}

export function wishlistCardKey(cardId: string, language: Language): string {
  return JSON.stringify([cardId, language])
}

export function isCardWished(items: readonly WishlistItem[], cardId: string, language: Language, listId?: string): boolean {
  return items.some((item) => item.card_id === cardId && item.language === language && (listId === undefined || item.list_id === listId))
}
