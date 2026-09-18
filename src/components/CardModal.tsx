import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react'
import { getCard } from '../lib/catalog'
import { availableVariants, cardmarketUrl, conditions, entryInputSchema, euros, formatDate, isCardmarketProductUrl, languages, marketQuote, variants, type Card, type CardBrief, type Condition, type Entry, type EntryInput, type Language, type Variant } from '../lib/models'
import { CardImage } from './CardImage'
import { Modal } from './Modal'

export type Selection = { card: CardBrief; language: Language; entry?: Entry }
export function CardModal({ selection, signedIn, onClose, onAuth, onSave, onDelete }: {
  selection: Selection; signedIn: boolean; onClose: () => void; onAuth: () => void;
  onSave: (input: EntryInput, id?: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false)
  const detail = useQuery({ queryKey: ['card', selection.language, selection.card.id], queryFn: ({ signal }) => getCard(selection.language, selection.card.id, signal), initialData: selection.entry?.card_snapshot, initialDataUpdatedAt: 0, staleTime: 5 * 60 * 1000 })
  return <Modal title={selection.entry ? 'Editar mi carta' : 'Una carta, una historia'} onClose={onClose} busy={busy} wide>
    {detail.isPending && <div className="empty-state" role="status">Cargando carta y precios…</div>}
    {detail.isError && <div className="notice error" role="alert">No se ha podido actualizar la ficha. {detail.data ? 'Se muestra la última copia guardada.' : 'Comprueba tu conexión.'} <button className="text-button" onClick={() => void detail.refetch()}>Reintentar</button></div>}
    {detail.data && <CardForm card={detail.data} selection={selection} signedIn={signedIn} onAuth={onAuth} busy={busy} setBusy={setBusy} onSave={onSave} onDelete={onDelete} onClose={onClose} />}
  </Modal>
}

function CardForm({ card, selection, signedIn, onAuth, busy, setBusy, onSave, onDelete, onClose }: {
  card: Card; selection: Selection; signedIn: boolean; onAuth: () => void; busy: boolean; setBusy: (busy: boolean) => void;
  onSave: (input: EntryInput, id?: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const entry = selection.entry
  const options = availableVariants(card, entry?.variant)
  const [variant, setVariant] = useState<Variant>(entry?.variant ?? options[0])
  const [condition, setCondition] = useState<Condition>(entry?.condition ?? 'NM')
  const [quantity, setQuantity] = useState(String(entry?.quantity ?? 1))
  const [manual, setManual] = useState(entry?.manual_value?.toString() ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [productUrl, setProductUrl] = useState(entry?.cardmarket_url ?? '')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const quote = marketQuote(card, variant)
  const { value, low } = quote
  const hasProductUrl = isCardmarketProductUrl(productUrl.trim())
  const link = cardmarketUrl(card, selection.language, productUrl.trim())

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (productUrl.trim() && !hasProductUrl) { setError('El enlace debe ser la URL HTTPS de una carta en www.cardmarket.com, dentro de Pokémon → Cartas sueltas.'); return }
    const input = entryInputSchema.safeParse({ card_id: card.id, language: selection.language, variant, condition, quantity: Number(quantity), manual_value: manual === '' ? null : Number(manual), notes, card_snapshot: card, cardmarket_url: hasProductUrl ? link : null })
    if (!input.success) { setError('Revisa los datos: cantidad entera entre 1 y 9999 y valoración no negativa.'); return }
    setBusy(true)
    try { await onSave(input.data, entry?.id); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se ha podido guardar.') }
    finally { setBusy(false) }
  }
  async function deleteEntry() {
    if (!entry) return
    setBusy(true); setError('')
    try { await onDelete(entry.id); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se ha podido eliminar.') }
    finally { setBusy(false) }
  }
  return <div className="card-detail">
    <div className="detail-art"><CardImage card={card} large /><span className="pill">{languages[selection.language]} · {card.id}</span></div>
    <div className="detail-content"><p className="eyebrow">{card.set.name}</p><h3>{card.name}</h3><p className="muted">N.º {card.localId}{card.rarity ? ` · ${card.rarity}` : ''}</p>
      <div className="market-box"><div><span>Referencia Cardmarket · {variants[variant]}</span><a className="price-link" href={link} target="_blank" rel="noopener noreferrer" title={`${hasProductUrl ? 'Ver producto' : 'Buscar carta'} en Cardmarket · ${languages[selection.language]}`}><strong>{euros(value)}</strong><ExternalLink size={14} /></a></div><small>Datos de TCGdex · {formatDate(quote.updated)}</small>
        {quote.generalProduct && <small>Datos del producto asociado a la única variante holo identificada por el proveedor.</small>}
        {value === null && <p className="price-unavailable">{variant === 'reverse' || variant === 'firstEdition' ? 'No hay una referencia inequívoca para esta variante. Puedes indicar un valor manual.' : 'No hay una referencia positiva en euros que podamos asignar con seguridad a esta variante. No significa que la carta valga cero.'}</p>}
        {low !== null && <div className="market-low"><span>Mínimo general del proveedor</span><a href={link} target="_blank" rel="noopener noreferrer">{euros(low)} <ExternalLink size={12} /></a></div>}
        <p>Estos importes no están filtrados por idioma ni conservación. El mínimo general no es la oferta más barata en {languages[selection.language]}. No incluye envío ni sustituye la valoración.</p>
        <a href={link} target="_blank" rel="noopener noreferrer">{hasProductUrl ? 'Ver producto en Cardmarket' : 'Buscar en Cardmarket'} <ExternalLink size={14} /></a><small>Idioma solicitado: {languages[selection.language]}. {hasProductUrl ? 'Comprueba la variante, el estado y que el filtro siga aplicado.' : 'Selecciona el producto correcto y comprueba el filtro de idioma en su página.'}</small>
      </div>
      <form onSubmit={submit} className="stack">
        <div className="form-row"><label>Variante<select value={variant} disabled={busy} onChange={(e) => setVariant(e.target.value as Variant)}>{options.map((key) => <option value={key} key={key}>{variants[key]}</option>)}</select></label><label>Conservación<select value={condition} disabled={busy} onChange={(e) => setCondition(e.target.value as Condition)}>{Object.entries(conditions).map(([key, text]) => <option value={key} key={key}>{key} · {text}</option>)}</select></label></div>
        <div className="form-row"><label>{entry ? 'Cantidad total' : 'Ejemplares que añadir'}<input type="number" min="1" max="9999" step="1" required value={quantity} disabled={busy} onChange={(e) => setQuantity(e.target.value)} /></label><label>Valor manual / carta (€)<input type="number" min="0" max="9999999" step="0.01" placeholder="Opcional" value={manual} disabled={busy} onChange={(e) => setManual(e.target.value)} /></label></div>
        <small className="muted">El valor manual sustituye la referencia de mercado para calcular el total.</small>
        <label>Enlace del producto en Cardmarket (opcional)<input type="url" maxLength={1000} placeholder="https://www.cardmarket.com/es/Pokemon/Products/Singles/…" value={productUrl} disabled={busy} onChange={(e) => setProductUrl(e.target.value)} /></label>
        <small className="muted">Pega la dirección de la carta exacta para abrirla al pulsar el precio. Se guarda con tu registro; el idioma se aplica automáticamente. Puedes anotar como valor manual el precio que compruebes allí.</small>
        {!entry && <small className="muted">Si ya existe esta carta con el mismo idioma, variante y estado, se sumará la cantidad. Sus notas y valor manual se conservan; puedes cambiarlos desde «Mi colección».</small>}
        <label>Notas<textarea rows={2} maxLength={2000} placeholder="Carpeta, procedencia, detalles del estado…" value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} /></label>
        {error && <p role="alert" className="notice error">{error}</p>}
        {signedIn ? <button className="primary" disabled={busy}>{entry ? <Save size={17} /> : <Plus size={17} />}{busy ? 'Guardando…' : entry ? 'Guardar cambios' : 'Añadir a mi colección'}</button> : <button type="button" className="primary" onClick={onAuth}>Inicia sesión para guardar</button>}
        {entry && (!confirmDelete ? <button type="button" className="text-button danger" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />Eliminar de mi colección</button> : <div className="notice error"><p>¿Eliminar los {entry.quantity} ejemplares de este registro?</p><div className="actions"><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button><button type="button" className="danger-button" disabled={busy} onClick={() => void deleteEntry()}>Sí, eliminar</button></div></div>)}
      </form>
    </div>
  </div>
}
