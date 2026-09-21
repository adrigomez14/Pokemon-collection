import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPwaClient, getPwaInstallContext, type PwaEnvironment, type PwaInstallPrompt } from '../src/lib/pwa'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

class WorkerStub extends EventTarget {
  state: ServiceWorkerState = 'installed'
  postMessage = vi.fn<(message: unknown) => void>()
  asWorker() { return this as unknown as ServiceWorker }
  changeState(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')) }
}

class RegistrationStub extends EventTarget {
  waiting: ServiceWorker | null = null
  installing: ServiceWorker | null = null
  update = vi.fn(async () => undefined)
  asRegistration() { return this as unknown as ServiceWorkerRegistration }
}

class ContainerStub extends EventTarget {
  controller: ServiceWorker | null = new WorkerStub().asWorker()
  register = vi.fn<(url: string, options: RegistrationOptions) => Promise<ServiceWorkerRegistration>>()
  activate(worker: WorkerStub) { this.controller = worker.asWorker(); this.dispatchEvent(new Event('controllerchange')) }
}

class MediaStub extends EventTarget {
  matches = false
  change(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event('change')) }
}

const disposers: (() => void)[] = []
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); vi.restoreAllMocks() })

function setup(options: { production?: boolean; secure?: boolean; supported?: boolean; online?: boolean; standalone?: boolean; controlled?: boolean; waiting?: boolean } = {}) {
  const events = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  const media = new MediaStub()
  const worker = new WorkerStub()
  const registration = new RegistrationStub()
  const container = new ContainerStub()
  if (options.controlled === false) container.controller = null
  if (options.waiting) registration.waiting = worker.asWorker()
  container.register.mockResolvedValue(registration.asRegistration())
  const navigator = {
    onLine: options.online ?? true, userAgent: 'Chrome', maxTouchPoints: 0, standalone: options.standalone,
    serviceWorker: options.supported === false ? undefined : container as unknown as ServiceWorkerContainer,
  }
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ name: 'Pokéfolio', start_url: '/' }))
  const reload = vi.fn()
  const env: PwaEnvironment = {
    events, document, navigator, fetch, reload, production: options.production ?? true, secure: options.secure ?? true,
    matchMedia: () => media as unknown as MediaQueryList,
  }
  const client = createPwaClient(() => env)
  disposers.push(client.dispose)
  return { client, env, events, document, navigator, media, worker, registration, container, fetch, reload }
}

function nativePrompt(events: EventTarget) {
  const choice = deferred<{ outcome: 'accepted' | 'dismissed' }>()
  const prompt = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
  const event: PwaInstallPrompt = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: choice.promise })
  events.dispatchEvent(event)
  return { event, prompt, choice }
}

