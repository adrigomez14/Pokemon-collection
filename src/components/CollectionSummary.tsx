import { ArrowRight, Gem, Layers3, TrendingUp } from 'lucide-react'
import { entryValue, euros, type collectionStats, type EntryInput } from '../lib/models'

type Stats = ReturnType<typeof collectionStats>

/** Sustituye a la Pokédex del catálogo en la vista de colección: mismos bloques visuales, datos reales del usuario. */
export function CollectionSummary({ entries, stats, onExplore }: { entries: EntryInput[]; stats: Stats; onExplore: () => void }) {
  const sets = new Set(entries.map((entry) => entry.card_snapshot.set.id)).size
  const top = entries.reduce<EntryInput | null>((best, entry) => {
    const value = entryValue(entry)
    if (value === null) return best
    const bestValue = best ? entryValue(best) : null
    return bestValue === null || value > bestValue ? entry : best
  }, null)
  const topValue = top ? entryValue(top) : null

  return <section className="hero" aria-label="Resumen de tu colección">
    <div className="hero-copy">
      <span className="eyebrow"><span className="live-dot" />TU ARCHIVO PERSONAL</span>
      {stats.copies > 0
        ? <h1>{stats.copies.toLocaleString('es-ES')} cartas guardadas<br /><span>en {sets} {sets === 1 ? 'expansión' : 'expansiones'} distinta{sets === 1 ? '' : 's'}.</span></h1>
        : <h1>Tu colección<br /><span>empieza con una carta.</span></h1>}
      <p>{stats.copies > 0
        ? `Valoración orientativa de ${euros(stats.total)}. ${stats.unpriced > 0 ? `${stats.unpriced} ejemplares sin precio de referencia.` : 'Todos tus ejemplares tienen una referencia de precio.'}`
        : 'Añade tu primera carta desde el catálogo y aquí verás tus estadísticas: total de cartas, expansiones y tu ejemplar más valioso.'}</p>
      <div className="hero-actions">
        <button className="primary" onClick={onExplore}>Explorar catálogo <ArrowRight size={18} /></button>
        <span className="hero-note"><TrendingUp size={16} />{top ? `Tu carta más valiosa: ${top.card_snapshot.name}` : 'Sigue completando tu colección'}</span>
      </div>
    </div>
    <div className="hero-art" aria-hidden="true">
      <span className="orb orb-two" /><span className="orb orb-one" />
      <div className="collector-card rear"><span>{sets}</span><small>{sets === 1 ? 'EXPANSIÓN' : 'EXPANSIONES'}</small></div>
      <div className="collector-card front">
        <div className="collector-card-top"><span>{top ? top.language.toUpperCase() : 'TCG'}</span><span>{top ? `N.º ${top.card_snapshot.localId}` : '—'}</span></div>
        <span className="card-emblem"><Gem size={30} /></span>
        <strong>{top ? top.card_snapshot.name : 'Sin favorita aún'}</strong>
        <div className="collector-card-bottom"><span>{topValue !== null ? euros(topValue) : '—'}</span><span>TOP</span></div>
      </div>
      <span className="floating-tag"><Layers3 size={14} />{stats.copies.toLocaleString('es-ES')} ejemplares</span>
    </div>
  </section>
}
