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

// Respuesta reducida observada el 16/09/2026; fija para pruebas, nunca usada como precio en producción.
export const holoOnlyCard: Card = {
  id: 'sv03.5-200', name: 'Blastoise ex', localId: '200',
  image: 'https://assets.tcgdex.net/es/sv/sv03.5/200',
  set: { id: 'sv03.5', name: '151' }, rarity: 'Rara Ilustración Especial',
  variants: { holo: true, normal: false, reverse: false, firstEdition: false },
  pricing: { cardmarket: { unit: 'EUR', idProduct: 733795, trend: 134.4, low: 75, 'trend-holo': 0, 'low-holo': null, updated: '2026-09-16T18:05:40.265Z' } },
  variants_detailed: [{
    type: 'holo', size: 'estándar', thirdParty: { cardmarket: 733795 },
    pricing: { cardmarket: { unit: 'EUR', idProduct: 733795, trend: 134.4, low: 75, 'trend-holo': 0, 'low-holo': null, updated: '2026-09-16T18:05:40.265Z' } },
  }],
}