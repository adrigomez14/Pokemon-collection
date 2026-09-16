import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search as SearchIcon } from 'lucide-react'
import { getSets, type Search } from '../lib/catalog'
import { languages, type Language } from '../lib/models'

export function CatalogSearch({ language, search, onSearch }: { language: Language; search: Search; onSearch: (search: Search) => void }) {
  const client = useQueryClient()
  const [name, setName] = useState(search.name)
  const [set, setSet] = useState(search.set)
  const [number, setNumber] = useState(search.number)
  const [refreshing, setRefreshing] = useState(false)
  const sets = useQuery({
    queryKey: ['sets', language], queryFn: ({ signal }) => getSets(language, signal),
    staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearch({ name, set, number, page: 1 })
  }
  function selectSet(value: string) {
    setSet(value); setName(''); setNumber('')
    onSearch({ name: '', set: value, number: '', page: 1 })
  }
  async function refresh() {
    setRefreshing(true)
    try {
      await Promise.all([
        sets.refetch(),
        client.invalidateQueries({ queryKey: ['catalog', language] }),
      ])
    } finally { setRefreshing(false) }
  }

  return <>
    <form className="search-panel" onSubmit={submit}>
      <div className="search-main"><SearchIcon size={20} /><input aria-label="Nombre de carta" name="name" placeholder={language === 'ja' ? 'Busca en japonés: ピカチュウ…' : 'Busca por nombre: Pikachu, Charizard…'} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /><button className="primary" type="submit">Buscar cartas</button></div>
      <div className="expansion-filters">
        <label>Expansión<select aria-label="Expansión" value={set} disabled={sets.isPending && !sets.data} onChange={(e) => selectSet(e.target.value)}>
          <option value="">Todas las expansiones</option>
          {set && !sets.data?.some((item) => item.id === set) && <option value={set}>{set}</option>}
          {sets.data?.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id} · {item.cardCount.total} cartas</option>)}
        </select></label>
        <label>Número de carta<input name="number" placeholder="Ej. 025" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={50} /></label>
        <label>ID de expansión (opcional)<input aria-label="Identificador de expansión" name="set" placeholder="Ej. sv03.5, base1" value={set} onChange={(e) => setSet(e.target.value)} maxLength={100} /></label>
      </div>
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