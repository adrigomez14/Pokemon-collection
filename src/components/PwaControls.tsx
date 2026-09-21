import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Download, RefreshCw, WifiOff } from 'lucide-react'
import { pwaClient } from '../lib/pwa'
import { Modal } from './Modal'
import '../pwa.css'

function usePwa() {
  return useSyncExternalStore(pwaClient.subscribe, pwaClient.getSnapshot, pwaClient.getServerSnapshot)
}

function PwaBrand() {
  return <div className="pwa-brand"><img src="/pwa/icon-192.png" width="48" height="48" alt="" /><strong>Pokéfolio</strong></div>
}

/** Acceso de ayuda siempre disponible en el footer, incluso sin prompt nativo. */
export function PwaInstallButton({ label }: { label?: string } = {}) {
  const state = usePwa()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    // Esperar al desmontaje del dialog: mientras está abierto, el disparador es inerte.
    if (!open && returnFocus.current) {
      returnFocus.current = false
      trigger.current?.focus()
    }
  }, [open])
  return <>
    <button ref={trigger} type="button" className="pwa-install-link" onClick={() => { returnFocus.current = true; setOpen(true) }} aria-haspopup="dialog">
      <Download size={15} aria-hidden="true" />{label ?? (state.installed ? 'App instalada' : 'Instalar app')}
    </button>
    {open && <Modal title={state.installed ? 'App instalada' : 'Instalar Pokéfolio'} onClose={() => setOpen(false)}>
      <div className="pwa-install-content">
        <PwaBrand />
        {state.installed ? <p>Pokéfolio ya está instalada o se está usando en modo app en este navegador.</p> : <>
          <p>Ten Pokéfolio a mano desde tu pantalla de inicio. La instalación depende del navegador y del dispositivo.</p>
          {state.canInstall && <button type="button" className="pwa-primary" disabled={state.installing || !state.online}
            onClick={() => { void pwaClient.install() }}>Instalar Pokéfolio</button>}
          {state.installing && <p role="status">Esperando la respuesta del navegador…</p>}
          {state.installMessage && <p className="pwa-message" role="status">{state.installMessage}</p>}
          {state.inAppBrowser && <p className="pwa-message">Parece que estás en el navegador de otra aplicación.
            Abre esta página en {state.platform === 'apple' ? 'Safari' : 'Chrome o Edge'} para consultar sus opciones de instalación.</p>}
          <section className="pwa-instructions" aria-label="Pasos de instalación">
            {state.platform === 'apple' ? <>
              <h3>iPhone o iPad · Safari</h3>
              <ol><li>Abre Pokéfolio en Safari, fuera de otras aplicaciones.</li><li>Pulsa Compartir (puede estar dentro del menú).</li>
                <li>Busca «Añadir a pantalla de inicio» y confirma «Añadir».</li></ol>
            </> : state.platform === 'android' ? <>
              <h3>Android · Chrome</h3>
              <ol><li>Abre Pokéfolio en Chrome.</li><li>Abre el menú ⋮.</li>
                <li>Busca «Instalar aplicación» o «Añadir a pantalla de inicio» y sigue los pasos disponibles.</li></ol>
            </> : <>
              <h3>Ordenador · Chrome o Edge</h3>
              <ol><li>Abre Pokéfolio en Chrome o Edge.</li><li>Busca el icono de instalación en la barra de direcciones o la opción de instalar en el menú del navegador.</li>
                <li>Si aparece, sigue los pasos del navegador.</li></ol>
              <p>En iPhone o iPad: Safari → Compartir → Añadir a pantalla de inicio. En Android: Chrome → menú ⋮ → Instalar aplicación.</p>
            </>}
            <p>Si no aparece esa opción, puedes seguir usando la web o guardarla en favoritos. Un acceso directo no siempre equivale a una app instalada.</p>
          </section>
        </>}
        <p className="pwa-note">Necesitas conexión para consultar y modificar tu colección. No se guardan operaciones para enviarlas después.
          La señal de conexión no garantiza que todos los servicios estén disponibles; la app seguirá mostrando sus errores.</p>
        {state.serviceWorkerError && <p className="pwa-note">{state.serviceWorkerError}</p>}
      </div>
    </Modal>}
  </>
}

/** Presentación visible en el catálogo, sin ventanas automáticas ni preferencias persistidas. */
export function PwaInstallGuide() {
  const state = usePwa()
  return <section className="pwa-guide" aria-labelledby="pwa-guide-title">
    <div className="pwa-guide-intro">
      <img src="/pwa/icon-192.png" width="64" height="64" alt="" />
      <div>
        <p className="pwa-guide-eyebrow">TU COLECCIÓN, A MANO</p>
        <h2 id="pwa-guide-title">Pokéfolio también en tu móvil</h2>
        <p>Añade Pokéfolio a tu pantalla de inicio y ábrelo como una app, sin pasar por una tienda de aplicaciones.
          Con conexión puedes guardar cartas y gestionar tus deseos con la misma cuenta que en la web.</p>
      </div>
    </div>
    {state.installed && <p className="pwa-guide-installed">Ya estás usando Pokéfolio como app o has confirmado su instalación en este navegador.</p>}
    <details className="pwa-guide-details">
      <summary>Ver pasos para instalar en el móvil</summary>
      <div className="pwa-guide-platforms">
        <section aria-labelledby="pwa-guide-android">
          <h3 id="pwa-guide-android">Android · Chrome</h3>
          <ol><li>Abre <strong>www.pokefoliotcg.es</strong> en Chrome.</li>
            <li>Abre el menú <strong>⋮</strong> y busca <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</li>
            <li>Confirma los pasos del navegador. Si aparece el botón de instalación en Pokéfolio, también puedes utilizarlo.</li></ol>
        </section>
        <section aria-labelledby="pwa-guide-apple">
          <h3 id="pwa-guide-apple">iPhone o iPad · Safari</h3>
          <ol><li>Abre <strong>www.pokefoliotcg.es</strong> en Safari.</li>
            <li>Pulsa <strong>Compartir</strong> (puede estar dentro del menú) y busca <strong>Añadir a pantalla de inicio</strong>.</li>
            <li>Si aparece <strong>Abrir como app</strong>, déjalo activado y confirma <strong>Añadir</strong>.</li></ol>
        </section>
      </div>
      <p>Si has llegado desde Instagram, Gmail u otra aplicación, abre primero la página en Chrome o Safari.
        Si no aparece la opción de instalar, puedes seguir usando la web; depende del navegador y del dispositivo.</p>
      <p>Puede que tengas que iniciar sesión de nuevo. Tu colección sigue en la misma cuenta.
        Necesitas conexión para consultar y guardar datos; sin ella solo se muestra un aviso y no se guardan cambios para enviarlos después.
        Instalarla no activa notificaciones push.</p>
      <PwaInstallButton label="Opciones de instalación" />
    </details>
  </section>
}

