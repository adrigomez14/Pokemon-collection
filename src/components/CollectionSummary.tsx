import { ArrowRight, BookOpen, Globe2, ShieldCheck, Sparkles } from 'lucide-react'
import { CardImage } from './CardImage'
import { entryValue, euros, languages, variants, type collectionStats, type EntryInput } from '../lib/models'

type Stats = ReturnType<typeof collectionStats>

/** Archivo de entrenador con cobertura de valoración y carta destacada por valor unitario. */
export function CollectionSummary({ entries, stats, onExplore }: { entries: EntryInput[]; stats: Stats; onExplore: () => void }) {
  const sets = new Set(entries.map((entry) => entry.card_snapshot.set.id)).size
  const languageCount = new Set(entries.map((entry) => entry.language)).size
  const priced = stats.copies - stats.unpriced
  const top = entries.reduce<EntryInput | null>((best, entry) => {
    const value = entryValue(entry)
    if (value === null) return best
    const bestValue = best ? entryValue(best) : null
    return bestValue === null || value > bestValue ? entry : best
  }, null)
  const topValue = top ? entryValue(top) : null
  const featured = top ?? entries[0]
  const hasCards = stats.copies > 0

  return <section className="hero trainer-hero collection-hero" aria-label="Tu archivo de entrenador">
    <div className="hero-copy">
      <span className="eyebrow"><span className="live-dot" />TU ARCHIVO DE ENTRENADOR</span>
      {hasCards
        ? <h1>{stats.copies.toLocaleString('es-ES')} {stats.copies === 1 ? 'carta guardada' : 'cartas guardadas'}.<br /><span>Una historia en cada carta.</span></h1>
        : <h1>Tu colección<br /><span>empieza con una carta.</span></h1>}
      <p>{hasCards
        ? 'Cada hallazgo tiene su sitio. Revisa tus expansiones, descubre tu carta más valiosa y sigue dando forma a tu colección.'
        : 'De tu primera carta a esa expansión que quieres completar. Explora el catálogo y empieza tu propio archivo Pokémon TCG.'}</p>
      <div className="hero-actions">
        <button className="primary" onClick={onExplore}>Explorar catálogo <ArrowRight size={18} /></button>
        <span className="hero-note"><ShieldCheck size={16} aria-hidden="true" />Tu colección, en tu cuenta</span>
      </div>
      <dl className="collection-passport">
        <div><dt><BookOpen size={14} aria-hidden="true" />Expansiones</dt><dd>{sets.toLocaleString('es-ES')}</dd></div>
        <div><dt><Globe2 size={14} aria-hidden="true" />Idiomas</dt><dd>{languageCount}</dd></div>
        <div><dt><Sparkles size={14} aria-hidden="true" />Con valoración</dt><dd>{hasCards ? `${priced.toLocaleString('es-ES')} / ${stats.copies.toLocaleString('es-ES')}` : '—'}</dd></div>
      </dl>
      <div className="collection-coverage">
        <progress value={priced} max={stats.copies || 1} aria-label="Ejemplares con valoración" aria-valuetext={hasCards ? `${priced} de ${stats.copies} ejemplares con valoración` : 'Aún no hay cartas en la colección'} />
        <p>{!hasCards ? 'Tu progreso aparecerá al añadir la primera carta.'
          : stats.unpriced > 0 ? `${stats.unpriced.toLocaleString('es-ES')} ${stats.unpriced === 1 ? 'ejemplar pendiente' : 'ejemplares pendientes'} de valoración. Puedes añadir un valor manual.`
          : 'Todos tus ejemplares tienen valoración de referencia o manual.'}</p>
      </div>
    </div>
    <aside className="collection-display" aria-label="Carta destacada de tu colección">
      <div className="collection-device-top"><span className="collection-device-lights" aria-hidden="true"><i /><i /><i /></span><span>POKÉFOLIO / TCG</span></div>
      <div className="collection-feature">
        <p className="collection-feature-label"><Sparkles size={13} aria-hidden="true" />{top ? 'MAYOR VALOR POR CARTA' : featured ? 'CARTA DE TU ARCHIVO' : 'TU PRIMERA CARTA'}</p>
        <div className="collection-feature-body">
          <div className="collection-feature-media">
            {featured ? <CardImage card={featured.card_snapshot} /> : <div className="collection-card-slot" aria-hidden="true"><span className="pokeball" /><span>EL PRIMER HUECO<br />ES PARA TU FAVORITA</span></div>}
          </div>
          <div className="collection-feature-detail">
            <h2>{featured ? featured.card_snapshot.name : 'Una favorita por descubrir'}</h2>
            <p className="collection-feature-set">{featured ? `${featured.card_snapshot.set.name} · N.º ${featured.card_snapshot.localId}` : 'Búscala en el catálogo y añádela a tu colección.'}</p>
            {featured && <p className="collection-feature-tags"><span>{languages[featured.language]}</span><span>{variants[featured.variant]}</span></p>}
            <div className="collection-feature-value">
              <strong>{topValue !== null ? euros(topValue) : featured ? 'Sin valoración' : 'Tu aventura empieza aquí'}</strong>
              <span>{top ? `${top.manual_value !== null ? 'Valor manual' : 'Referencia de mercado'} · por ejemplar` : featured ? 'Añade un valor manual o actualiza los precios.' : 'Sin prisas. Carta a carta.'}</span>
            </div>
          </div>
        </div>
      </div>
      <p className="collection-device-note"><ShieldCheck size={13} aria-hidden="true" />{top ? 'Valor orientativo, no una oferta de compra.' : 'Tu archivo personal de coleccionista.'}</p>
    </aside>
  </section>
}
