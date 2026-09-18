import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import { catalogSort, getFilterValues, getSets, LATEST_SET, sortOptions, type FilterField, type Search } from '../lib/catalog'
import type { Language } from '../lib/models'
import { RecentSets } from './RecentSets'

export function CatalogSearch({ language, search, onSearch }: { language: Language; search: Search; onSearch: (search: Search) => void }) {
  const [draft, setDraft] = useState<Search>(search)
  const [advanced, setAdvanced] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)
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
    apply({ ...draft, name: '', set: value, number: '', ownership: 'all', sort: !value && draft.sort === 'rarity-desc' ? undefined : draft.sort })
  }
  return <>
    <form className={`search-panel advanced-search${mobileExpanded ? ' mobile-expanded' : ''}`} onSubmit={submit}>
      <div className="search-fields">
        <CatalogFilter language={language} field="categories" label="Categoría de carta" value={draft.category ?? ''} onChange={(value) => change('category', value)} />
        <label>Expansión<select aria-label="Expansión" value={draft.set} disabled={sets.isPending && !sets.data} onChange={(e) => selectSet(e.target.value)}>
          <option value="">Todas las expansiones físicas</option>
          <option value={LATEST_SET}>Novedades · expansión más reciente</option>
          {draft.set && draft.set !== LATEST_SET && !sets.data?.some((item) => item.id === draft.set) && <option value={draft.set}>{draft.set}</option>}
          {sets.data?.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id} · {item.cardCount.total} cartas</option>)}
        </select></label>
        <label className="name-filter">Nombre<input aria-label="Nombre de carta" name="name" placeholder="Nombre de la carta (opcional)" value={draft.name} onChange={(e) => change('name', e.target.value)} maxLength={100} /></label>
        <label className="mobile-extra">Número<input aria-label="Número de carta" name="number" placeholder="Ej. 025, 200" value={draft.number} onChange={(e) => change('number', e.target.value)} maxLength={50} pattern="[a-zA-Z0-9\-]+" title="Número o código exacto, conservando ceros iniciales; sin barras ni comodines." /></label>
        <button className="primary search-submit" type="submit"><SearchIcon size={16} />Buscar cartas</button>
      </div>
      <div className="search-quick-actions"><button className="mobile-filter-toggle" type="button" aria-expanded={mobileExpanded} onClick={() => setMobileExpanded(!mobileExpanded)}><SlidersHorizontal size={16} />{mobileExpanded ? 'Ocultar filtros' : 'Más filtros'}{(draft.category || draft.number || draft.rarity || draft.type || draft.exactName || draft.imageOnly) && <span className="filter-dot" aria-label="Hay filtros seleccionados" />}</button></div>
      <div className="search-checks mobile-extra"><label className="check-label"><input type="checkbox" checked={draft.exactName ?? false} onChange={(e) => change('exactName', e.target.checked)} />Nombre exacto</label><label className="check-label"><input type="checkbox" checked={draft.imageOnly ?? false} onChange={(e) => change('imageOnly', e.target.checked)} />Sólo con imagen</label></div>
      {draft.exactName && <p className="search-hint">El nombre exacto distingue mayúsculas y minúsculas según TCGdex.</p>}
      {draft.set === LATEST_SET && <p className="search-hint">Novedades: expansión física más reciente por fecha de lanzamiento en TCGdex para este idioma. Pokémon TCG Pocket queda excluido.</p>}
      <details className="advanced-filters mobile-extra" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
        <summary><SlidersHorizontal size={15} />Más opciones de filtro{(draft.rarity || draft.type) && <span className="filter-dot" aria-label="Hay filtros avanzados seleccionados" />}</summary>
        {advanced && <div className="filter-options">
          <CatalogFilter language={language} field="rarities" label="Rareza" value={draft.rarity ?? ''} onChange={(value) => change('rarity', value)} />
          <CatalogFilter language={language} field="types" label="Tipo / elemento" value={draft.type ?? ''} onChange={(value) => change('type', value)} />
          <p className="search-hint">Los filtros se combinan. «Sólo con imagen» indica una imagen catalogada, no existencias a la venta.</p>
        </div>}
      </details>
      <div className="search-bottom"><label>Ordenar por<select aria-label="Ordenar por" value={catalogSort(draft)} onChange={(e) => apply({ ...draft, sort: e.target.value as Search['sort'] })}>{Object.entries(sortOptions).map(([key, label]) => <option key={key} value={key} disabled={key === 'rarity-desc' && !draft.set}>{label}</option>)}</select></label><button type="button" className="text-button" onClick={() => apply({ name: '', set: '', number: '', page: 1 })}>Limpiar filtros</button></div>
      {catalogSort(draft) === 'rarity-desc' && <p className="search-hint">Rarezas especiales primero y comunes al final. Dentro de cada nivel, número descendente. Las categorías sin equivalencia se agrupan aparte; este orden no indica el precio.</p>}
      {sets.isError && <p className="search-hint" role="alert">No se pudo actualizar la lista de expansiones. Se volverá a intentar automáticamente.</p>}
    </form>
    <RecentSets language={language} selectedSet={search.set} onSelect={(set) => apply({ name: '', set, number: '', page: 1, ownership: 'all', sort: set ? 'rarity-desc' : 'catalog' })} />
  </>
}

function CatalogFilter({ language, field, label, value, onChange }: { language: Language; field: FilterField; label: string; value: string; onChange: (value: string) => void }) {
  const values = useQuery({ queryKey: ['catalog-filters', language, field], queryFn: ({ signal }) => getFilterValues(language, field, signal), staleTime: 60 * 60 * 1000 })
  return <label className={field === 'categories' ? 'mobile-extra' : undefined}>{label}<select aria-label={label} value={value} disabled={values.isPending && !values.data} onChange={(e) => onChange(e.target.value)}>
    <option value="">Todas las opciones</option>
    {value && !values.data?.includes(value) && <option value={value}>{value}</option>}
    {values.data?.map((item) => <option key={item} value={item}>{item}</option>)}
  </select>{values.isError && <small>No se pudieron cargar las opciones. Se volverá a intentar automáticamente.</small>}</label>
}
