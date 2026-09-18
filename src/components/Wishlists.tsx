import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Heart, LockKeyhole, Plus, Trash2, ArrowRight, ShieldCheck, Sparkles, BookOpen } from 'lucide-react'
import { cardmarketUrl, languages, type CardBrief, type Language } from '../lib/models'
import {
  addWishlistItem, createWishlist, deleteWishlist, isCardWished, loadWishlists, removeWishlistItem, updateWishlistItemTargetPrice,
  loadPriceAlertEmailPreference, loadWishlistPriceAlerts, renameWishlist, updatePriceAlertEmailPreference,
  wishlistCardKey, wishlistErrorMessage, wishlistNameSchema,
  type Wishlist, type WishlistData, type WishlistItem, type WishlistPriceAlert,
} from '../lib/wishlists'
import { CardImage } from './CardImage'
import { Modal } from './Modal'

type Write = (userId: string, signal: AbortSignal) => Promise<unknown>
type Snapshot = {
  userId: string | null
  data: WishlistData | undefined
  error: string | null
  fetching: boolean
  pending: boolean
  canWrite: boolean
  run: (write: Write) => Promise<boolean>
  retry: () => Promise<boolean>
}

function createScope(userId: string | null) {
  let snapshot: Snapshot = {
    userId, data: undefined, error: null, fetching: Boolean(userId), pending: false, canWrite: false,
    run: async () => false, retry: async () => false,
  }
  const listeners = new Set<() => void>()
  return {
    userId,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (next: Snapshot) => {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}

type Scope = ReturnType<typeof createScope>
const WishlistContext = createContext<Scope | null>(null)

function useWishlists() {
  const scope = useContext(WishlistContext)
  if (!scope) throw new Error('WishlistProvider debe envolver las listas de deseos.')
  return useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot)
}

export function WishlistProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const scope = useMemo(() => createScope(userId), [userId])
  return <WishlistContext.Provider value={scope}>
    <WishlistScope key={userId ?? 'anonymous'} scope={scope} />
    {children}
  </WishlistContext.Provider>
}

function WishlistScope({ scope }: { scope: Scope }) {
  const { userId } = scope
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['wishlists', userId] as const, [userId])
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadWishlists(userId!, signal),
    enabled: userId !== null,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: undefined,
    initialData: undefined,
  })
  const [pending, setPending] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const blockedError = useRef(false)
  const inFlight = useRef(false)
  const lifetime = useRef<{ alive: boolean; controller?: AbortController }>({ alive: false })

  useLayoutEffect(() => {
    const current = { alive: true, controller: undefined as AbortController | undefined }
    lifetime.current = current
    return () => {
      current.alive = false
      current.controller?.abort()
      void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => {})
    }
  }, [queryClient, queryKey])

  const refetch = query.refetch
  const perform = useCallback(async (write?: Write): Promise<boolean> => {
    const current = lifetime.current
    const state = queryClient.getQueryState<WishlistData>(queryKey)
    if (!userId || !current.alive || inFlight.current || state?.fetchStatus !== 'idle') return false
    if (write && (blockedError.current || state.status !== 'success' || state.error || !state.data)) return false

    inFlight.current = true
    const controller = new AbortController()
    current.controller = controller
    setPending(true)
    try {
      if (write) await write(userId, controller.signal)
      if (!current.alive || controller.signal.aborted) return false
      const confirmed = await refetch({ cancelRefetch: true, throwOnError: true })
      if (!current.alive || controller.signal.aborted) return false
      if (!confirmed.isSuccess || confirmed.error || !confirmed.data || confirmed.fetchStatus !== 'idle') {
        throw new Error('No se ha confirmado la lectura.')
      }
      blockedError.current = false
      setWriteError(null)
      return true
    } catch (error) {
      if (current.alive && !controller.signal.aborted) {
        blockedError.current = true
        setWriteError(wishlistErrorMessage(error))
      }
      return false
    } finally {
      if (current.alive && lifetime.current === current) {
        current.controller = undefined
        inFlight.current = false
        setPending(false)
      }
    }
  }, [queryClient, queryKey, refetch, userId])
  const run = useCallback((write: Write) => perform(write), [perform])
  const retry = useCallback(() => perform(), [perform])
  const fetching = query.fetchStatus !== 'idle'
  const error = writeError ?? (query.error ? wishlistErrorMessage(query.error) : null)

  useLayoutEffect(() => {
    const data = pending ? scope.getSnapshot().data : query.data
    scope.publish({
      userId, data, error, fetching, pending, run, retry,
      canWrite: Boolean(userId && data && !error && !fetching && !pending),
    })
  }, [scope, userId, query.data, error, fetching, pending, run, retry])

  return null
}

