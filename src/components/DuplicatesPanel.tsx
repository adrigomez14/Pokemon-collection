import { CardImage } from './CardImage'
import { duplicateGroups } from '../lib/progress'
import { conditions, languages, variants, type Entry } from '../lib/models'

export function DuplicatesPanel({ entries, busy, onEdit }: { entries: Entry[]; busy: boolean; onEdit: (entry: Entry) => void }) {
  const groups = duplicateGroups(entries)
  const extras = groups.reduce((sum, group) => sum + group.extras, 0)
  return <section className="duplicates-panel" aria-label="Gestión de repetidas">
    <div className="section-heading"><div><p className="eyebrow">ORGANIZA TUS EJEMPLARES</p><h3>Cartas repetidas</h3></div><strong>{extras} {extras === 1 ? 'ejemplar' : 'ejemplares'} extra</strong></div>
    <p>Se conserva una referencia por carta, idioma y variante. Una normal y una holo no se consideran repetidas entre sí. Los estados de conservación pueden ser diferentes.</p>
    {!groups.length ? <p>No tienes repetidas con estos filtros.</p> : <div className="duplicate-list">{groups.map((group) => {
      const first = group.entries[0]
      return <article className="duplicate-item" key={group.key}><CardImage card={first.card_snapshot} /><div><h4>{first.card_snapshot.name}</h4><p>{first.card_snapshot.set.name} · {languages[first.language]} · {variants[first.variant]}</p><strong>{group.copies} ejemplares · {group.extras} extra</strong><div className="duplicate-records">{group.entries.map((entry) => <button key={entry.id} disabled={busy} onClick={() => onEdit(entry)}>Editar {entry.quantity} × {conditions[entry.condition]}</button>)}</div></div></article>
    })}</div>}
    <small>Editar abre la ficha existente para cambiar cantidades o eliminar un registro con confirmación. No se elimina ni se pone a la venta ninguna carta automáticamente.</small>
  </section>
}
