import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import { getFilterValues, getSets, LATEST_SET, sortOptions, type FilterField, type Search } from '../lib/catalog'
import { languages, type Language } from '../lib/models'

export function CatalogSearch({ language, search, onSearch }: { language: Language; search: Search; onSearch: (search: Search) => void }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Search>(search)
  const [advanced, setAdvanced] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const sets = useQuery({
    queryKey: ['sets', language], queryFn: ({ signal }) => getSets(language, signal),
    staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    apply(draft)
  }
  function apply(next: Search) {
    setDraft(next)
    onSearch({ ...next, page: 1 })
  }
  function change<K extends keyof Search>(field: K, value: Search[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }))
  }
  function selectSet(value: string) {
    apply({ ...draft, name: '', set: value, number: '' })
  }
  async function refresh() {
    setRefreshing(true)
    try {
      await Promise.all([
        sets.refetch(),
        client.invalidateQueries({ queryKey: ['catalog', language] }),
        client.invalidateQueries({ queryKey: ['catalog-filters', language] }),
      ])
    } finally { setRefreshing(false) }
  }

  return <>
    <form className="search-panel advanced-search" onSubmit={submit}>
      <div className="search-fields">
        <CatalogFilter language={language} field="categories" label="Categoría de carta" value={draft.category ?? ''} onChange={(value) => change('category', value)} />
        <label>Expansión<select aria-label="Expansión" value={draft.set} disabled={sets.isPending && !sets.data} onChange={(e) => selectSet(e.target.value)}>
          <option value="">Todas las expansiones</option>
          <option value={LATEST_SET}>Novedades · expansión más reciente</option>
          {draft.set && draft.set !== LATEST_SET && !sets.data?.some((item) => item.id === draft.set) && <option value={draft.set}>{draft.set}</option>}
          {sets.data?.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id} · {item.cardCount.total} cartas</option>)}
        </select></label>
        <label className="name-filter">Nombre<input aria-label="Nombre de carta" name="name" placeholder="Nombre de la carta (opcional)" value={draft.name} onChange={(e) => change('name', e.target.value)} maxLength={100} /></label>
        <button className="primary search-submit" type="submit"><SearchIcon size={16} />Buscar cartas</button>
      </div>
      <div className="search-checks"><label className="check-label"><input type="checkbox" checked={draft.exactName ?? false} onChange={(e) => change('exactName', e.target.checked)} />Nombre exacto</label><label className="check-label"><input type="checkbox" checked={draft.imageOnly ?? false} onChange={(e) => change('imageOnly', e.target.checked)} />Sólo con imagen</label></div>
      {draft.exactName && <p className="search-hint">El nombre exacto distingue mayúsculas y minúsculas según TCGdex.</p>}
      {draft.set === LATEST_SET && <p className="search-hint">Novedades: cartas de la expansión más reciente por fecha de lanzamiento en TCGdex para este idioma. Elige «Todas las expansiones» para buscar en todo el catálogo.</p>}
      <details className="advanced-filters" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
        <summary><SlidersHorizontal size={15} />Más opciones de filtro{(draft.rarity || draft.type || draft.number) && <span className="filter-dot" aria-label="Hay filtros avanzados seleccionados" />}</summary>
        {advanced && <div className="filter-options">
          <CatalogFilter language={language} field="rarities" label="Rareza" value={draft.rarity ?? ''} onChange={(value) => change('rarity', value)} />
          <CatalogFilter language={language} field="types" label="Tipo / elemento" value={draft.type ?? ''} onChange={(value) => change('type', value)} />
          <label>Número de carta<input name="number" placeholder="Ej. 025, 200" value={draft.number} onChange={(e) => change('number', e.target.value)} maxLength={50} pattern="[a-zA-Z0-9\-]+" title="Número o código exacto, conservando ceros iniciales; sin barras ni comodines." /></label>
          <label>ID de expansión (opcional)<input aria-label="Identificador de expansión" name="set" placeholder="Ej. sv03.5, base1" value={draft.set === LATEST_SET ? '' : draft.set} onChange={(e) => change('set', e.target.value)} maxLength={100} /></label>
          <p className="search-hint">Los filtros se combinan. Usa el número impreso antes de la barra, conservando los ceros iniciales (025 no es 25). «Sólo con imagen» indica una imagen catalogada, no existencias a la venta.</p>
        </div>}
      </details>
      <div className="search-bottom"><label>Ordenar por<select aria-label="Ordenar por" value={draft.sort ?? 'catalog'} onChange={(e) => apply({ ...draft, sort: e.target.value as Search['sort'] })}>{Object.entries(sortOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" className="text-button" onClick={() => apply({ name: '', set: '', number: '', page: 1 })}>Limpiar filtros</button></div>
    </form>
    <div className="catalog-sync">
      <div><strong>{sets.data ? `${sets.data.length} expansiones disponibles · ${languages[language]}` : sets.isPending ? 'Consultando expansiones…' : 'Índice de expansiones no disponible'}</strong>
        <p>Las novedades aparecen cuando TCGdex las publica en este idioma, sin redesplegar la web. La cobertura puede ser incompleta.</p>
        {sets.dataUpdatedAt > 0 && <small>Última consulta: {new Date(sets.dataUpdatedAt).toLocaleString('es-ES')} · comprobación automática cada 15 minutos con el catálogo abierto.</small>}
        {sets.isError && <p role="alert">No se pudo actualizar la lista de expansiones. Puedes seguir buscando por nombre o ID y reintentar.</p>}
      </div>
      <button type="button" disabled={refreshing || sets.isFetching} onClick={() => void refresh()}><RefreshCw size={16} className={refreshing || sets.isFetching ? 'spin' : ''} />Actualizar catálogo</button>
    </div>
  </>
}

function CatalogFilter({ language, field, label, value, onChange }: { language: Language; field: FilterField; label: string; value: string; onChange: (value: string) => void }) {
  const values = useQuery({ queryKey: ['catalog-filters', language, field], queryFn: ({ signal }) => getFilterValues(language, field, signal), staleTime: 60 * 60 * 1000 })
  return <label>{label}<select aria-label={label} value={value} disabled={values.isPending && !values.data} onChange={(e) => onChange(e.target.value)}>
    <option value="">Todas las opciones</option>
    {value && !values.data?.includes(value) && <option value={value}>{value}</option>}
    {values.data?.map((item) => <option key={item} value={item}>{item}</option>)}
  </select>{values.isError && <small>No se pudieron cargar las opciones. Usa «Actualizar catálogo» para reintentar.</small>}</label>
}