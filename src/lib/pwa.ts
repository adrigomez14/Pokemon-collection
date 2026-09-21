/** Evento de instalación diferida de Chromium; no está disponible en todos los navegadores. */
export interface PwaInstallPrompt extends Event {
  prompt(): Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaEnvironment {
  events: EventTarget
  document: EventTarget & Pick<Document, 'visibilityState'>
  navigator: Pick<Navigator, 'onLine' | 'userAgent' | 'maxTouchPoints'> & {
    standalone?: boolean
    serviceWorker?: ServiceWorkerContainer
  }
  matchMedia?: (query: string) => MediaQueryList
  fetch: typeof fetch
  reload: () => void
  production: boolean
  secure: boolean
}

export interface PwaSnapshot {
  online: boolean
  installed: boolean
  canInstall: boolean
  installing: boolean
  installMessage: string
  platform: 'apple' | 'android' | 'desktop'
  inAppBrowser: boolean
  updateAvailable: boolean
  updating: boolean
  updateMessage: string
  serviceWorkerError: string
  checkingConnection: boolean
  connectionMessage: string
}

const initialSnapshot: Readonly<PwaSnapshot> = Object.freeze({
  online: true, installed: false, canInstall: false, installing: false, installMessage: '',
  platform: 'desktop', inAppBrowser: false, updateAvailable: false, updating: false,
  updateMessage: '', serviceWorkerError: '', checkingConnection: false, connectionMessage: '',
})

/** Orientación, no una prueba de compatibilidad ni una promesa de instalación nativa. */
export function getPwaInstallContext(userAgent: string, maxTouchPoints = 0) {
  const apple = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh|MacIntel/i.test(userAgent) && maxTouchPoints > 1)
  const platform: PwaSnapshot['platform'] = apple ? 'apple' : /Android/i.test(userAgent) ? 'android' : 'desktop'
  const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)|WebView/i.test(userAgent)
    || (apple && !/Safari|CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent))
  return { platform, inAppBrowser }
}

function browserEnvironment(): PwaEnvironment | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null
  // Algunos contextos privados/restringidos lanzan al acceder a serviceWorker.
  let serviceWorker: ServiceWorkerContainer | undefined
  try { serviceWorker = navigator.serviceWorker } catch { /* La ayuda de instalación sigue disponible. */ }
  return {
    events: window, document,
    navigator: {
      get onLine() { return navigator.onLine },
      get standalone() { return (navigator as Navigator & { standalone?: boolean }).standalone },
      userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, serviceWorker,
    },
    matchMedia: window.matchMedia?.bind(window),
    fetch: window.fetch.bind(window), reload: () => window.location.reload(),
    production: import.meta.env.PROD, secure: window.isSecureContext === true,
  }
}

