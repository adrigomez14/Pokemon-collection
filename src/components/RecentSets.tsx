import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronLeft, ChevronRight, Layers3 } from 'lucide-react'
import { getRecentSets, LATEST_SET, setLogoUrl, type RecentSet } from '../lib/catalog'
import { languages, type Language } from '../lib/models'
import '../recent-sets.css'

/** Accesos directos a expansiones físicas. Una consulta al índice, ninguna por carta. */
export function RecentSets({ language, selectedSet, onSelect }: {
  language: Language; selectedSet: string; onSelect: (setId: string) => void
}) {
  const headingId = useId()
  const trackId = useId()
  const track = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const query = useQuery({
    queryKey: ['recent-sets', language], queryFn: ({ signal }) => getRecentSets(language, signal),
    staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000,
    placeholderData: undefined,
  })
  const sets = query.data
  useEffect(() => {
    const element = track.current
    if (!element) return
    const update = () => setEdges({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    element.addEventListener('scroll', update, { passive: true })
    update()
    return () => { observer.disconnect(); element.removeEventListener('scroll', update) }
  }, [sets])

  function scroll(direction: number) {
    const element = track.current
    if (!element) return
    element.scrollBy({
      left: direction * element.clientWidth * .85,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }
  const currentId = selectedSet === LATEST_SET ? sets?.[0]?.id : selectedSet
  return <section className="recent-sets" aria-labelledby={headingId}>
    <div className="recent-sets-heading">
      <div><h3 id={headingId}>Últimas expansiones</h3><span>{languages[language]} · Cartas físicas</span></div>
      <button type="button" className="recent-sets-all" onClick={() => onSelect('')}>Todas las expansiones <ArrowRight size={15} aria-hidden="true" /></button>
    </div>
    {query.isPending ? <div className="recent-sets-loading" role="status">Cargando últimas expansiones…</div> : <>
      {query.isError && <div className="recent-sets-error" role="status"><span>No se pudieron actualizar las últimas expansiones.{sets?.length ? ' Se conserva la última consulta.' : ' Puedes seguir usando el buscador.'}</span><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Reintentar expansiones</button></div>}
      {sets && sets.length > 0 ? <>
        <div className="recent-sets-strip">
          <button type="button" className="recent-sets-arrow" aria-label="Ver expansiones anteriores en la fila" aria-controls={trackId} disabled={edges.start} onClick={() => scroll(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <ul className="recent-sets-track" ref={track} id={trackId} aria-label="Expansiones recientes">
            {sets.map((set) => <li key={`${language}:${set.id}`}>
              <button type="button" className="recent-set" aria-label={`Ver expansión ${set.name}`} aria-pressed={currentId === set.id} onClick={() => onSelect(set.id)}>
                <SetLogo key={`${language}:${set.id}:${set.logo ?? ''}`} set={set} />
                <span className="recent-set-info"><strong title={set.name}>{set.name}</strong><span><span>{set.cardCount.total.toLocaleString('es-ES')} cartas</span><span className="recent-set-code">{set.id}</span></span></span>
              </button>
            </li>)}
          </ul>
          <button type="button" className="recent-sets-arrow" aria-label="Ver más expansiones en la fila" aria-controls={trackId} disabled={edges.end} onClick={() => scroll(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
        <p className="recent-sets-note">Por fecha de lanzamiento en TCGdex. No ofrece precio del set completo.</p>
      </> : !query.isError && <p className="recent-sets-note">No hay expansiones físicas disponibles en este idioma.</p>}
    </>}
  </section>
}

function SetLogo({ set }: { set: RecentSet }) {
  const [failed, setFailed] = useState(false)
  const url = setLogoUrl(set.logo)
  return <span className="recent-set-logo">
    {url && !failed ? <img src={url} alt={`Logo de ${set.name}`} loading="lazy" decoding="async" width="180" height="72" onError={() => setFailed(true)} /> :
      <span className="recent-set-fallback"><Layers3 size={25} aria-hidden="true" /><strong>{set.id}</strong><small>Logo no disponible</small></span>}
  </span>
}
