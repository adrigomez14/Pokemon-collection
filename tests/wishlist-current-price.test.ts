import { describe, expect, it } from 'vitest'
import { availableVariants, euros, marketQuote, type Card, type Variant } from '../src/lib/models'
import { card, holoOnlyCard } from './fixtures'

describe('Variantes compartidas por Actual y la ficha', () => {
  const order: Variant[] = ['normal', 'holo', 'reverse', 'firstEdition']

  it('conserva el orden de la ficha, no el orden de las propiedades del proveedor', () => {
    const detail: Card = { ...card, variants: { firstEdition: true, reverse: true, holo: true, normal: true } }
    expect(availableVariants(detail)).toEqual(order)
    expect(availableVariants({ ...detail, variants: { reverse: true, holo: true } })).toEqual(['holo', 'reverse'])
  })

  it.each([
    { label: 'flags ausentes', flags: undefined },
    { label: 'flags null', flags: null },
    { label: 'flags vacíos', flags: {} },
    { label: 'todos false', flags: { normal: false, holo: false, reverse: false, firstEdition: false } },
  ])('mantiene el fallback histórico de CardModal con $label', ({ flags }) => {
    const detail: Card = { ...card, variants: flags }
    expect(availableVariants(detail)).toEqual(order)
    expect(availableVariants(detail)[0]).toBe('normal')
  })

  it('incluye la variante guardada sin reordenar ni mutar flags, solo al editar una entrada', () => {
    const detail = structuredClone(holoOnlyCard)
    const before = structuredClone(detail)
    expect(availableVariants(detail)).toEqual(['holo'])
    expect(availableVariants(detail, 'reverse')).toEqual(['holo', 'reverse'])
    expect(availableVariants(detail, 'normal')).toEqual(['normal', 'holo'])
    expect(availableVariants(detail, 'holo')).toEqual(['holo'])
    expect(availableVariants({ ...detail, variants: { normal: false, holo: false } }, 'firstEdition')).toEqual(['firstEdition'])
    expect(detail).toEqual(before)
  })
})

describe('Referencia inicial de Deseos: availableVariants → marketQuote → euros', () => {
  // Expectativas independientes: no calcular el valor esperado con la misma función probada.
  // Los E2E comparan además el componente real con el selector y el importe de CardModal.
  const cases: { label: string; detail: Card; variant: Variant; value: number | null; text: string }[] = [
    { label: 'normal antes que holo', detail: card, variant: 'normal', value: 2.5, text: '2,50\u00a0€' },
    { label: 'holo exclusiva del fixture, no mínimo 75', detail: holoOnlyCard, variant: 'holo', value: 134.4, text: '134,40\u00a0€' },
    { label: 'holo explícita sin normal', detail: { ...card, variants: { holo: true } }, variant: 'holo', value: 5, text: '5,00\u00a0€' },
    { label: 'reverse only', detail: { ...card, variants: { reverse: true } }, variant: 'reverse', value: null, text: 'Sin precio' },
    { label: 'primera edición only', detail: { ...card, variants: { firstEdition: true } }, variant: 'firstEdition', value: null, text: 'Sin precio' },
    { label: 'USD no es EUR', detail: { ...card, pricing: { cardmarket: { unit: 'USD', trend: 2.5 } } }, variant: 'normal', value: null, text: 'Sin precio' },
    { label: 'cero no significa gratis ni permite usar low', detail: { ...card, pricing: { cardmarket: { unit: 'EUR', trend: 0, low: 75 } } }, variant: 'normal', value: null, text: 'Sin precio' },
    { label: 'trend null no usa low ni promedios', detail: { ...card, pricing: { cardmarket: { unit: 'EUR', trend: null, low: 75, avg: 80, avg7: 81, avg30: 82 } } }, variant: 'normal', value: null, text: 'Sin precio' },
    { label: 'sin pricing', detail: { ...card, pricing: null }, variant: 'normal', value: null, text: 'Sin precio' },
  ]

  it.each(cases)('$label: usa exactamente la primera variante disponible', ({ detail, variant, value, text }) => {
    const initial = availableVariants(detail)[0]
    expect(initial).toBe(variant)
    const quote = marketQuote(detail, initial)
    expect(quote.value).toBe(value)
    expect(euros(quote.value)).toBe(text)
    if (detail === holoOnlyCard) {
      expect(quote.low).toBe(75)
      expect(quote.value).not.toBe(quote.low)
    }
  })
})