/** Cada instancia permite pruebas aisladas; la UI utiliza exclusivamente el singleton inferior. */
export function createPwaClient(resolveEnvironment: () => PwaEnvironment | null = browserEnvironment) {
  let snapshot = initialSnapshot
  const subscribers = new Set<() => void>()
  let environment: PwaEnvironment | null = null
  let started = false
  let generation = 0
  let installAttempt = 0
  let connectionAttempt = 0
  let deferredPrompt: PwaInstallPrompt | null = null
  let registration: ServiceWorkerRegistration | null = null
  let waitingWorker: ServiceWorker | null = null
  let consentWorker: ServiceWorker | null = null
  let reloaded = false
  let connectionController: AbortController | null = null
  let activationTimeout: ReturnType<typeof setTimeout> | undefined
  let lastUpdateCheck = -Infinity
  let updateCheckRunning = false
  let watchedWorkers = new WeakSet<ServiceWorker>()
  const cleanups: (() => void)[] = []

  function publish(patch: Partial<PwaSnapshot>) {
    if (Object.entries(patch).every(([key, value]) => Object.is(snapshot[key as keyof PwaSnapshot], value))) return
    snapshot = Object.freeze({ ...snapshot, ...patch })
    subscribers.forEach((notify) => notify())
  }

  function listen(target: EventTarget, type: string, listener: EventListener) {
    target.addEventListener(type, listener)
    cleanups.push(() => target.removeEventListener(type, listener))
  }

  function cancelConnectionCheck() {
    connectionAttempt++
    connectionController?.abort()
    connectionController = null
  }

  function clearConsent() {
    consentWorker = null
    clearTimeout(activationTimeout)
    activationTimeout = undefined
  }

  function offerUpdate(worker: ServiceWorker | null) {
    // Un primer install + clients.claim() nunca es una actualización que deba recargar.
    waitingWorker = environment?.navigator.serviceWorker?.controller && worker?.state === 'installed' ? worker : null
    publish({ updateAvailable: waitingWorker !== null })
  }

  function observeWorker(worker: ServiceWorker | null) {
    if (!worker || watchedWorkers.has(worker)) return
    watchedWorkers.add(worker)
    const changed = () => {
      if (worker.state === 'installed') offerUpdate(registration?.waiting ?? worker)
      if (worker.state === 'redundant' && waitingWorker === worker) {
        offerUpdate(registration?.waiting ?? null)
        clearConsent()
        publish({ updating: false, updateMessage: 'Esta actualización ya no está disponible. Inténtalo más tarde.' })
      }
    }
    listen(worker, 'statechange', changed)
    changed()
  }

  async function checkForUpdate() {
    if (!registration || !environment || !snapshot.online || environment.document.visibilityState !== 'visible'
      || updateCheckRunning || Date.now() - lastUpdateCheck < 60_000) return
    lastUpdateCheck = Date.now()
    updateCheckRunning = true
    const currentGeneration = generation
    try { await registration.update() } catch {
      if (generation === currentGeneration) publish({ serviceWorkerError: 'No se pudieron comprobar las actualizaciones. La web sigue disponible.' })
    } finally {
      if (generation === currentGeneration) updateCheckRunning = false
    }
  }

  function dispose() {
    if (!started) return
    started = false
    generation++
    installAttempt++
    cancelConnectionCheck()
    clearConsent()
    cleanups.splice(0).forEach((cleanup) => cleanup())
    environment = null
    registration = null
    waitingWorker = null
    deferredPrompt = null
    watchedWorkers = new WeakSet()
    updateCheckRunning = false
    lastUpdateCheck = -Infinity
    reloaded = false
    publish(initialSnapshot)
  }

  /** Llamar antes de createRoot. Idempotente; no vincular su limpieza al ciclo de vida de React. */
  function initialize() {
    if (started) return dispose
    environment = resolveEnvironment()
    if (!environment) return dispose
    started = true
    const currentGeneration = ++generation
    const env = environment
    let displayMode: MediaQueryList | undefined
    try { displayMode = env.matchMedia?.('(display-mode: standalone)') } catch { /* API opcional. */ }
    let installationConfirmed = false
    const syncInstalled = () => {
      const installed = installationConfirmed || displayMode?.matches === true || env.navigator.standalone === true
      if (installed) {
        deferredPrompt = null
        installAttempt++
      }
      publish({ installed, canInstall: !installed && deferredPrompt !== null,
        ...(installed ? { installing: false, installMessage: '' } : {}) })
    }
    publish({ ...initialSnapshot, online: env.navigator.onLine !== false,
      ...getPwaInstallContext(env.navigator.userAgent, env.navigator.maxTouchPoints) })
    syncInstalled()
    // Registrar sin await: captura el evento incluso antes de montar el footer.
    listen(env.events, 'beforeinstallprompt', (event) => {
      const prompt = event as PwaInstallPrompt
      if (typeof prompt.prompt !== 'function') return
      event.preventDefault()
      if (snapshot.installed) return
      deferredPrompt = prompt
      publish({ canInstall: !snapshot.installing, installMessage: '' })
    })
    listen(env.events, 'appinstalled', () => { installationConfirmed = true; syncInstalled() })
    if (displayMode?.addEventListener) listen(displayMode, 'change', syncInstalled)
    else if (displayMode?.addListener) {
      displayMode.addListener(syncInstalled)
      cleanups.push(() => displayMode?.removeListener(syncInstalled))
    }
    listen(env.events, 'offline', () => {
      cancelConnectionCheck()
      const wasUpdating = snapshot.updating
      clearConsent()
      publish({ online: false, checkingConnection: false, connectionMessage: '', updating: false,
        ...(wasUpdating ? { updateMessage: 'Se perdió la conexión. No se recargará la página automáticamente.' } : {}) })
    })
    listen(env.events, 'online', () => {
      cancelConnectionCheck()
      publish({ online: true, checkingConnection: false, connectionMessage: '' })
      void checkForUpdate()
    })
    listen(env.document, 'visibilitychange', () => {
      if (env.document.visibilityState !== 'visible') return
      syncInstalled()
      void checkForUpdate()
    })
    const serviceWorker = env.navigator.serviceWorker
    if (env.production && env.secure && serviceWorker) {
      listen(serviceWorker, 'controllerchange', () => {
        if (consentWorker && serviceWorker.controller === consentWorker && !reloaded && snapshot.online) {
          reloaded = true
          clearConsent()
          try { env.reload() } catch {
            publish({ updating: false, updateMessage: 'No se pudo recargar. Guarda tus cambios y recarga la página manualmente.' })
          }
        }
        offerUpdate(registration?.waiting ?? null)
      })
      void (async () => {
        try {
          const result = await serviceWorker.register('/sw.js', { type: 'classic', scope: '/', updateViaCache: 'none' })
          if (currentGeneration !== generation) return
          registration = result
          offerUpdate(result.waiting)
          observeWorker(result.waiting)
          observeWorker(result.installing)
          listen(result, 'updatefound', () => observeWorker(result.installing))
        } catch {
          if (currentGeneration === generation) publish({ serviceWorkerError: 'No se pudo activar el soporte de la app en este navegador. Puedes seguir usando la web.' })
        }
      })()
    }
    return dispose
  }

  /** Debe invocarse directamente desde el gesto del usuario, sin awaits previos. */
  async function install() {
    if (!deferredPrompt || snapshot.installed || snapshot.installing || !snapshot.online) return
    const prompt = deferredPrompt
    const attempt = ++installAttempt
    deferredPrompt = null // Los eventos nativos solo se pueden consumir una vez.
    publish({ installing: true, canInstall: false, installMessage: '' })
    try {
      // Atender userChoice incluso si prompt() lanza de forma síncrona.
      const choice = prompt.userChoice.catch(() => null)
      const promptResult = prompt.prompt()
      const [, result] = await Promise.all([promptResult, choice])
      if (attempt !== installAttempt) return
      if (!result) throw new Error('El navegador no confirmó la elección')
      publish({ installMessage: result.outcome === 'accepted'
        ? 'Solicitud aceptada. El navegador confirmará si se completa la instalación.'
        : 'Instalación cancelada. Puedes seguir usando la web o consultar los pasos manuales.' })
    } catch {
      if (attempt === installAttempt) publish({ installMessage: 'No se pudo abrir o completar la instalación. Consulta los pasos de tu navegador.' })
    } finally {
      if (attempt === installAttempt) publish({ installing: false, canInstall: deferredPrompt !== null && !snapshot.installed })
    }
  }

  /** Solo llamar después de confirmar explícitamente el posible descarte de borradores. */
  function confirmUpdate() {
    const worker = waitingWorker
    if (!worker || worker.state !== 'installed' || snapshot.updating || !snapshot.online || reloaded) return false
    consentWorker = worker
    publish({ updating: true, updateMessage: '' })
    activationTimeout = setTimeout(() => {
      clearConsent()
      publish({ updating: false, updateMessage: 'La actualización no se ha confirmado. No se ha recargado la página; puedes volver a intentarlo.' })
    }, 20_000)
    try { worker.postMessage({ type: 'SKIP_WAITING' }) } catch {
      clearConsent()
      publish({ updating: false, updateMessage: 'No se pudo solicitar la actualización. Tus borradores siguen en esta pestaña.' })
      return false
    }
    return true
  }

  /** Prueba acotada del origen público, nunca de Supabase, de sesiones ni de una API privada. */
  async function checkConnection() {
    if (!environment || snapshot.checkingConnection) return false
    const env = environment
    const attempt = ++connectionAttempt
    const controller = new AbortController()
    connectionController = controller
    publish({ checkingConnection: true, connectionMessage: '' })
    const timeout = setTimeout(() => controller.abort(), 8_000)
    let removeAbortListener = () => {}
    try {
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(new Error('Comprobación cancelada'))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort)
      })
      const probe = async () => {
        const response = await env.fetch('/manifest.webmanifest', {
          cache: 'no-store', signal: controller.signal, credentials: 'omit', mode: 'same-origin', redirect: 'error',
        })
        if (!response.ok) return false
        const manifest: unknown = await response.json()
        return typeof manifest === 'object' && manifest !== null
          && (('name' in manifest && manifest.name === 'Pokéfolio') || ('short_name' in manifest && manifest.short_name === 'Pokéfolio'))
      }
      const valid = await Promise.race([probe(), aborted])
      if (attempt !== connectionAttempt) return false
      if (!valid) throw new Error('Respuesta inesperada')
      publish({ online: true, connectionMessage: '' })
      return true
    } catch {
      if (attempt === connectionAttempt) publish({ connectionMessage: 'No se pudo comprobar la conexión. Revisa tu red y vuelve a intentarlo.' })
      return false
    } finally {
      clearTimeout(timeout)
      removeAbortListener()
      if (attempt === connectionAttempt) {
        connectionController = null
        publish({ checkingConnection: false })
      }
    }
  }

  return {
    initialize, dispose, install, confirmUpdate, checkConnection,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    subscribe: (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify) } },
  }
}

export const pwaClient = createPwaClient()

/** Integración: ejecutar una vez en main antes de createRoot; React solo se suscribe al store. */
export function initializePwa() { return pwaClient.initialize() }
