import { z } from 'zod'

export const languages = { es: 'Español', en: 'Inglés', ja: 'Japonés' } as const
export const variants = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse holo', firstEdition: 'Primera edición' } as const
export const conditions = { M: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' } as const
export const languageSchema = z.enum(['es', 'en', 'ja'])
export const variantSchema = z.enum(['normal', 'holo', 'reverse', 'firstEdition'])
export const conditionSchema = z.enum(['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'])
export type Language = z.infer<typeof languageSchema>
export type Variant = z.infer<typeof variantSchema>
export type Condition = z.infer<typeof conditionSchema>

const priceNumber = z.number().finite().nonnegative().nullish()
export const marketSchema = z.object({
  unit: z.string(), updated: z.string().nullish(), idProduct: z.number().int().positive().nullish(),
  trend: priceNumber, avg: priceNumber, low: priceNumber, avg7: priceNumber, avg30: priceNumber,
  'trend-holo': priceNumber, 'avg-holo': priceNumber,
})
export const briefSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(200),
  localId: z.string().max(50), image: z.string().url().nullish(),
})
export const cardSchema = briefSchema.extend({
  set: z.object({ id: z.string(), name: z.string() }),
  rarity: z.string().nullish(),
  variants: z.object({ normal: z.boolean().optional(), holo: z.boolean().optional(), reverse: z.boolean().optional(), firstEdition: z.boolean().optional() }).nullish(),
  pricing: z.object({ cardmarket: marketSchema.nullish() }).nullish(),
})
export type CardBrief = z.infer<typeof briefSchema>
export type Card = z.infer<typeof cardSchema>

export const entryInputSchema = z.object({
  card_id: z.string().min(1).max(100), language: languageSchema,
  variant: variantSchema, condition: conditionSchema,
  quantity: z.number().int().min(1).max(9999),
  manual_value: z.number().finite().min(0).max(9999999).nullable(),
  notes: z.string().max(2000), card_snapshot: cardSchema,
}).refine((entry) => entry.card_id === entry.card_snapshot.id, 'La carta no coincide con su identificador')
export type EntryInput = z.infer<typeof entryInputSchema>
export const entrySchema = entryInputSchema.safeExtend({
  id: z.string().uuid(), user_id: z.string().uuid(), updated_at: z.string(),
})
export type Entry = z.infer<typeof entrySchema>
export const backupSchema = z.object({
  version: z.literal(1), exportedAt: z.string(), entries: z.array(entryInputSchema).max(3000),
})

/** Referencia del proveedor, nunca una tasación por idioma o conservación. */
export function marketValue(card: Card, variant: Variant): number | null {
  const market = card.pricing?.cardmarket
  if (!market || market.unit !== 'EUR') return null
  // No inferir precios reverse/primera edición a partir de otra variante.
  const value = variant === 'normal' ? market.trend : variant === 'holo' ? market['trend-holo'] : null
  // Un cero del feed no demuestra que una carta no tenga valor: no tasarlo como una venta gratuita.
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function entryValue(entry: EntryInput) {
  return entry.manual_value ?? marketValue(entry.card_snapshot, entry.variant)
}

export function collectionStats(entries: EntryInput[]) {
  return entries.reduce((stats, entry) => {
    const value = entryValue(entry)
    stats.copies += entry.quantity
    if (value === null) stats.unpriced += entry.quantity
    else stats.total += Math.round(value * 100) * entry.quantity / 100
    if (entry.manual_value !== null) stats.manual += entry.quantity
    return stats
  }, { copies: 0, total: 0, unpriced: 0, manual: 0 })
}

export const euros = (value: number | null) => value === null ? 'Sin precio' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
export function formatDate(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Fecha no disponible'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value))
}

export function cardmarketUrl(card: CardBrief) {
  const url = new URL('https://www.cardmarket.com/es/Pokemon/Products/Search')
  url.searchParams.set('searchString', `${card.name} ${card.localId}`)
  return url.href
}

export function imageUrl(image?: string | null, quality = 'low') {
  // Las imágenes externas importadas no pueden rastrear la sesión del usuario.
  if (!image) return undefined
  try {
    const url = new URL(image)
    if (url.protocol !== 'https:' || url.hostname !== 'assets.tcgdex.net') return undefined
    return `${image}/${quality}.webp`
  } catch { return undefined }
}

export function parseBackup(text: string) {
  if (new Blob([text]).size > 5 * 1024 * 1024) throw new Error('La copia supera el límite de 5 MB.')
  const backup = backupSchema.safeParse(JSON.parse(text))
  if (!backup.success) throw new Error('Copia no válida. Usa un archivo exportado por esta aplicación (máximo 3000 registros).')
  const keys = backup.data.entries.map((entry) => [entry.card_id, entry.language, entry.variant, entry.condition].join('|'))
  if (new Set(keys).size !== keys.length) throw new Error('La copia contiene registros duplicados.')
  return backup.data
}

/** Divide colecciones grandes en copias que pueden volver a importarse. */
export function createBackupParts(entries: EntryInput[]) {
  const parts: string[] = []
  let batch: EntryInput[] = []
  let size = 0
  const exportedAt = new Date().toISOString()
  const flush = () => {
    if (batch.length) parts.push(JSON.stringify({ version: 1, exportedAt, entries: batch }))
    batch = []; size = 0
  }
  for (const raw of entries) {
    const entry = entryInputSchema.parse(raw)
    const bytes = new TextEncoder().encode(JSON.stringify(entry)).length + 1
    if (bytes > 4 * 1024 * 1024) throw new Error('Una carta contiene demasiados datos para exportarse.')
    // Margen para envoltorio JSON y expansión de espacios de jsonb en Postgres.
    if (batch.length >= 3000 || size + bytes > 4 * 1024 * 1024) flush()
    batch.push(entry); size += bytes
  }
  flush()
  return parts
}