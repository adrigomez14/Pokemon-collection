import { describe, expect, it } from 'vitest'
import { cardmarketUrl, collectionStats, createBackupParts, entryInputSchema, entryValue, formatDate, imageUrl, marketValue, parseBackup } from '../src/lib/models'
import { card, entry } from './fixtures'

describe('Precios y variantes', () => {
  it('distingue la referencia normal de la holo', () => {
    expect(marketValue(card, 'normal')).toBe(2.5)
    expect(marketValue(card, 'holo')).toBe(5)
  })
  it('no inventa referencias reverse o primera edición', () => {
    expect(marketValue(card, 'reverse')).toBeNull()
    expect(marketValue(card, 'firstEdition')).toBeNull()
  })
  it('no tasa datos ausentes, referencias cero ni importes en otra moneda', () => {
    expect(marketValue({ ...card, pricing: undefined }, 'normal')).toBeNull()
    expect(marketValue({ ...card, pricing: { cardmarket: { unit: 'USD', trend: 10 } } }, 'normal')).toBeNull()
    expect(marketValue({ ...card, pricing: { cardmarket: { unit: 'EUR', trend: 0 } } }, 'normal')).toBeNull()
  })
  it('prioriza el valor manual, incluso cero', () => {
    expect(entryValue({ ...entry, manual_value: 0 })).toBe(0)
    expect(entryValue({ ...entry, manual_value: 10 })).toBe(10)
  })
  it('multiplica cantidades y cuenta ejemplares sin referencia separadamente', () => {
    expect(collectionStats([entry, { ...entry, variant: 'reverse', quantity: 3 }, { ...entry, manual_value: 4 }])).toEqual({ copies: 7, total: 13, unpriced: 3, manual: 2 })
  })
  it('no muestra fechas inválidas', () => {
    expect(formatDate('no-fecha')).toBe('Fecha no disponible')
  })
})

describe('Validación de colección y copias', () => {
  const serialize = (entries: unknown[]) => JSON.stringify({ version: 1, exportedAt: '2026-09-16', entries })
  it('divide colecciones grandes en copias importables sin perder cartas', () => {
    const entries = Array.from({ length: 3001 }, (_, index) => ({ ...entry, card_id: `card-${index}`, card_snapshot: { ...card, id: `card-${index}` } }))
    const parts = createBackupParts(entries)
    expect(parts).toHaveLength(2)
    expect(parts.flatMap((part) => parseBackup(part).entries)).toEqual(entries)
  })
  it('acepta una copia válida y elimina identificadores de propietario importados', () => {
    const backup = parseBackup(serialize([{ ...entry, user_id: 'otro-usuario', id: 'otro-registro' }]))
    expect(backup.entries).toEqual([entry])
    expect(backup.entries[0]).not.toHaveProperty('user_id')
  })
  it.each([0, -1, 1.5, 10000, NaN])('rechaza cantidad inválida %s', (quantity) => {
    expect(entryInputSchema.safeParse({ ...entry, quantity }).success).toBe(false)
  })
  it('rechaza identificadores no coincidentes y valores negativos', () => {
    expect(entryInputSchema.safeParse({ ...entry, card_id: 'otra' }).success).toBe(false)
    expect(entryInputSchema.safeParse({ ...entry, manual_value: -1 }).success).toBe(false)
  })
  it('rechaza versiones desconocidas, idiomas no soportados y duplicados', () => {
    expect(() => parseBackup('{"version":2}')).toThrow()
    expect(() => parseBackup(serialize([{ ...entry, language: 'xx' }]))).toThrow()
    expect(() => parseBackup(serialize([entry, entry]))).toThrow('duplicados')
  })
  it('rechaza archivos demasiado grandes', () => {
    expect(() => parseBackup(' '.repeat(5 * 1024 * 1024 + 1))).toThrow('5 MB')
  })
  it('construye enlaces Cardmarket sin interpolación peligrosa', () => {
    const url = new URL(cardmarketUrl({ ...card, name: 'Pikachu & Eevee' }))
    expect(url.hostname).toBe('www.cardmarket.com')
    expect(url.searchParams.get('searchString')).toBe('Pikachu & Eevee 58')
  })
  it('solo permite imágenes HTTPS del proveedor conocido', () => {
    expect(imageUrl(card.image)).toBe(`${card.image}/low.webp`)
    expect(imageUrl('https://tracker.example/image')).toBeUndefined()
    expect(imageUrl('javascript:alert(1)')).toBeUndefined()
  })
})