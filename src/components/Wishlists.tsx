import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Heart, LockKeyhole, Plus, Trash2, ArrowRight } from 'lucide-react'
import { languages, type CardBrief, type Language } from '../lib/models'
import {
  addWishlistItem, createWishlist, deleteWishlist, isCardWished, loadWishlists, removeWishlistItem,
  renameWishlist, wishlistCardKey, wishlistErrorMessage, wishlistNameSchema,
  type Wishlist, type WishlistData, type WishlistItem,
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

type HeartProps = { card: CardBrief; language: Language; onAuth: () => void }

export function WishlistHeart(props: HeartProps) {
  const { userId } = useWishlists()
  return <WishlistHeartScope key={JSON.stringify([userId, props.card.id, props.language])} {...props} />
}

function WishlistHeartScope({ card, language, onAuth }: HeartProps) {
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

  return <section className="wishlist-page" aria-labelledby={headingId} style={{ padding: '24px 0' }}>
    
    {/* Cabecera estilo Archivo de Entrenador (con colores adaptados a fondo claro) */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      gap: '32px',
      alignItems: 'start',
      marginBottom: '40px'
    }}>
      {/* Columna izquierda: Títulos, subtítulo, botón principal y tarjetas de datos */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#16a34a', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }}></span>
          TU ESPACIO PRIVADO
        </div>
        
        <h1 id={headingId} style={{ fontSize: '2.8rem', fontWeight: 800, margin: '0 0 8px 0', lineHeight: 1.1, color: '#0f172a' }}>
          {totalWishedItems} {totalWishedItems === 1 ? 'carta guardada.' : 'cartas guardadas.'}
          <span style={{ display: 'block', color: '#d97706', fontWeight: 700, marginTop: '4px' }}>Tus próximas adquisiciones.</span>
        </h1>
        
        <p style={{ color: '#475569', fontSize: '1.05rem', lineHeight: '1.5', maxWidth: '600px', margin: '16px 0 24px 0' }}>
          Cada hallazgo tiene su sitio. Revisa tus listas privadas, organiza tus objetivos de compra y mantén el seguimiento sin alterar tu colección principal.
        </p>

        {/* Botón amarillo principal */}
        <div style={{ marginBottom: '32px' }}>
          <button 
            type="button" 
            onClick={onExploreCatalog}
            style={{
              background: '#fbbf24',
              color: '#0f172a',
              fontWeight: 700,
              fontSize: '0.95rem',
              padding: '14px 24px',
              borderRadius: '10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(251, 191, 36, 0.2)'
            }}
          >
            Explorar catálogo <ArrowRight size={18} />
          </button>
          <span style={{ display: 'block', color: '#64748b', fontSize: '0.8rem', marginTop: '8px' }}>
            🔒 Listas protegidas y 100% privadas para ti
          </span>
        </div>

        {/* Bloque de tarjetas inferiores de estadísticas */}
        {userId && data && (
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 24px', minWidth: '150px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <span style={{ display: 'block', color: '#64748b', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Listas creadas</span>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{totalLists}</span>
            </div>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 24px', minWidth: '150px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <span style={{ display: 'block', color: '#64748b', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Total en deseos</span>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{totalWishedItems}</span>
            </div>
          </div>
        )}
      </div>

      {/* Columna derecha: Tarjeta estilo Pokéfolio con la carta destacada */}
      {featuredItem ? (
        <div style={{
          background: '#dc2626',
          borderRadius: '20px',
          padding: '16px',
          boxShadow: '0 25px 30px -10px rgba(0, 0, 0, 0.2)',
          color: '#0f172a'
        }}>
          {/* Detalles superiores tipo dispositivo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', padding: '0 4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#60a5fa', border: '2px solid white' }}></div>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f87171' }}></div>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#facc15' }}></div>
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>WISHLIST / TCG</span>
          </div>

          {/* Tarjeta interior blanca */}
          <div style={{ background: '#f8fafc', borderRadius: '14px', padding: '14px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Heart size={13} fill="currentColor" color="#dc2626" /> CARTA DESTACADA
            </div>
            
            <div style={{ background: '#e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center', marginBottom: '12px' }}>
              <div style={{ maxHeight: '180px', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                <CardImage card={featuredItem.card_snapshot} />
              </div>
            </div>

            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a', marginBottom: '2px' }}>
              {featuredItem.card_snapshot.name}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
              N.º {featuredItem.card_snapshot.localId} · {languages[featuredItem.language]}
            </div>

            <button 
              type="button" 
              onClick={() => onOpenCard(featuredItem.card_snapshot, featuredItem.language)}
              style={{
                width: '100%',
                background: '#0f172a',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Ver detalles de la carta
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#ffffff',
          border: '2px dashed #cbd5e1',
          borderRadius: '20px',
          padding: '32px',
          textAlign: 'center',
          color: '#64748b'
        }}>
          <Heart size={32} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
          <p style={{ fontSize: '0.9rem', margin: 0 }}>Añade cartas a tus listas para verlas destacadas aquí.</p>
        </div>
      )}
    </div>

    {!userId ? <div className="wishlist-empty">
      <h2>Tus próximas cartas, en un solo lugar</h2><p>Inicia sesión para crear varias listas privadas y guardar cartas por idioma.</p>
      <button type="button" className="wishlist-button wishlist-button-primary" onClick={onAuth}>Iniciar sesión</button>
    </div> : <>
      <WishlistStatus />
      {data && <>
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
                  <button type="button" className="wishlist-button" disabled={!canWrite} onClick={() => setDialog({ kind: 'rename', list: selected })}>Renombrar</button>
                  <button type="button" className="wishlist-button wishlist-button-danger" disabled={!canWrite} onClick={() => setDialog({ kind: 'delete', list: selected })}>Eliminar lista</button>
                </div>
              </div>

              {/* Banner de referido con daxter14 */}
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

              {items?.length === 0 ? !error && <div className="wishlist-empty"><h3>Esta lista aún no tiene cartas</h3><p>Abre el corazón de una carta del catálogo y marca esta lista.</p></div> :
                <ul className="wishlist-cards">{items?.map((item) => <li className="wishlist-card" key={wishlistCardKey(item.card_id, item.language)}>
                  <button type="button" className="wishlist-card-open" aria-label={`Abrir ${item.card_snapshot.name} en ${languages[item.language]}`}
                    onClick={() => onOpenCard(item.card_snapshot, item.language)}>
                    <CardImage card={item.card_snapshot} />
                    <span className="wishlist-card-info"><strong>{item.card_snapshot.name}</strong><span>{languages[item.language]}</span><small>N.º {item.card_snapshot.localId}</small></span>
                  </button>
                  <button type="button" className="wishlist-button wishlist-card-remove" disabled={!canWrite}
                    aria-label={`Quitar ${item.card_snapshot.name} en ${languages[item.language]} de ${selected.name}`}
                    onClick={() => setDialog({ kind: 'remove', list: selected, item })}><Trash2 size={16} aria-hidden="true" />Quitar de esta lista</button>
                </li>)}</ul>}
            </section>}
          </div>}
      </>}.
      {!error && <div className="wishlist-actions"><button type="button" className="wishlist-button" disabled={fetching || pending} onClick={() => { void retry() }}>Actualizar listas</button></div>}
    </>}.
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
}
