import { describe, expect, it } from 'vitest'
import { readSheet } from 'read-excel-file/node'
import { createCollectionExcel } from '../src/lib/excel'
import { entry, holoOnlyCard } from './fixtures'
import type { EntryInput } from '../src/lib/models'

async function workbook(entries: EntryInput[]) {
  const blob = await createCollectionExcel(entries, new Date('2026-09-16T12:00:00Z'))
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  return Buffer.from(await blob.arrayBuffer())
}

describe('Exportación Excel real', () => {
  it('incluye nombre, colección y precios numéricos por unidad y cantidad', async () => {
    const buffer = await workbook([{ ...entry, quantity: 3, manual_value: 12.5 }])
    const rows = await readSheet(buffer, 'Mi colección')
    expect(rows[0].slice(0, 3)).toEqual(['Nombre de la carta', 'Colección', 'Precio unitario (€)'])
    expect(rows[1].slice(0, 5)).toEqual(['Pikachu', entry.card_snapshot.set.name, 12.5, 3, 37.5])
    expect(rows[1][10]).toBe('Manual')
    const info = await readSheet(buffer, 'Información')
    expect(info.find((row) => row[0] === 'Total valorado')?.[1]).toBe(37.5)
    expect(info.find((row) => row[0] === 'Exportado (UTC)')?.[1]).toBe('2026-09-16T12:00:00.000Z')
  })
  it('distingue precio ausente y cero manual y conserva todas las variantes', async () => {
    const buffer = await workbook([{ ...entry, variant: 'reverse' }, { ...entry, manual_value: 0 }])
    const rows = await readSheet(buffer, 'Mi colección')
    expect(rows).toHaveLength(3)
    expect(rows[1][2]).toBeNull()
    expect(rows[1][4]).toBeNull()
    expect(rows[1][10]).toBe('Sin precio')
    expect(rows[2][2]).toBe(0)
    expect(rows[2][4]).toBe(0)
    const info = await readSheet(buffer, 'Información')
    expect(info.find((row) => row[0] === 'Ejemplares sin precio')?.[1]).toBe(entry.quantity)
  })
  it('reutiliza la referencia holo corregida sin convertirla en un mínimo de oferta', async () => {
    const rows = await readSheet(await workbook([{ ...entry, card_id: holoOnlyCard.id, card_snapshot: holoOnlyCard, variant: 'holo' }]), 'Mi colección')
    expect(rows[1][2]).toBe(134.4)
    expect(rows[1][2]).not.toBe(75)
    expect(rows[1][10]).toBe('Referencia TCGdex / Cardmarket')
  })
  it('preserva ceros, acentos y japonés y nunca interpreta nombres como fórmulas', async () => {
    for (const name of ['ピカチュウ', '=HYPERLINK("https://example.com")', '+1+1', '-1+1', '@SUM(A1:A2)']) {
      const rows = await readSheet(await workbook([{ ...entry, card_snapshot: { ...entry.card_snapshot, name, localId: '025', set: { id: 's', name: 'Colección especial & amigos' } } }]), 'Mi colección')
      expect(rows[1][0]).toBe(name)
      expect(rows[1][1]).toBe('Colección especial & amigos')
      expect(rows[1][8]).toBe('025')
    }
  })
  it('rechaza una colección vacía', async () => {
    await expect(createCollectionExcel([])).rejects.toThrow('vacía')
  })
})