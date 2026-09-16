import writeExcelFile, { type Cell, type CellObject, type SheetData } from 'write-excel-file/universal'
import { collectionStats, conditions, entryValue, formatDate, languages, marketQuote, variants, type EntryInput } from './models'

const moneyFormat = '#,##0.00 "€"'
// Texto explícito: los nombres que empiezan por =, +, - o @ nunca son fórmulas.
const text = (value: string): CellObject => ({ type: String, value })
const money = (value: number | null): CellObject | null => value === null ? null : { type: Number, value, format: moneyFormat }

/** Exporta todos los registros, sin filtros de pantalla ni datos de autenticación. */
export async function createCollectionExcel(entries: EntryInput[], exportedAt = new Date()): Promise<Blob> {
  if (!entries.length) throw new Error('Tu colección está vacía.')
  if (entries.length > 1048575) throw new Error('La colección supera el límite de filas de una hoja Excel.')
  const headers = ['Nombre de la carta', 'Colección', 'Precio unitario (€)', 'Cantidad', 'Total valorado (€)', 'Idioma', 'Variante', 'Conservación', 'Número', 'ID de carta', 'Origen del precio', 'Fecha del precio']
  const data: SheetData = [headers.map((value) => ({ type: String, value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#17324D', height: 32, wrap: true }))]
  for (const entry of entries) {
    const value = entryValue(entry)
    const row: (CellObject | null)[] = [
      text(entry.card_snapshot.name), text(entry.card_snapshot.set.name), money(value),
      { type: Number, value: entry.quantity }, money(value === null ? null : Math.round(value * 100) * entry.quantity / 100),
      text(languages[entry.language]), text(variants[entry.variant]), text(conditions[entry.condition]),
      text(entry.card_snapshot.localId), text(entry.card_id),
      text(entry.manual_value !== null ? 'Manual' : value === null ? 'Sin precio' : 'Referencia TCGdex / Cardmarket'),
      text(entry.manual_value !== null ? 'Valoración personal' : formatDate(marketQuote(entry.card_snapshot, entry.variant).updated)),
    ]
    data.push(row.map((cell): Cell => cell === null ? null : { ...cell, backgroundColor: data.length % 2 ? '#EFF6FA' : '#FFFFFF', height: 26, wrap: true }))
  }
  const stats = collectionStats(entries)
  const information: SheetData = [
    [text('Pokéfolio · Exportación de colección')],
    [text('Exportado (UTC)'), text(exportedAt.toISOString())],
    [text('Registros'), entries.length],
    [text('Ejemplares'), stats.copies],
    [text('Total valorado'), money(stats.total)],
    [text('Ejemplares sin precio'), stats.unpriced],
    [text('Alcance'), text('Toda la colección, incluidos los registros ocultos por los filtros de pantalla.')],
    [text('Precio'), text('Importe por carta: valor manual si existe; si no, referencia de mercado disponible.')],
    [text('Sin precio'), text('Las celdas de precio y total quedan vacías. No se consideran cartas de valor cero.')],
    [text('Limitaciones'), text('Referencias orientativas, no ofertas mínimas por idioma. Sin portes ni ajustes por conservación.')],
    [text('Restauración'), text('Este Excel es un informe. Para restaurar la colección utiliza Exportar JSON e Importar.')],
  ]
  return writeExcelFile([
    { sheet: 'Mi colección', data, stickyRowsCount: 1, columns: [30, 30, 20, 12, 21, 15, 20, 20, 12, 20, 34, 26].map((width) => ({ width })), orientation: 'landscape' },
    { sheet: 'Información', data: information, columns: [{ width: 30 }, { width: 105 }] },
  ], { fontFamily: 'Calibri', fontSize: 11 }).toBlob()
}