function PwaUpdateNotice() {
  const state = usePwa()
  const [confirming, setConfirming] = useState(false)
  if (!state.updateAvailable && !state.updateMessage && !state.updating) return null
  return <aside className="pwa-update" aria-label="Actualizaciones de Pokéfolio">
    <div className="pwa-update-copy" role="status">
      <strong>{state.updating ? 'Actualizando Pokéfolio…' : state.updateAvailable ? 'Nueva versión disponible' : 'Actualización de Pokéfolio'}</strong>
      <span>{state.updateMessage || 'Puedes seguir usando la app y actualizar cuando hayas guardado tus cambios.'}</span>
    </div>
    {state.updateAvailable && <button type="button" className="pwa-primary" disabled={state.updating} onClick={() => setConfirming(true)}>
      <RefreshCw size={16} aria-hidden="true" />Actualizar
    </button>}
    {confirming && <Modal title="¿Actualizar Pokéfolio?" onClose={() => setConfirming(false)}>
      <div className="pwa-confirm-content">
        <p>Esta pestaña se recargará al activar la nueva versión. <strong>Los borradores y cambios sin guardar pueden perderse.</strong></p>
        <p>Guarda tus cambios antes de continuar. Las demás pestañas no se recargarán automáticamente.</p>
        <div className="pwa-actions">
          <button type="button" className="pwa-secondary" onClick={() => setConfirming(false)}>Ahora no</button>
          <button type="button" className="pwa-primary" disabled={!state.updateAvailable || state.updating} onClick={() => {
            pwaClient.confirmUpdate()
            setConfirming(false)
          }}>Actualizar y recargar</button>
        </div>
      </div>
    </Modal>}
  </aside>
}

/** Oculta la UI sin desmontarla: los borradores permanecen en memoria, no se persisten. */
export function PwaBoundary({ children }: { children: ReactNode }) {
  const state = usePwa()
  const appRef = useRef<HTMLDivElement>(null)
  const offlineTitleRef = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    if (state.online || !appRef.current) return
    const app = appRef.current
    const previouslyFocused = document.activeElement
    const suspendedDialogs = new Set<HTMLDialogElement>()
    // Los diálogos modales están en el top layer: hidden/inert del padre no basta.
    const suspendDialogs = () => {
      app.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => {
        suspendedDialogs.add(dialog)
        dialog.close()
      })
    }
    suspendDialogs()
    const observer = new MutationObserver(suspendDialogs)
    observer.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    offlineTitleRef.current?.focus()
    return () => {
      observer.disconnect()
      suspendedDialogs.forEach((dialog) => {
        if (!dialog.isConnected || !app.contains(dialog) || dialog.open) return
        try { dialog.showModal() } catch { /* Puede haberse retirado durante la recuperación. */ }
      })
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [state.online])

  return <div className="pwa-boundary">
    <div ref={appRef} className="pwa-app" hidden={!state.online} inert={!state.online} aria-hidden={!state.online ? true : undefined}>
      {children}
    </div>
    {state.online ? <PwaUpdateNotice /> : <section className="pwa-offline" aria-labelledby="pwa-offline-title">
      <div className="pwa-offline-card">
        <PwaBrand />
        <div role="alert"><WifiOff className="pwa-offline-icon" size={36} aria-hidden="true" />
          <h1 id="pwa-offline-title" ref={offlineTitleRef} tabIndex={-1}>Sin conexión</h1>
          <p>Conéctate a internet para continuar en Pokéfolio. Tu colección no se muestra sin conexión y no puedes realizar cambios.</p>
        </div>
        <p>Conservamos los borradores abiertos mientras esta pestaña siga abierta. No la cierres ni la recargues si tienes cambios sin guardar.</p>
        <button type="button" className="pwa-primary" disabled={state.checkingConnection}
          onClick={() => { void pwaClient.checkConnection() }}><RefreshCw size={16} aria-hidden="true" />
          {state.checkingConnection ? 'Comprobando…' : 'Comprobar conexión'}
        </button>
        <p className="pwa-message" role="status">{state.connectionMessage}</p>
        <p className="pwa-note">Comprobamos únicamente un recurso público de Pokéfolio. Recuperar la conexión no garantiza la disponibilidad de los servicios de tu colección.</p>
      </div>
    </section>}
  </div>
}