function WishlistStatus() {
  const { data, error, fetching, pending, retry } = useWishlists()
  return <>
    {error && <div className="wishlist-error" role="alert">
      <p>{error}</p>
      <p>{data ? 'Se muestra la última lectura confirmada. Recarga antes de hacer más cambios.' : 'Todavía no se pueden mostrar tus listas.'}</p>
      <button type="button" className="wishlist-button" disabled={fetching || pending} onClick={() => { void retry() }}>Reintentar carga</button>
    </div>}
    {(fetching || pending || (!data && !error)) && <p className="wishlist-status" role="status">
      {pending ? 'Guardando y confirmando con el servidor…' : data ? 'Actualizando listas…' : 'Cargando listas…'}
      {fetching && ' Si no avanza, comprueba tu conexión.'}
    </p>}
  </>
}

function WishlistNameForm({ initialName = '', label = 'Nueva lista privada', submitLabel = 'Crear lista', onSave }: {
  initialName?: string; label?: string; submitLabel?: string; onSave: (name: string) => Promise<boolean>
}) {
  const { canWrite } = useWishlists()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const alive = useRef(false)
  useLayoutEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canWrite) return
    const parsed = wishlistNameSchema.safeParse(name)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    setError(null)
    try {
      if (await onSave(parsed.data) && alive.current) setName('')
    } catch (failure) {
      if (alive.current) setError(wishlistErrorMessage(failure))
    }
  }
  return <form className="wishlist-name-form" onSubmit={(event) => { void submit(event) }}>
    <label className="wishlist-name-label" htmlFor={id}>{label}</label>
    <div className="wishlist-name-row">
      <input className="wishlist-name-input" id={id} value={name} maxLength={80} required disabled={!canWrite}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)}
        onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="Por ejemplo: Próximas cartas" />
      <button type="submit" className="wishlist-button wishlist-button-primary" disabled={!canWrite || !name.trim()}>
        <Plus size={17} aria-hidden="true" />{submitLabel}
      </button>
    </div>
    <small className="wishlist-hint" id={`${id}-hint`}>Entre 1 y 80 caracteres. Solo tú puedes ver esta lista.</small>
    {error && <p className="wishlist-error" role="alert" id={`${id}-error`}>{error}</p>}
  </form>
}

export function WishlistHeart(props: { card: CardBrief; language: Language; onAuth: () => void }) {
  const { userId } = useWishlists()
  return <WishlistHeartScope key={JSON.stringify([userId, props.card.id, props.language])} {...props} />
}

function WishlistHeartScope({ card, language, onAuth }: { card: CardBrief; language: Language; onAuth: () => void }) {
  const { userId, data, error, fetching, pending, canWrite, run } = useWishlists()
  const [open, setOpen] = useState(false)
  const saved = Boolean(userId && data && isCardWished(data.items, card.id, language))
  return <>
    <button type="button" className="wish-heart" aria-label={`Listas de deseos de ${card.name}`}
      aria-pressed={saved} aria-haspopup="dialog" aria-busy={Boolean(userId && (fetching || pending))}
      disabled={Boolean(userId && pending)} onClick={(event) => {
        event.stopPropagation()
        if (!userId) { onAuth(); return }
        setOpen(true)
      }}>
      <Heart size={22} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
    {open && userId && <Modal title="Guardar en listas de deseos" busy={pending} onClose={() => setOpen(false)}>
      <div className="wishlist-picker">
        <p className="wishlist-private"><LockKeyhole size={16} aria-hidden="true" />Listas privadas · Solo tú</p>
        <p className="wishlist-picker-card"><strong>{card.name}</strong><span>{languages[language]} · {card.localId}</span></p>
        <p className="wishlist-hint">Marca todas las listas que quieras. Cada cambio se guarda al momento y se muestra tras confirmarlo.</p>
        <WishlistStatus />
        {data && <>
          {data.lists.length === 0 ? !error && <p className="wishlist-empty">Aún no tienes listas. Crea una y después márcala para guardar esta carta.</p> :
            <fieldset className="wishlist-options" disabled={!canWrite}>
              <legend>Listas para esta carta en {languages[language]}</legend>
              {data.lists.map((list) => {
                const checked = isCardWished(data.items, card.id, language, list.id)
                return <label className="wishlist-option" key={list.id}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    void run((owner, signal) => checked
                      ? removeWishlistItem(owner, list.id, card.id, language, signal)
                      : addWishlistItem(owner, list.id, card, language, signal))
                  }} />
                  <span>{list.name}</span>
                </label>
              })}
            </fieldset>}
          <WishlistNameForm onSave={(name) => run((owner, signal) => createWishlist(owner, name, signal))} />
        </>}
        <div className="wishlist-actions"><button type="button" className="wishlist-button" disabled={pending} onClick={() => setOpen(false)}>Cerrar</button></div>
      </div>
    </Modal>}
  </>
}

