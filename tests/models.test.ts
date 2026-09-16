import { describe, expect, it } from 'vitest'
import { cardmarketUrl, collectionStats, createBackupParts, entryInputSchema, entryValue, formatDate, imageUrl, marketLow, marketValue, parseBackup } from '../src/lib/models'
import { card, entry } from './fixtures'

describe('Precios y variantes', () => {
  it('separa el mínimo general de la valoración y no inventa mínimos por idioma', () => {
    const priced = { ...card, pricing: { cardmarket: { unit: 'EUR', trend: 5, low: 1, 'low-holo': 2 } } }
    expect(marketLow(priced, 'normal')).toBe(1)
    expect(marketLow(priced, 'holo')).toBe(2)
    expect(marketLow(priced, 'reverse')).toBeNull()
    expect(marketLow(priced, 'firstEdition')).toBeNull()
    expect(entryValue({ ...entry, card_snapshot: priced })).toBe(5)
    expect(marketLow({ ...card, pricing: { cardmarket: { unit: 'EUR', low: 0 } } }, 'normal')).toBeNull()
    expect(marketLow({ ...card, pricing: { cardmarket: { unit: 'USD', low: 1 } } }, 'normal')).toBeNull()
    expect(marketLow(card, 'normal')).toBeNull()
  })
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
    expect(url.searchParams.get('language')).toBe('4')
  })
  it.each([['es', '4'], ['en', '1'], ['ja', '7']] as const)('aplica el idioma %s al producto sin arrastrar otros filtros', (language, code) => {
    const product = 'https://www.cardmarket.com/en/Pokemon/Products/Singles/151/Blastoise-ex-V3-MEW200?language=2&minCondition=1#offers'
    const url = new URL(cardmarketUrl(card, language, product))
    expect(url.pathname).toBe('/es/Pokemon/Products/Singles/151/Blastoise-ex-V3-MEW200')
    expect(url.search).toBe(`?language=${code}`)
    expect(url.hash).toBe('')
  })
  it.each([
    'javascript:alert(1)', 'http://www.cardmarket.com/es/Pokemon/Products/Singles/151/Card',
    'https://www.cardmarket.com.evil.example/es/Pokemon/Products/Singles/151/Card',
    'https://user:password@www.cardmarket.com/es/Pokemon/Products/Singles/151/Card',
    'https://www.cardmarket.com/es/Pokemon/Products/Search?searchString=Pikachu',
  ])('rechaza enlaces de producto no válidos: %s', (url) => {
    expect(entryInputSchema.safeParse({ ...entry, cardmarket_url: url }).success).toBe(false)
    expect(new URL(cardmarketUrl(card, 'es', url)).pathname).toBe('/es/Pokemon/Products/Search')
  })
  it('conserva enlaces válidos en las copias y acepta las antiguas sin enlace', () => {
    const linked = { ...entry, cardmarket_url: 'https://www.cardmarket.com/es/Pokemon/Products/Singles/151/Blastoise-ex-V3-MEW200?language=4' }
    expect(parseBackup(createBackupParts([linked])[0]).entries).toEqual([linked])
    expect(parseBackup(createBackupParts([entry])[0]).entries).toEqual([entry])
  })
  it('solo permite imágenes HTTPS del proveedor conocido', () => {
    expect(imageUrl(card.image)).toBe(`${card.image}/low.webp`)
    expect(imageUrl('https://tracker.example/image')).toBeUndefined()
    expect(imageUrl('javascript:alert(1)')).toBeUndefined()
  })
})