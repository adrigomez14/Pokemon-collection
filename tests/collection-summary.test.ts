import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CollectionSummary } from '../src/components/CollectionSummary'
import { collectionStats, type EntryInput } from '../src/lib/models'
import { entry } from './fixtures'

const render = (entries: EntryInput[]) => renderToStaticMarkup(createElement(CollectionSummary, { entries, stats: collectionStats(entries), onExplore: () => {} }))
const featuredText = (html: string) => html.split('<aside')[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

describe('archivo de entrenador de la colección', () => {
  it('presenta el estado vacío sin inventar una favorita, precio ni progreso', () => {
    const html = render([])
    expect(html).toContain('hero trainer-hero collection-hero')
    expect(html).toContain('Tu archivo de entrenador')
    expect(html).toContain('Una favorita por descubrir')
    expect(html).toContain('Aún no hay cartas en la colección')
    expect(html).not.toContain('0,00')
    expect(html).not.toContain('MAYOR VALOR POR CARTA')
    expect(html).toMatch(/<progress[^>]*value="0"[^>]*max="1"/)
  })

  it('destaca el valor unitario, no el valor acumulado de varias copias', () => {
    const cheap = { ...entry, quantity: 50, manual_value: 2 }
    const expensive = { ...entry, card_id: 'test-1', quantity: 1, manual_value: 12.5, card_snapshot: { ...entry.card_snapshot, id: 'test-1', name: 'Carta destacada' } }
    const text = featuredText(render([cheap, expensive]))
    expect(text).toContain('Carta destacada')
    expect(text).toContain('12,50')
    expect(text).toContain('Valor manual · por ejemplar')
    expect(text).not.toContain('Pikachu')
  })

  it('respeta el valor manual cero y lo distingue de un dato ausente', () => {
    const html = render([{ ...entry, quantity: 1, manual_value: 0 }])
    expect(html).toContain('1 carta guardada')
    expect(html).toContain('0,00')
    expect(html).toContain('MAYOR VALOR POR CARTA')
    expect(html).toContain('Valor manual')
    expect(html).toContain('1 / 1')
  })

  it('muestra una carta real sin atribuirle un precio cuando ninguna tiene valoración', () => {
    const html = render([{ ...entry, variant: 'reverse' }])
    const text = featuredText(html)
    expect(text).toContain('CARTA DE TU ARCHIVO')
    expect(text).toContain('Pikachu')
    expect(text).toContain('Sin valoración')
    expect(text).not.toContain('MAYOR VALOR POR CARTA')
    expect(html).toContain('2 ejemplares pendientes de valoración')
    expect(html).toContain('0 / 2')
  })

  it('calcula cobertura por ejemplares y cuenta expansiones e idiomas distintos', () => {
    const html = render([entry, { ...entry, quantity: 3, language: 'es', variant: 'reverse' }])
    expect(html).toContain('2 / 5')
    expect(html).toMatch(/Expansiones<\/dt><dd>1<\/dd>/)
    expect(html).toMatch(/Idiomas<\/dt><dd>2<\/dd>/)
    expect(html).toMatch(/<progress[^>]*value="2"[^>]*max="5"/)
    expect(html).toContain('Referencia de mercado')
  })

  it('mantiene la variante y el idioma de la carta seleccionada', () => {
    const html = render([{ ...entry, language: 'ja', variant: 'holo' }])
    expect(featuredText(html)).toContain('Japonés')
    expect(featuredText(html)).toContain('Holo')
    expect(featuredText(html)).toContain('5,00')
  })

  it('utiliza el marcador de imagen cuando falta o el origen no está permitido', () => {
    for (const image of [null, 'https://untrusted.example/tracker']) {
      const html = render([{ ...entry, card_snapshot: { ...entry.card_snapshot, image } }])
      expect(html).toContain('Imagen no disponible')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('untrusted.example')
    }
  })

  it('escapa los nombres de las cartas y no modifica los registros recibidos', () => {
    const entries = [{ ...entry, card_snapshot: { ...entry.card_snapshot, name: '<script>alert(1)</script>' } }]
    const before = JSON.stringify(entries)
    expect(render(entries)).not.toContain('<script>')
    expect(render(entries)).toContain('&lt;script&gt;')
    expect(JSON.stringify(entries)).toBe(before)
  })
})