type PageProps = { onAuth: () => void; onOpenCard: (card: CardBrief, language: Language) => void; onExploreCatalog?: () => void }
type ListDialog = { kind: 'rename'; list: Wishlist } | { kind: 'delete'; list: Wishlist } | { kind: 'remove'; list: Wishlist; item: WishlistItem }

export function WishlistPage(props: PageProps) {
  const { userId } = useWishlists()
  return <WishlistPageScope key={userId ?? 'anonymous'} {...props} />
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

function exportWishlist(name: string, items: WishlistItem[]) {
  const header = ['Carta', 'Expansion', 'Idioma', 'Precio objetivo', 'Enlace Cardmarket']
  const rows = items.map((item) => [
    item.card_snapshot.name,
    item.card_snapshot.id.split('-')[0] ?? item.card_snapshot.id,
    languages[item.language],
    item.target_price === null ? '' : item.target_price.toFixed(2),
    cardmarketUrl(item.card_snapshot, item.language),
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^a-z0-9áéíóúüñ]+/gi, '-').replace(/^-|-$/g, '') || 'lista-de-deseos'}.csv`
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function WishlistTargetPrice({ item, canWrite, pending, onSave }: {
  item: WishlistItem; canWrite: boolean; pending: boolean; onSave: (value: number | null) => Promise<boolean>
}) {
  const [value, setValue] = useState(item.target_price === null ? '' : String(item.target_price))
  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = value.trim() === '' ? null : Number(value)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999)) return
    await onSave(parsed)
  }
  return <form className="wishlist-target-price" onSubmit={(event) => { void submit(event) }}>
    <label>Precio objetivo (€)<input type="number" min="0" max="9999999" step="0.01" placeholder="Sin objetivo" value={value} disabled={!canWrite || pending} onChange={(event) => setValue(event.target.value)} /></label>
    <button type="submit" className="wishlist-button" disabled={!canWrite || pending}>Guardar</button>
  </form>
}

function WishlistPriceAlerts({ userId, items }: { userId: string; items: WishlistItem[] }) {
  const alerts = useQuery({ queryKey: ['wishlist-price-alerts', userId], queryFn: ({ signal }) => loadWishlistPriceAlerts(userId, signal), staleTime: 60000 })
  if (alerts.isError) return <p role="alert">No se pudieron cargar los avisos de precio. <button onClick={() => void alerts.refetch()}>Reintentar avisos</button></p>
  if (!alerts.data?.length) return null
  return <div className="wishlist-price-alerts" role="status">
    <strong>Precios objetivo alcanzados</strong>
    {alerts.data.map((alert: WishlistPriceAlert) => {
      const item = items.find((candidate) => candidate.card_id === alert.card_id && candidate.language === alert.language)
      return <p key={alert.id}>{item?.card_snapshot.name ?? alert.card_id}: {alert.observed_price.toFixed(2)} € (objetivo {alert.target_price.toFixed(2)} €).</p>
    })}
  </div>
}

function PriceAlertSettings({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const preference = useQuery({ queryKey: ['price-alert-email', userId], queryFn: ({ signal }) => loadPriceAlertEmailPreference(userId, signal), staleTime: 60000 })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => { controller.abort() }
  }, [userId])
  async function changePreference(enabled: boolean) {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || inFlight.current) return
    inFlight.current = true
    setPending(true); setError('')
    try {
      await updatePriceAlertEmailPreference(userId, enabled, controller.signal)
      if (controller.signal.aborted) return
      queryClient.setQueryData(['price-alert-email', userId], enabled)
    } catch {
      if (!controller.signal.aborted) setError('No se pudo guardar la preferencia de correo. Inténtalo de nuevo.')
    } finally {
      if (!controller.signal.aborted) { inFlight.current = false; setPending(false) }
    }
  }
  return <div className="wishlist-alert-settings">
    <div><strong>Avisos de precio</strong><p>Añade un precio objetivo a las cartas que quieras seguir. Cuando la comprobación detecte que una carta ha alcanzado ese importe, se generará una notificación dentro de Pokéfolio.</p><p className="wishlist-alert-schedule">La comprobación se ejecuta a diario. Los avisos y correos pueden demorarse más de un día según las comprobaciones pendientes y los reintentos; no son instantáneos.</p></div>
    {error && <p role="alert">{error}</p>}
    {preference.isError && <p role="alert">No se pudo cargar la preferencia de correo. <button onClick={() => void preference.refetch()}>Reintentar preferencia</button></p>}
    {pending && <p role="status">Guardando preferencia de correo…</p>}
    <label><input type="checkbox" checked={preference.data === true} disabled={pending || preference.isPending || preference.isError} onChange={(event) => { void changePreference(event.target.checked) }} /> Enviarme también un correo</label>
  </div>
}

function WishlistPageScope({ onAuth, onOpenCard, onExploreCatalog }: PageProps) {
  const { userId, data, error, fetching, pending, canWrite, run, retry } = useWishlists()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ListDialog | null>(null)
  const headingId = useId()
  const selected = data?.lists.find((list) => list.id === selectedId) ?? data?.lists[0]
  const items = selected ? data?.items.filter((item) => item.list_id === selected.id) : undefined

  const totalWishedItems = data?.items.length ?? 0
  const totalLists = data?.lists.length ?? 0
  const featuredItem = data?.items[0]
  const hasCards = totalWishedItems > 0

  const counts = useMemo(() => {
    const result = new Map<string, number>()
    data?.items.forEach((item) => result.set(item.list_id, (result.get(item.list_id) ?? 0) + 1))
    return result
  }, [data?.items])

  const save = async (write: Write) => {
    const confirmed = await run(write)
    if (confirmed) setDialog(null)
    return confirmed
  }

  return <>
    <section className="hero trainer-hero collection-hero" aria-labelledby={headingId}>
      <div className="hero-copy">
        <span className="eyebrow"><span className="live-dot" />TUS LISTAS DE DESEOS</span>
        {hasCards
          ? <h1 id={headingId}>{totalWishedItems.toLocaleString('es-ES')} {totalWishedItems === 1 ? 'carta guardada' : 'cartas guardadas'}.<br /><span>Una historia en cada carta.</span></h1>
          : <h1 id={headingId}>Tus listas<br /><span>empiezan con una carta.</span></h1>}
        <p>{hasCards
          ? 'Cada hallazgo tiene su sitio. Revisa tus listas privadas, organiza tus objetivos de compra y mantén el seguimiento sin alterar tu colección principal.'
          : 'Organiza tus próximos objetivos. Explora el catálogo y añade las cartas que buscas a tus listas privadas.'}</p>
        
        <div className="hero-actions">
          <button className="primary" onClick={onExploreCatalog}>Explorar catálogo <ArrowRight size={18} /></button>
          <span className="hero-note"><ShieldCheck size={16} aria-hidden="true" />Tu colección, en tu cuenta</span>
        </div>
        
        {userId && data && (
          <dl className="collection-passport">
            <div><dt><BookOpen size={14} aria-hidden="true" />Listas creadas</dt><dd>{totalLists}</dd></div>
            <div><dt><Heart size={14} aria-hidden="true" />En deseos</dt><dd>{totalWishedItems.toLocaleString('es-ES')}</dd></div>
          </dl>
        )}
      </div>
      
      <aside className="collection-display" aria-label="Carta destacada de tus listas">
        <div className="collection-device-top">
          <span className="collection-device-lights" aria-hidden="true"><i /><i /><i /></span>
          <span>POKÉFOLIO / TCG</span>
        </div>
        <div className="collection-feature">
          <p className="collection-feature-label"><Sparkles size={13} aria-hidden="true" />{featuredItem ? 'CARTA DESTACADA' : 'TU PRIMER OBJETIVO'}</p>
          <div className="collection-feature-body">
            <div className="collection-feature-media">
              {featuredItem ? <CardImage card={featuredItem.card_snapshot} /> : <div className="collection-card-slot" aria-hidden="true"><span className="pokeball" /><span>EL PRIMER HUECO<br />ES PARA TU FAVORITA</span></div>}
            </div>
            <div className="collection-feature-detail">
              <h2>{featuredItem ? featuredItem.card_snapshot.name : 'Una favorita por buscar'}</h2>
              <p className="collection-feature-set">{featuredItem ? `N.º ${featuredItem.card_snapshot.localId}` : 'Búscala en el catálogo y añádela a tu lista.'}</p>
              {featuredItem && <p className="collection-feature-tags"><span>{languages[featuredItem.language]}</span></p>}
              <div className="collection-feature-value">
                {featuredItem ? (
                  <button 
                    type="button" 
                    className="wishlist-button" 
                    onClick={() => onOpenCard(featuredItem.card_snapshot, featuredItem.language)}
                    style={{ width: '100%', marginTop: '8px' }}
                  >
                    Ver detalles de la carta
                  </button>
                ) : (
                  <strong>Tu aventura empieza aquí</strong>
                )}
              </div>
            </div>
          </div>
        </div>
        <p className="collection-device-note"><LockKeyhole size={13} aria-hidden="true" />Solo tú puedes ver tus listas privadas.</p>
      </aside>
    </section>

    <section className="wishlist-page">
      {!userId ? <div className="wishlist-empty">
        <h2>Tus próximas cartas, en un solo lugar</h2><p>Inicia sesión para crear varias listas privadas y guardar cartas por idioma.</p>
        <button type="button" className="wishlist-button wishlist-button-primary" onClick={onAuth}>Iniciar sesión</button>
      </div> : <>
        <WishlistStatus />
        {data && <>
          <WishlistPriceAlerts userId={userId} items={data.items} />
          <WishlistNameForm onSave={(name) => run((owner, signal) => createWishlist(owner, name, signal))} />
          {!data.lists.length ? !error && <div className="wishlist-empty"><h2>Aún no tienes listas</h2><p>Crea tu primera lista privada. Después añade cartas con el corazón del catálogo.</p></div> :
            <div className="wishlist-layout">
              <nav className="wishlist-sidebar" aria-label="Mis listas privadas">
                <h2>Mis listas</h2>
                <ul className="wishlist-list-nav">{data.lists.map((list) => <li key={list.id}>
                  <button type="button" className="wishlist-list-button" aria-current={selected?.id === list.id ? 'true' : undefined}
                    disabled={pending} onClick={() => setSelectedId(list.id)}>
                    <span>{list.name}</span><span className="wishlist-count" aria-label={`${counts.get(list.id) ?? 0} cartas`}>
                      {counts.get(list.id) ?? 0}
                    </span>
                  </button>
                </li>)}</ul>
              </nav>
              {selected && <section className="wishlist-content" aria-label={`Lista ${selected.name}`}>
                <div className="wishlist-list-heading"><div><h2>{selected.name}</h2><p>{items?.length} cartas · Lista privada</p></div>
                  <div className="wishlist-actions">
                    <button type="button" className="wishlist-button" disabled={!items?.length} onClick={() => exportWishlist(selected.name, items ?? [])}><Download size={15} />Exportar lista de compra</button>
                    <button type="button" className="wishlist-button" disabled={!canWrite} onClick={() => setDialog({ kind: 'rename', list: selected })}>Renombrar</button>
                    <button type="button" className="wishlist-button wishlist-button-danger" disabled={!canWrite} onClick={() => setDialog({ kind: 'delete', list: selected })}>Eliminar lista</button>
                  </div>
                </div>

                <div className="cardmarket-referral-banner" style={{
                  background: "var(--background-secondary, #f8f9fa)",
                  border: "1px solid var(--border-color, #e9ecef)",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  margin: "16px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  fontSize: "0.9rem"
                }}>
                  <div>
                    <strong>¿Vas a comprar cartas de esta lista?</strong>
                    <p style={{ margin: "4px 0 0 0", color: "var(--text-muted, #6c757d)" }}>
                      Si aún no tienes cuenta en Cardmarket, puedes apoyarnos introduciendo el usuario <code>daxter14</code> al registrarte.
                    </p>
                  </div>
                  <a 
                    href="https://www.cardmarket.com/es/Pokemon" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="wishlist-button"
                    style={{ whiteSpace: "nowrap", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    Ir a Cardmarket <ExternalLink size={14} />
                  </a>
                </div>

                <PriceAlertSettings userId={userId} />

                {items?.length === 0 ? !error && <div className="wishlist-empty"><h3>Esta lista aún no tiene cartas</h3><p>Abre el corazón de una carta del catálogo y marca esta lista.</p></div> :
                  <ul className="wishlist-cards">{items?.map((item) => <li className="wishlist-card" key={wishlistCardKey(item.card_id, item.language)}>
                    <button type="button" className="wishlist-card-open" aria-label={`Abrir ${item.card_snapshot.name} en ${languages[item.language]}`}
                      onClick={() => onOpenCard(item.card_snapshot, item.language)}>
                      <CardImage card={item.card_snapshot} />
                      <span className="wishlist-card-info"><strong>{item.card_snapshot.name}</strong><span>{languages[item.language]}</span><small>N.º {item.card_snapshot.localId}</small></span>
                    </button>
                    <WishlistTargetPrice key={`${item.list_id}:${item.target_price ?? 'none'}`} item={item} canWrite={canWrite} pending={pending} onSave={(targetPrice) => save((owner, signal) => updateWishlistItemTargetPrice(owner, selected.id, item.card_id, item.language, targetPrice, signal))} />
                    <button type="button" className="wishlist-button wishlist-card-remove" disabled={!canWrite}
                      aria-label={`Quitar ${item.card_snapshot.name} en ${languages[item.language]} de ${selected.name}`}
                      onClick={() => setDialog({ kind: 'remove', list: selected, item })}><Trash2 size={16} aria-hidden="true" />Quitar de esta lista</button>
                  </li>)}</ul>}
              </section>}
            </div>}
        </>}
        {!error && <div className="wishlist-actions"><button type="button" className="wishlist-button" disabled={fetching || pending} onClick={() => { void retry() }}>Actualizar listas</button></div>}
      </>}
      {userId && dialog && <Modal title={dialog.kind === 'rename' ? 'Renombrar lista' : dialog.kind === 'delete' ? 'Eliminar lista privada' : 'Quitar carta de esta lista'} busy={pending} onClose={() => setDialog(null)}>
        <div className="wishlist-dialog">
          <WishlistStatus />
          {dialog.kind === 'rename' ? <WishlistNameForm initialName={dialog.list.name} label="Nombre de la lista" submitLabel="Guardar nombre"
            onSave={(name) => save((owner, signal) => renameWishlist(owner, dialog.list.id, name, signal))} /> : <>
            <p>{dialog.kind === 'delete' ? <>¿Eliminar <strong>{dialog.list.name}</strong> y todas sus cartas guardadas?</> :
              <>¿Quitar <strong>{dialog.item.card_snapshot.name}</strong> ({languages[dialog.item.language]}) de <strong>{dialog.list.name}</strong>?</>}</p>
            <p className="wishlist-hint">No se modificará tu colección ni ninguna otra lista.{dialog.kind === 'delete' && ' Esta eliminación no se puede deshacer.'}</p>
            <button type="button" className="wishlist-button wishlist-button-danger" disabled={!canWrite} onClick={() => {
              void save((owner, signal) => dialog.kind === 'delete'
                ? deleteWishlist(owner, dialog.list.id, signal)
                : removeWishlistItem(owner, dialog.list.id, dialog.item.card_id, dialog.item.language, signal))
            }}>{dialog.kind === 'delete' ? 'Confirmar eliminación' : 'Confirmar quitar carta'}</button>
          </>}
          <button type="button" className="wishlist-button" disabled={pending} onClick={() => setDialog(null)}>Cancelar</button>
        </div>
      </Modal>}
    </section>
  </>
}
