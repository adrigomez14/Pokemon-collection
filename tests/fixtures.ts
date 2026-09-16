import type { Card, EntryInput } from '../src/lib/models'

// Datos ficticios exclusivamente para pruebas. No se muestran en producción.
export const card: Card = {
  id: 'base1-58', name: 'Pikachu', localId: '58',
  image: 'https://assets.tcgdex.net/en/base/base1/58',
  set: { id: 'base1', name: 'Base Set' }, rarity: 'Common',
  variants: { normal: true, holo: true, reverse: true, firstEdition: true },
  pricing: { cardmarket: { unit: 'EUR', trend: 2.5, 'trend-holo': 5, updated: '2026-09-15T00:00:00Z' } },
}
export const entry: EntryInput = {
  card_id: card.id, language: 'en', variant: 'normal', condition: 'NM',
  quantity: 2, manual_value: null, notes: 'Carpeta 1', card_snapshot: card,
}