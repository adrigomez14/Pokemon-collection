import { useQuery } from '@tanstack/react-query'
import { getSetCatalog, type Search } from '../lib/catalog'
import { expansionProgress } from '../lib/progress'
import { languages, type Entry, type Language } from '../lib/models'

export function SetProgress({ language, search, entries, signedIn, ready, failed = false, onFilter, onAuth }: {
  language: Language; search: Search; entries: Entry[]; signedIn: boolean; ready: boolean; failed?: boolean;
  onFilter: (filter: NonNullable<Search['ownership']>) => void; onAuth: () => void;
}) {
  const index = useQuery({ queryKey: ['set-catalog', language, search.set], queryFn: ({ signal }) => getSetCatalog(language, search.set, signal), staleTime: 5 * 60 * 1000 })
  if (index.isPending) return <section className="set-progress" aria-label="Progreso de la expansión" aria-busy="true"><p role="status">Cargando el índice de la expansión…</p></section>
  if (index.isError) return <section className="set-progress" aria-label="Progreso de la expansión"><p>No se pudo calcular el progreso. El catálogo sigue disponible.</p><button onClick={() => void index.refetch()}>Reintentar progreso</button></section>
  if (!index.data) return null
  const set = index.data
  const stats = expansionProgress(set.cards, entries, language)
  const known = signedIn && ready
  return <section className="set-progress" aria-label="Progreso de la expansión">
    <div className="set-progress-heading"><div><p className="eyebrow">TU ÁLBUM · {languages[language]}</p><h3>{set.name}</h3></div><strong>{known ? `${stats.percent}%` : '—'}</strong></div>
    <progress aria-label="Cartas distintas de la expansión" value={known ? stats.collected : 0} max={stats.total || 1} aria-valuetext={known ? `${stats.collected} de ${stats.total} cartas distintas` : 'Inicia sesión para consultar el progreso'} />
    <p>{known ? <><strong>{stats.collected} / {stats.total}</strong> cartas distintas · <strong>{stats.missing}</strong> por conseguir</> : signedIn ? failed ? 'Tu colección no está disponible. Reintenta su carga para consultar el progreso.' : 'Esperando a que se cargue tu colección…' : 'Inicia sesión para descubrir cuáles tienes y cuáles te faltan.'}</p>
    <div className="ownership-filters" role="group" aria-label="Cartas de mi álbum">{(['all', 'missing', 'owned'] as const).map((value) => <button key={value} aria-pressed={(search.ownership ?? 'all') === value} disabled={value !== 'all' && !known} onClick={() => onFilter(value)}>{value === 'all' ? 'Todas' : value === 'missing' ? 'Me faltan' : 'Ya tengo'}</button>)}{!signedIn && <button className="text-button" onClick={onAuth}>Acceder a mi colección</button>}</div>
    <small>Cuenta una vez cada carta en {languages[language]}, incluidas las secretas catalogadas. Los ejemplares, variantes y filtros de búsqueda no aumentan el progreso. No es un máster set de variantes.</small>
    {stats.total !== set.cardCount.total && <p className="search-hint">TCGdex anuncia {set.cardCount.total} cartas, pero su índice contiene {stats.total} identificadores distintos. El progreso usa únicamente las cartas disponibles.</p>}
  </section>
}