// Resolver únicamente microtareas, sin esperas reales ni red.
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('Store PWA y ciclo de vida independiente de React', () => {
  it('captura un prompt antes de suscribir React y no duplica listeners al inicializar dos veces', () => {
    const { client, events, container } = setup()
    const add = vi.spyOn(events, 'addEventListener')
    const firstDispose = client.initialize()
    expect(client.initialize()).toBe(firstDispose)
    const pending = nativePrompt(events)
    expect(pending.event.defaultPrevented).toBe(true)
    expect(pending.prompt).not.toHaveBeenCalled()
    expect(client.getSnapshot().canInstall).toBe(true)
    expect(add.mock.calls.filter(([type]) => type === 'beforeinstallprompt')).toHaveLength(1)
    expect(container.register).toHaveBeenCalledTimes(1)
  })

  it('mantiene snapshots estables, inmutables y una suscripción limpia en StrictMode', () => {
    const { client, events } = setup()
    client.initialize()
    const snapshot = client.getSnapshot()
    const serverSnapshot = client.getServerSnapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    const notify = vi.fn()
    const unsubscribe = client.subscribe(notify)
    unsubscribe()
    const unsubscribeAgain = client.subscribe(notify)
    events.dispatchEvent(new Event('online'))
    expect(client.getSnapshot()).toBe(snapshot)
    expect(notify).not.toHaveBeenCalled()
    events.dispatchEvent(new Event('offline'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot()).not.toBe(snapshot)
    expect(client.getSnapshot()).toBe(client.getSnapshot())
    expect(client.getServerSnapshot()).toBe(serverSnapshot)
    unsubscribeAgain()
    events.dispatchEvent(new Event('online'))
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('limpia listeners de ventana, media, registro y workers al disponer y permite reiniciar', async () => {
    const { client, events, media, registration, worker, container } = setup({ waiting: true })
    const removals = [events, media, registration, worker, container].map((target) => vi.spyOn(target, 'removeEventListener'))
    client.initialize()
    await settle()
    client.dispose()
    removals.forEach((remove) => expect(remove).toHaveBeenCalled())
    events.dispatchEvent(new Event('offline'))
    expect(client.getSnapshot().online).toBe(true)
    client.initialize()
    nativePrompt(events)
    expect(client.getSnapshot().canInstall).toBe(true)
  })

  it('puede importarse e inicializarse sin navegador', () => {
    const client = createPwaClient(() => null)
    expect(() => client.initialize()()).not.toThrow()
    expect(client.getSnapshot().canInstall).toBe(false)
  })
})

describe('Instalación nativa diferida', () => {
  it('invoca prompt dentro del gesto, consume una sola vez y no da accepted por instalada', async () => {
    const { client, events } = setup()
    client.initialize()
    const { prompt, choice } = nativePrompt(events)
    const operation = client.install()
    expect(prompt).toHaveBeenCalledTimes(1) // Antes del primer await del llamador.
    expect(client.getSnapshot().installing).toBe(true)
    expect(client.getSnapshot().canInstall).toBe(false)
    await client.install()
    choice.resolve({ outcome: 'accepted' })
    await operation
    expect(client.getSnapshot().installed).toBe(false)
    expect(client.getSnapshot().installMessage).toContain('confirmará')
    await client.install()
    expect(prompt).toHaveBeenCalledTimes(1)
    events.dispatchEvent(new Event('appinstalled'))
    expect(client.getSnapshot()).toMatchObject({ installed: true, canInstall: false, installing: false })
  })

  it('un rechazo del usuario no bloquea la web ni reutiliza el evento consumido', async () => {
    const { client, events } = setup()
    client.initialize()
    const first = nativePrompt(events)
    first.choice.resolve({ outcome: 'dismissed' })
    await client.install()
    expect(client.getSnapshot()).toMatchObject({ installed: false, canInstall: false, installing: false })
    expect(client.getSnapshot().installMessage).toContain('cancelada')
    const next = nativePrompt(events)
    next.choice.resolve({ outcome: 'accepted' })
    expect(client.getSnapshot().canInstall).toBe(true)
    await client.install()
    expect(next.prompt).toHaveBeenCalledTimes(1)
  })

  it.each(['sync-prompt', 'async-prompt', 'user-choice', 'both'] as const)('atiende los errores %s sin promesas rechazadas pendientes', async (failure) => {
    const { client, events } = setup()
    client.initialize()
    const { prompt, choice } = nativePrompt(events)
    if (failure === 'sync-prompt' || failure === 'both') prompt.mockImplementation(() => { throw new Error('Privado') })
    if (failure === 'async-prompt') prompt.mockRejectedValue(new Error('No disponible'))
    if (failure === 'user-choice' || failure === 'both') choice.reject(new Error('Cancelado'))
    else choice.resolve({ outcome: 'dismissed' })
    await expect(client.install()).resolves.toBeUndefined()
    expect(client.getSnapshot()).toMatchObject({ installed: false, canInstall: false, installing: false })
    expect(client.getSnapshot().installMessage).toContain('No se pudo')
  })

  it('appinstalled durante el prompt prevalece frente a una respuesta nativa tardía', async () => {
    const { client, events } = setup()
    client.initialize()
    const { choice } = nativePrompt(events)
    const operation = client.install()
    events.dispatchEvent(new Event('appinstalled'))
    choice.resolve({ outcome: 'dismissed' })
    await operation
    expect(client.getSnapshot()).toMatchObject({ installed: true, installing: false, installMessage: '' })
  })

  it('preserva un nuevo evento recibido mientras el anterior espera respuesta', async () => {
    const { client, events } = setup()
    client.initialize()
    const first = nativePrompt(events)
    const operation = client.install()
    const second = nativePrompt(events)
    first.choice.resolve({ outcome: 'dismissed' })
    await operation
    expect(client.getSnapshot().canInstall).toBe(true)
    second.choice.resolve({ outcome: 'dismissed' })
    await client.install()
    expect(second.prompt).toHaveBeenCalledTimes(1)
  })

  it('no usa prompt offline, sin evento nativo ni en modo instalado', async () => {
    const { client, events, media } = setup({ online: false })
    client.initialize()
    await client.install()
    const { prompt } = nativePrompt(events)
    await client.install()
    expect(prompt).not.toHaveBeenCalled()
    events.dispatchEvent(new Event('online'))
    media.change(true)
    await client.install()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('ignora respuestas de una instancia dispuesta', async () => {
    const { client, events } = setup()
    client.initialize()
    const { choice } = nativePrompt(events)
    const operation = client.install()
    client.dispose()
    choice.resolve({ outcome: 'accepted' })
    await operation
    expect(client.getSnapshot().installMessage).toBe('')
  })
})

describe('Standalone y ayuda por dispositivo', () => {
  it.each([true, false])('detecta navigator.standalone=%s', (standalone) => {
    const { client } = setup({ standalone })
    client.initialize()
    expect(client.getSnapshot().installed).toBe(standalone)
  })

  it('observa display-mode al inicio y sus cambios, sin deducir instalación por user agent', () => {
    const { client, media } = setup()
    media.matches = true
    client.initialize()
    expect(client.getSnapshot().installed).toBe(true)
    media.change(false)
    expect(client.getSnapshot().installed).toBe(false)
    media.change(true)
    expect(client.getSnapshot().installed).toBe(true)
  })

  it('soporta el listener legacy de Safari y su limpieza', () => {
    const { client, env } = setup()
    const addListener = vi.fn()
    const removeListener = vi.fn()
    env.matchMedia = () => ({ matches: true, addListener, removeListener }) as unknown as MediaQueryList
    client.initialize()
    expect(client.getSnapshot().installed).toBe(true)
    client.dispose()
    expect(removeListener).toHaveBeenCalledWith(addListener.mock.calls[0][0])
  })

  it('sin matchMedia o con error de privacidad conserva la ayuda', () => {
    const { client, env } = setup({ supported: false })
    env.matchMedia = () => { throw new Error('Bloqueado') }
    expect(() => client.initialize()).not.toThrow()
    expect(client.getSnapshot()).toMatchObject({ installed: false, canInstall: false })
    client.dispose()
    env.matchMedia = undefined
    expect(() => client.initialize()).not.toThrow()
  })

  it('revalida navigator.standalone al volver a una pestaña visible', () => {
    const { client, navigator, document } = setup()
    client.initialize()
    navigator.standalone = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(client.getSnapshot().installed).toBe(true)
  })

  it.each([
    { ua: 'Mozilla iPhone Version/18 Safari/604', touch: 5, platform: 'apple', inAppBrowser: false },
    { ua: 'Mozilla iPad Version/18 Safari/604', touch: 5, platform: 'apple', inAppBrowser: false },
    { ua: 'Mozilla Macintosh Version/18 Safari/604', touch: 5, platform: 'apple', inAppBrowser: false },
    { ua: 'Mozilla Macintosh Version/18 Safari/604', touch: 0, platform: 'desktop', inAppBrowser: false },
    { ua: 'Mozilla Android Chrome/140 Safari/537', touch: 5, platform: 'android', inAppBrowser: false },
    { ua: 'Mozilla iPhone AppleWebKit Instagram', touch: 5, platform: 'apple', inAppBrowser: true },
    { ua: 'Mozilla iPad AppleWebKit', touch: 5, platform: 'apple', inAppBrowser: true },
    { ua: 'Mozilla Android; wv) Chrome/140', touch: 5, platform: 'android', inAppBrowser: true },
    { ua: 'Mozilla Windows Chrome/140 Edg/140', touch: 0, platform: 'desktop', inAppBrowser: false },
  ])('orienta $platform con $ua', ({ ua, touch, platform, inAppBrowser }) => {
    expect(getPwaInstallContext(ua, touch)).toEqual({ platform, inAppBrowser })
  })
})

describe('Registro manual del service worker', () => {
  it('registra el contrato exacto una sola vez', async () => {
    const { client, container } = setup()
    client.initialize()
    await settle()
    expect(container.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { type: 'classic', scope: '/', updateViaCache: 'none' })
  })

  it.each([{ production: false }, { secure: false }, { supported: false }])('no registra fuera de las condiciones requeridas: %o', (options) => {
    const { client, container, events } = setup(options)
    client.initialize()
    expect(container.register).not.toHaveBeenCalled()
    nativePrompt(events)
    expect(client.getSnapshot().canInstall).toBe(true)
  })

  it.each(['sync', 'async'])('atiende el fallo %s de registro y conserva la app', async (failure) => {
    const { client, container, events } = setup()
    if (failure === 'sync') container.register.mockImplementation(() => { throw new Error('Privado') })
    else container.register.mockRejectedValue(new Error('Sin permisos'))
    client.initialize()
    await settle()
    expect(client.getSnapshot().serviceWorkerError).toContain('No se pudo activar')
    expect(client.getSnapshot().online).toBe(true)
    nativePrompt(events)
    expect(client.getSnapshot().canInstall).toBe(true)
  })

  it('ignora un registro resuelto después de dispose', async () => {
    const { client, container, registration, worker } = setup({ waiting: true })
    const request = deferred<ServiceWorkerRegistration>()
    container.register.mockReturnValue(request.promise)
    client.initialize()
    client.dispose()
    request.resolve(registration.asRegistration())
    await settle()
    expect(client.getSnapshot().updateAvailable).toBe(false)
    expect(worker.postMessage).not.toHaveBeenCalled()
  })
})

describe('Actualizaciones con consentimiento exclusivo de esta pestaña', () => {
  it('un worker waiting no manda mensajes ni recarga antes de la confirmación', async () => {
    const { client, worker, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    expect(client.getSnapshot().updateAvailable).toBe(true)
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('descubre updatefound/installed sin listeners repetidos', async () => {
    const { client, registration, worker } = setup()
    const listen = vi.spyOn(worker, 'addEventListener')
    client.initialize()
    await settle()
    worker.state = 'installing'
    registration.installing = worker.asWorker()
    registration.dispatchEvent(new Event('updatefound'))
    registration.dispatchEvent(new Event('updatefound'))
    expect(client.getSnapshot().updateAvailable).toBe(false)
    worker.changeState('installed')
    expect(client.getSnapshot().updateAvailable).toBe(true)
    expect(listen).toHaveBeenCalledTimes(1)
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('envía solo SKIP_WAITING tras confirmar y espera el controller elegido para recargar una vez', async () => {
    const { client, worker, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    expect(client.confirmUpdate()).toBe(true)
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' })
    expect(client.confirmUpdate()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    container.activate(new WorkerStub())
    expect(reload).not.toHaveBeenCalled()
    container.activate(worker)
    container.activate(worker)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('una activación iniciada por otra pestaña no recarga esta', async () => {
    const { client, worker, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    worker.changeState('activated')
    container.activate(worker)
    expect(reload).not.toHaveBeenCalled()
    expect(client.getSnapshot().updateAvailable).toBe(false)
  })

  it('el primer install y clients.claim no ofrecen actualización ni recargan', async () => {
    const { client, registration, worker, container, reload } = setup({ controlled: false })
    client.initialize()
    await settle()
    worker.state = 'installing'
    registration.installing = worker.asWorker()
    registration.dispatchEvent(new Event('updatefound'))
    worker.changeState('installed')
    expect(client.getSnapshot().updateAvailable).toBe(false)
    expect(client.confirmUpdate()).toBe(false)
    worker.changeState('activated')
    container.activate(worker)
    expect(reload).not.toHaveBeenCalled()
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('un fallo postMessage revoca el consentimiento y no recarga posteriormente', async () => {
    const { client, worker, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    worker.postMessage.mockImplementation(() => { throw new Error('Worker retirado') })
    expect(client.confirmUpdate()).toBe(false)
    container.activate(worker)
    expect(reload).not.toHaveBeenCalled()
    expect(client.getSnapshot().updating).toBe(false)
    expect(client.getSnapshot().updateMessage).toContain('No se pudo')
  })

  it('limita la espera y permite reintentar mientras el worker sigue esperando', async () => {
    vi.useFakeTimers()
    const { client, worker, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    client.confirmUpdate()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.getSnapshot().updating).toBe(false)
    expect(client.getSnapshot().updateMessage).toContain('no se ha confirmado')
    expect(reload).not.toHaveBeenCalled()
    expect(client.confirmUpdate()).toBe(true)
    worker.changeState('activated')
    container.activate(worker)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('una activación tardía no recarga con un consentimiento vencido', async () => {
    vi.useFakeTimers()
    const { client, worker, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    client.confirmUpdate()
    await vi.advanceTimersByTimeAsync(20_000)
    worker.changeState('activated')
    container.activate(worker)
    expect(reload).not.toHaveBeenCalled()
    expect(client.getSnapshot().updateAvailable).toBe(false)
    expect(client.confirmUpdate()).toBe(false)
  })

  it('un worker redundante retira el aviso y cancela la espera', async () => {
    const { client, worker, registration, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    client.confirmUpdate()
    registration.waiting = null
    worker.changeState('redundant')
    expect(client.getSnapshot()).toMatchObject({ updateAvailable: false, updating: false })
    container.activate(worker)
    expect(reload).not.toHaveBeenCalled()
  })

  it('offline revoca una recarga pendiente y bloquea nuevas peticiones', async () => {
    const { client, worker, events, container, reload } = setup({ waiting: true })
    client.initialize()
    await settle()
    client.confirmUpdate()
    events.dispatchEvent(new Event('offline'))
    expect(client.confirmUpdate()).toBe(false)
    container.activate(worker)
    events.dispatchEvent(new Event('online'))
    container.activate(worker)
    expect(reload).not.toHaveBeenCalled()
  })

  it('recupera un error de reload sin repetirlo en otro controllerchange', async () => {
    const { client, worker, container, reload } = setup({ waiting: true })
    reload.mockImplementation(() => { throw new Error('Bloqueado') })
    client.initialize()
    await settle()
    client.confirmUpdate()
    expect(() => container.activate(worker)).not.toThrow()
    container.activate(worker)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().updateMessage).toContain('manualmente')
  })

  it('comprueba al volver visible/online con límite de frecuencia, sin polling', async () => {
    vi.useFakeTimers()
    const { client, document, registration, events } = setup()
    client.initialize()
    await settle()
    expect(registration.update).not.toHaveBeenCalled()
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).not.toHaveBeenCalled()
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    events.dispatchEvent(new Event('online'))
    await settle()
    expect(registration.update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(registration.update).toHaveBeenCalledTimes(1)
    registration.update.mockRejectedValue(new Error('Red'))
    events.dispatchEvent(new Event('online'))
    await settle()
    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(client.getSnapshot().serviceWorkerError).toContain('comprobar')
    expect(client.getSnapshot().online).toBe(true)
  })
})

describe('Señal offline y comprobación pública acotada', () => {
  it('inicia offline y el evento online reanuda sin fetch, recarga ni operaciones en cola', () => {
    const { client, events, fetch, reload } = setup({ online: false })
    client.initialize()
    expect(client.getSnapshot().online).toBe(false)
    events.dispatchEvent(new Event('online'))
    expect(client.getSnapshot().online).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    events.dispatchEvent(new Event('offline'))
    expect(client.getSnapshot().online).toBe(false)
  })

  it('consulta exclusivamente el manifest sin cache ni credenciales y reanuda con JSON válido', async () => {
    const { client, fetch, navigator, reload } = setup({ online: false })
    client.initialize()
    expect(await client.checkConnection()).toBe(true)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/manifest.webmanifest', {
      cache: 'no-store', signal: expect.any(AbortSignal), credentials: 'omit', mode: 'same-origin', redirect: 'error',
    })
    expect(navigator.onLine).toBe(false) // Una respuesta válida pesa más que esta señal orientativa.
    expect(client.getSnapshot()).toMatchObject({ online: true, checkingConnection: false, connectionMessage: '' })
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'HTTP 503', response: () => new Response('', { status: 503 }) },
    { label: 'HTML fallback 200', response: () => new Response('<!doctype html><html>App</html>') },
    { label: 'JSON ajeno', response: () => Response.json({ name: 'Portal cautivo' }) },
    { label: 'JSON null', response: () => Response.json(null) },
    { label: 'JSON vacío', response: () => Response.json({}) },
  ])('rechaza $label sin ocultar errores ni desbloquear acciones', async ({ response }) => {
    const { client, fetch } = setup({ online: false })
    fetch.mockImplementation(async () => response())
    client.initialize()
    expect(await client.checkConnection()).toBe(false)
    expect(client.getSnapshot()).toMatchObject({ online: false, checkingConnection: false })
    expect(client.getSnapshot().connectionMessage).toContain('Revisa tu red')
  })

  it.each(['sync', 'async'])('atiende un fallo %s de fetch y permite reintentar', async (failure) => {
    const { client, fetch } = setup({ online: false })
    if (failure === 'sync') fetch.mockImplementationOnce(() => { throw new Error('Red') })
    else fetch.mockRejectedValueOnce(new Error('Red'))
    client.initialize()
    expect(await client.checkConnection()).toBe(false)
    expect(client.getSnapshot().online).toBe(false)
    expect(await client.checkConnection()).toBe(true)
  })

  it('evita checks concurrentes y aborta tras 8s incluso si el fetch ignora la señal', async () => {
    vi.useFakeTimers()
    const { client, fetch } = setup({ online: false })
    fetch.mockReturnValue(new Promise(() => {}))
    client.initialize()
    const operation = client.checkConnection()
    expect(client.getSnapshot().checkingConnection).toBe(true)
    expect(await client.checkConnection()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await operation).toBe(false)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(client.getSnapshot()).toMatchObject({ online: false, checkingConnection: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('el timeout cubre también un cuerpo JSON que no termina', async () => {
    vi.useFakeTimers()
    const { client, fetch } = setup({ online: false })
    fetch.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response)
    client.initialize()
    const operation = client.checkConnection()
    await settle()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await operation).toBe(false)
    expect(client.getSnapshot().online).toBe(false)
  })

  it.each(['offline', 'online', 'dispose'])('un evento %s invalida respuestas antiguas y aborta la prueba', async (action) => {
    const { client, events, fetch } = setup({ online: false })
    const response = deferred<Response>()
    fetch.mockReturnValue(response.promise)
    client.initialize()
    const operation = client.checkConnection()
    if (action === 'dispose') client.dispose()
    else events.dispatchEvent(new Event(action))
    response.resolve(Response.json({ name: 'Pokéfolio' }))
    expect(await operation).toBe(false)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(client.getSnapshot()).toMatchObject({ online: action !== 'offline', checkingConnection: false, connectionMessage: '' })
  })
})
