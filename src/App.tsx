import { useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { ArrowDownToLine, ArrowUpFromLine, BookOpen, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, Layers3, LogOut, Plus, RefreshCw, Search as SearchIcon, ShieldCheck, Sparkles, TrendingUp, UserRound } from 'lucide-react'
import { AuthModal } from './components/AuthModal'
import { CardImage } from './components/CardImage'
import { CardModal, type Selection } from './components/CardModal'
import { CatalogSearch } from './components/CatalogSearch'
import { Modal } from './components/Modal'
import { getCard, PAGE_SIZE, searchCards, type Search } from './lib/catalog'
import { addEntry, importEntries, loadCollection, removeEntry, updateEntry, updateSnapshot } from './lib/collection'
import { cardmarketUrl, collectionStats, createBackupParts, entryValue, euros, formatDate, languages, parseBackup, variants, type Entry, type EntryInput, type Language } from './lib/models'
import { supabase } from './lib/supabase'

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60000, refetchOnWindowFocus: true } } })
export default function App() { return <QueryClientProvider client={client}><CollectionApp /></QueryClientProvider> }

function CollectionApp() {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authOpen, setAuthOpen] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [view, setView] = useState<'catalog' | 'collection'>('catalog')
  const [language, setLanguage] = useState<Language>('es')
  const [search, setSearch] = useState<Search>({ name: 'Pikachu', set: '', number: '', page: 1 })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [collectionSearch, setCollectionSearch] = useState('')
  const [collectionLanguage, setCollectionLanguage] = useState('all')
  const [sort, setSort] = useState('recent')
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [backup, setBackup] = useState<EntryInput[] | null>(null)
  const [exportParts, setExportParts] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const activeUser = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    let received = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      received = true
      const nextId = session?.user.id ?? null
      if (activeUser.current !== nextId) {
        void queryClient.cancelQueries({ queryKey: ['collection'] })
        queryClient.removeQueries({ queryKey: ['collection'] })
        setSelection(null); setBackup(null); setExportParts(null); setNotice(null)
      }
      activeUser.current = nextId
      setUser(session?.user ?? null); setAuthLoading(false)
      if (event === 'PASSWORD_RECOVERY') { setRecovery(true); setAuthOpen(true) }
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || received) return
      if (error) setNotice({ text: 'No se ha podido recuperar la sesión. Vuelve a iniciar sesión.', error: true })
      activeUser.current = data.session?.user.id ?? null
      setUser(data.session?.user ?? null); setAuthLoading(false)
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [queryClient])

  const catalog = useQuery({ queryKey: ['catalog', language, search], queryFn: ({ signal }) => searchCards(language, search, signal), enabled: view === 'catalog', refetchInterval: view === 'catalog' ? 5 * 60 * 1000 : false })
  const collection = useQuery({ queryKey: ['collection', user?.id], queryFn: ({ signal }) => loadCollection(user!.id, signal), enabled: Boolean(user), staleTime: 15000 })
  const entries = user ? collection.data ?? [] : []
  const stats = collectionStats(entries)
  const visibleEntries = entries.filter((entry) => (collectionLanguage === 'all' || entry.language === collectionLanguage) && `${entry.card_snapshot.name} ${entry.card_snapshot.set.name} ${entry.card_id} ${entry.notes}`.toLocaleLowerCase().includes(collectionSearch.toLocaleLowerCase())).sort((a, b) => sort === 'value' ? (entryValue(b) ?? -1) - (entryValue(a) ?? -1) : sort === 'name' ? a.card_snapshot.name.localeCompare(b.card_snapshot.name) : b.updated_at.localeCompare(a.updated_at))
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['collection', user?.id] })

  async function save(input: EntryInput, id?: string) {
    if (!user) throw new Error('Inicia sesión para guardar tu colección.')
    if (id) await updateEntry(id, input)
    else await addEntry(input)
    await invalidate()
    setNotice({ text: id ? 'Cambios guardados en tu cuenta.' : 'Carta añadida a tu colección.' })
  }
  async function deleteEntry(id: string) {
    await removeEntry(id); await invalidate(); setNotice({ text: 'Registro eliminado de tu colección.' })
  }
  async function signOut() {
    setBusy(true)
    const { error } = await supabase!.auth.signOut({ scope: 'local' })
    setBusy(false)
    if (error) setNotice({ text: 'No se ha podido cerrar sesión. Inténtalo de nuevo.', error: true })
  }
  function exportCollection() {
    try {
      const parts = createBackupParts(entries)
      if (parts.length === 1) downloadBackup(parts[0])
      else setExportParts(parts)
    } catch { setNotice({ text: 'No se pudo generar la copia. Revisa los datos de tu colección.', error: true }) }
  }
  function downloadBackup(content: string, part?: number) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `pokemon-collection-${new Date().toISOString().slice(0, 10)}${part ? `-parte-${part}` : ''}.json`
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function selectBackup(file?: File) {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('La copia supera el límite de 5 MB.')
      setBackup(parseBackup(await file.text()).entries)
    } catch (cause) { setNotice({ text: cause instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : cause instanceof Error ? cause.message : 'No se puede leer el archivo.', error: true }) }
    if (fileInput.current) fileInput.current.value = ''
  }
  async function confirmImport() {
    if (!backup || !user) return
    setBusy(true)
    try { await importEntries(backup); await invalidate(); setBackup(null); setNotice({ text: 'Copia importada. La colección está guardada en tu cuenta.' }) }
    catch (cause) { setNotice({ text: cause instanceof Error ? cause.message : 'No se ha podido importar.', error: true }); setBackup(null) }
    finally { setBusy(false) }
  }
  async function refreshPrices() {
    if (!user) return
    const owner = user.id
    setBusy(true); setNotice(null)
    let failed = 0
    const groups = new Map<string, Entry[]>()
    for (const entry of entries) {
      const key = `${entry.language}:${entry.card_id}`
      groups.set(key, [...groups.get(key) ?? [], entry])
    }
    const batches = [...groups.values()]
    try {
      for (let offset = 0; offset < batches.length; offset += 3) {
        if (activeUser.current !== owner) break
        await Promise.all(batches.slice(offset, offset + 3).map(async (group) => {
          try {
            const card = await getCard(group[0].language, group[0].card_id)
            if (activeUser.current !== owner) return
            for (const entry of group) await updateSnapshot(entry.id, owner, card)
            queryClient.setQueryData(['card', group[0].language, group[0].card_id], card)
          } catch { failed += group.length }
        }))
      }
      if (activeUser.current === owner) {
        await invalidate()
        setNotice({ text: failed ? `No se pudieron actualizar ${failed} registros; conservan sus datos anteriores. El resto se ha actualizado.` : 'Referencias actualizadas con los últimos datos disponibles de TCGdex. Algunas cartas pueden no tener precio.', error: failed > 0 })
      }
    } finally { setBusy(false) }
  }

  const openAuth = () => { setSelection(null); setAuthOpen(true) }
  const closeAuth = () => { setAuthOpen(false); setRecovery(false) }

  return <>
    <a className="skip-link" href="#main">Ir al contenido</a>
    <header className="header"><div className="header-inner"><a href="#main" className="brand" aria-label="Pokéfolio, inicio"><span className="brand-mark"><Layers3 size={22} /></span>pokéfolio<span className="brand-dot">.</span></a><nav aria-label="Navegación principal"><button className={view === 'catalog' ? 'nav-item active' : 'nav-item'} aria-current={view === 'catalog' ? 'page' : undefined} onClick={() => setView('catalog')}><SearchIcon size={17} />Explorar</button><button className={view === 'collection' ? 'nav-item active' : 'nav-item'} aria-current={view === 'collection' ? 'page' : undefined} onClick={() => setView('collection')}><BookOpen size={17} />Mi colección{user && <span className="count-badge">{stats.copies}</span>}</button></nav><div className="account">{user ? <><span className="account-email" title={user.email}>{user.email}</span><button className="icon-button" aria-label="Cerrar sesión" disabled={busy} onClick={() => void signOut()}><LogOut size={18} /></button></> : <button className="account-button" disabled={authLoading} onClick={openAuth}><UserRound size={17} /><span>{authLoading ? 'Conectando…' : 'Mi cuenta'}</span></button>}</div></div></header>
    <main id="main" className="main">
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="live-dot" />TU UNIVERSO POKÉMON TCG</span><h1>Cada carta cuenta.<br /><span>Cada colección, una historia.</span></h1><p>Encuentra tu próxima joya, organiza las que ya tienes y descubre el valor de tu colección. Todo en un mismo lugar.</p><div className="hero-actions"><button className="primary" onClick={() => { setView('collection'); if (!user) openAuth() }}><Plus size={18} />Mi colección</button><span className="hero-note"><ShieldCheck size={16} />Tu colección, siempre contigo</span></div></div><div className="hero-art" aria-hidden="true"><div className="orb orb-one" /><div className="orb orb-two" /><div className="collector-card rear"><span>ポケモン</span><Sparkles size={56} /><small>TRADING CARD COLLECTION</small></div><div className="collector-card front"><div className="collector-card-top">COLLECTOR’S EDITION <Sparkles size={16} /></div><div className="card-emblem"><Layers3 size={65} strokeWidth={1.2} /></div><strong>Gotta keep ’em all.</strong><div className="collector-card-bottom"><span>EST. 2026</span><span>001 / ∞</span></div></div><div className="floating-tag"><Sparkles size={15} />Pequeñas cartas. Grandes historias.</div></div></section>
      <section className="stats" aria-label="Resumen de tu colección"><div className="stat"><span className="stat-icon violet"><Layers3 size={21} /></span><div><span>Cartas en tu colección</span><strong>{user && !collection.isPending && !collection.isError ? stats.copies.toLocaleString('es-ES') : '—'} <small>ejemplares</small></strong></div></div><div className="stat"><span className="stat-icon green"><TrendingUp size={21} /></span><div><span>Valoración orientativa</span><strong>{user && !collection.isPending && !collection.isError ? euros(stats.total) : '—'}</strong><small>Referencias + valores manuales</small></div></div><div className="stat"><span className="stat-icon amber"><CircleHelp size={21} /></span><div><span>Sin valoración</span><strong>{user && !collection.isPending && !collection.isError ? stats.unpriced : '—'} <small>ejemplares</small></strong><small>{stats.manual} con valor manual</small></div></div></section>
      {notice && <div className={`notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button className="text-button" onClick={() => setNotice(null)} aria-label="Ocultar aviso">Cerrar</button></div>}
      {!supabase && <div className="setup-banner"><ShieldCheck size={20} /><p><strong>Explora sin registrarte.</strong> Conecta Supabase para activar las cuentas y guardar tu colección en la nube.</p><button className="text-button" onClick={openAuth}>Cómo activarlo <ChevronRight size={15} /></button></div>}
      <section className="catalog-section">
        <div className="section-heading"><div><p className="eyebrow">{view === 'catalog' ? 'EL PRÓXIMO DESCUBRIMIENTO' : 'TU ARCHIVO PERSONAL'}</p><h2>{view === 'catalog' ? 'Explora el catálogo' : 'Mi colección'}</h2></div>{view === 'catalog' ? <label className="language-label">Idioma de las cartas<select value={language} onChange={(e) => { setLanguage(e.target.value as Language); setSearch((s) => ({ ...s, name: e.target.value === 'ja' ? 'ピカチュウ' : 'Pikachu', set: '', number: '', page: 1 })) }}>{Object.entries(languages).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label> : user && <div className="actions"><button disabled={busy || !entries.length || collection.isPending || collection.isError} onClick={() => void refreshPrices()}><RefreshCw size={16} className={busy ? 'spin' : ''} />Actualizar precios</button><button disabled={busy || !entries.length || collection.isPending || collection.isError} onClick={exportCollection}><ArrowDownToLine size={16} />Exportar</button><button disabled={busy || collection.isPending || collection.isError} onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={16} />Importar</button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void selectBackup(e.target.files?.[0])} /></div>}</div>
        {view === 'catalog' ? <>
          <CatalogSearch key={language} language={language} search={search} onSearch={setSearch} />
          <div className="catalog-meta"><span>{catalog.isFetching ? 'Buscando cartas…' : `Página ${search.page} · ${catalog.data?.length ?? 0} cartas`}</span><span><span className="live-dot" />Datos reales de TCGdex</span></div>
          {catalog.isPending ? <div className="cards-grid" aria-label="Cargando catálogo" role="status">{Array.from({ length: 8 }, (_, i) => <div className="skeleton" key={i} />)}</div> : catalog.isError ? <div className="empty-state"><CircleHelp /><h3>No se pudo cargar el catálogo</h3><p>Comprueba tu conexión o inténtalo de nuevo en unos minutos.</p><button onClick={() => void catalog.refetch()}>Reintentar</button></div> : !catalog.data?.length ? <div className="empty-state"><SearchIcon /><h3>No encontramos esas cartas</h3><p>Prueba otro nombre, revisa el idioma o elimina los filtros de expansión y número.</p></div> : <div className="cards-grid">{catalog.data.map((card) => { const owned = entries.filter((e) => e.card_id === card.id && e.language === language).reduce((n, e) => n + e.quantity, 0); return <button className="card-tile" key={card.id} onClick={() => setSelection({ card, language })}><div className="card-art">{owned > 0 && <span className="owned-badge">En tu colección · {owned}</span>}<CardImage card={card} /></div><div className="card-info"><span className="card-code">{card.id} · {language.toUpperCase()}</span><h3>{card.name}</h3><div className="card-tile-footer"><span>Ver carta y precio</span><span className="add-circle"><Plus size={17} /></span></div></div></button> })}</div>}
          <div className="pagination"><button disabled={search.page === 1 || catalog.isFetching} onClick={() => setSearch((s) => ({ ...s, page: s.page - 1 }))}><ChevronLeft size={17} />Anterior</button><span>Página {search.page}</span><button disabled={catalog.isFetching || catalog.isError || (catalog.data?.length ?? 0) < PAGE_SIZE} onClick={() => setSearch((s) => ({ ...s, page: s.page + 1 }))}>Siguiente<ChevronRight size={17} /></button></div>
        </> : !user ? <div className="empty-state collection-empty"><BookOpen size={40} /><h3>Tu colección empieza con una carta</h3><p>Inicia sesión para añadir cartas, guardar sus detalles y consultarlas desde cualquier dispositivo.</p><button className="primary" disabled={authLoading} onClick={openAuth}>Acceder a mi colección</button></div> : collection.isPending ? <div className="empty-state" role="status">Cargando tu colección…</div> : collection.isError ? <div className="empty-state" role="alert"><h3>No se pudo cargar tu colección</h3><p>{collection.error.message}</p><button onClick={() => void collection.refetch()}>Reintentar</button></div> : <>
          <div className="collection-filters"><label>Buscar en mi colección<input value={collectionSearch} onChange={(e) => setCollectionSearch(e.target.value)} placeholder="Nombre, expansión o notas…" /></label><label>Idioma<select value={collectionLanguage} onChange={(e) => setCollectionLanguage(e.target.value)}><option value="all">Todos los idiomas</option>{Object.entries(languages).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label><label>Ordenar<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">Última modificación</option><option value="name">Nombre</option><option value="value">Mayor valor por carta</option></select></label></div>
          <p className="catalog-meta">{visibleEntries.length} registros · {entries.length} en total</p>
          {!visibleEntries.length ? <div className="empty-state"><Layers3 size={35} /><h3>{entries.length ? 'Sin coincidencias' : 'El primer hueco es para tu favorita'}</h3><p>{entries.length ? 'Cambia los filtros para ver más cartas.' : 'Explora el catálogo y añade tu primera carta.'}</p><button className="primary" onClick={() => setView('catalog')}>Explorar cartas</button></div> : <div className="cards-grid">{visibleEntries.map((entry) => <article className="card-tile" key={entry.id}>
            <button className="card-open" disabled={busy} onClick={() => setSelection({ card: entry.card_snapshot, language: entry.language, entry })}><div className="card-art"><span className="owned-badge">{entry.quantity} × · {entry.condition}</span><CardImage card={entry.card_snapshot} /></div><div className="card-info"><span className="card-code">{entry.card_snapshot.set.name} · {entry.language.toUpperCase()}</span><h3>{entry.card_snapshot.name}</h3><span className="variant-label">{variants[entry.variant]} · N.º {entry.card_snapshot.localId}</span></div></button>
            <div className="card-price"><div className="card-tile-footer"><a className="price-link" href={cardmarketUrl(entry.card_snapshot, entry.language, entry.cardmarket_url)} target="_blank" rel="noopener noreferrer" aria-label={`${euros(entryValue(entry))} · ${entry.cardmarket_url ? 'Ver producto' : 'Buscar carta'} en Cardmarket · ${languages[entry.language]}`}><strong>{euros(entryValue(entry))}</strong><ExternalLink size={13} /></a><small>{entry.manual_value === null ? 'referencia / ud.' : 'manual / ud.'}</small></div><small className="price-date">{entry.manual_value === null ? `Datos: ${formatDate(entry.card_snapshot.pricing?.cardmarket?.updated)}` : 'Valoración personal'}</small><small className="price-date">{entry.cardmarket_url ? 'Producto enlazado' : 'Enlace de búsqueda'} · {languages[entry.language]}</small></div>
          </article>)}</div>}
          <p className="valuation-note"><CircleHelp size={16} />La valoración excluye ejemplares sin precio. No incluye gastos de envío ni ajusta por idioma o conservación. Las referencias se guardan con la carta; usa «Actualizar precios» para renovarlas.</p>
        </>}
      </section>
      <footer><a className="brand footer-brand" href="#main">pokéfolio<span className="brand-dot">.</span></a><p>Hecho para coleccionar, no para dejar de hacerlo.<br /><small>Proyecto independiente, no afiliado a Pokémon, Nintendo, TCGdex ni Cardmarket. Imágenes y datos pertenecen a sus titulares.</small></p><a href="https://tcgdex.dev" target="_blank" rel="noopener noreferrer">Datos de TCGdex <ExternalLink size={13} /></a></footer>
    </main>
    {authOpen && <AuthModal onClose={closeAuth} recovery={recovery} />}
    {exportParts && <Modal title="Exportar colección por partes" onClose={() => setExportParts(null)}><div className="stack"><p>Tu colección se divide en {exportParts.length} copias para que todas puedan importarse. Descarga y conserva cada parte.</p>{exportParts.map((part, index) => <button key={index} onClick={() => downloadBackup(part, index + 1)}><ArrowDownToLine size={16} />Descargar parte {index + 1}</button>)}</div></Modal>}
    {selection && <CardModal key={`${selection.language}:${selection.card.id}:${selection.entry?.id ?? ''}`} selection={selection} signedIn={Boolean(user)} onClose={() => setSelection(null)} onAuth={openAuth} onSave={save} onDelete={deleteEntry} />}
    {backup && <Modal title="Importar copia de tu colección" onClose={() => setBackup(null)} busy={busy}><div className="stack"><p>Se importarán <strong>{backup.length} registros</strong> en tu cuenta.</p><p>Si ya existe la misma carta, idioma, variante y conservación, se reemplazarán su cantidad, notas y valor manual por los de la copia. No se borrarán las demás cartas.</p><p className="muted">Exporta primero tu colección si quieres conservar una copia del estado actual.</p><button className="primary" disabled={busy || !backup.length} onClick={() => void confirmImport()}>{busy ? 'Importando…' : 'Confirmar importación'}</button></div></Modal>}
  </>
}