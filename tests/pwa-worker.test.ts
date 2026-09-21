import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const offlineHtml = readFileSync(new URL('../public/pwa/offline.html', import.meta.url), 'utf8')
const origin = 'https://www.pokefoliotcg.es'
const cacheName = 'pokefolio-offline-test-build'
// Contrato independiente del código del worker: añadir un recurso exige cambiar esta lista explícita.
const paths = ['/pwa/offline.html', '/pwa/offline.css', '/pwa/offline.js',
  '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png']
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])

interface Metadata { url: string; type: ResponseType; redirected: boolean }

// Response de Node no permite establecer url/type y clone los pierde; conservarlos simula Fetch del navegador.
function withMetadata(response: Response, metadata: Metadata): Response {
  const clone = response.clone.bind(response)
  Object.defineProperties(response, {
    url: { value: metadata.url }, type: { value: metadata.type }, redirected: { value: metadata.redirected },
    clone: { value: () => withMetadata(clone(), metadata) },
  })
  return response
}

function wireResponse(path: string, body: BodyInit = 'public', contentType = 'text/plain',
  options: Partial<Metadata> & { status?: number } = {}) {
  return withMetadata(new Response(body, { status: options.status ?? 200, headers: { 'content-type': contentType } }), {
    url: options.url ?? `${origin}${path}`, type: options.type ?? 'basic', redirected: options.redirected ?? false,
  })
}

function publicResponse(request: Request) {
  const path = new URL(request.url).pathname
  if (path === '/pwa/offline.html') return wireResponse(path, offlineHtml, 'text/html; charset=utf-8')
  if (path === '/pwa/offline.css') return wireResponse(path, 'body { color: navy; }', 'text/css')
  if (path === '/pwa/offline.js') return wireResponse(path, '/* public */', 'text/javascript')
  if (paths.includes(path)) return wireResponse(path, png, 'image/png')
  throw new Error('Unexpected network request in test')
}

function request(path: string, init: RequestInit = {}, navigation = false) {
  const result = new Request(new URL(path, origin), init)
  if (navigation) Object.defineProperty(result, 'mode', { value: 'navigate' })
  return result
}

function key(input: Request | string) { return typeof input === 'string' ? input : input.url }

class MemoryCache {
  readonly entries = new Map<string, Response>()
  readonly storedRequests: Request[] = []
  failPutAt = 0
  match = vi.fn(async (input: Request | string) => this.entries.get(key(input))?.clone())
  put = vi.fn(async (input: Request, response: Response) => {
    if (this.failPutAt && this.put.mock.calls.length === this.failPutAt) throw new Error('Quota exceeded')
    this.storedRequests.push(input.clone())
    this.entries.set(key(input), response.clone())
  })
}

interface WindowClient { id: string; url: string; type: string }

function worker(options: { version?: string; scope?: string; failPutAt?: number } = {}) {
  const listeners = new Map<string, (event: unknown) => void>()
  const stores = new Map<string, MemoryCache>()
  const clients = new Map<string, WindowClient>()
  const caches = {
    keys: vi.fn(async () => [...stores.keys()]),
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) {
        const cache = new MemoryCache()
        cache.failPutAt = options.failPutAt ?? 0
        stores.set(name, cache)
      }
      return stores.get(name)!
    }),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  }
  const fetch = vi.fn(async (input: Request) => publicResponse(input))
  const self = {
    location: { origin }, registration: { scope: options.scope ?? `${origin}/` },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    clients: { claim: vi.fn(async () => {}), get: vi.fn(async (id: string) => clients.get(id)) },
    skipWaiting: vi.fn(async () => {}),
  }
  const forbidden = vi.fn(() => { throw new Error('Private API must not be accessed') })
  const context = { self, caches, fetch, Request, Response, URL, Uint8Array, console: { log: forbidden, error: forbidden, warn: forbidden } }
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(context, name, { get: forbidden })
  runInNewContext(source.replace('__POKEFOLIO_BUILD__', options.version ?? 'test-build'), context)

  async function lifecycle(type: 'install' | 'activate') {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    listeners.get(type)!({ waitUntil })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]
  }
  function dispatchFetch(input: Request) {
    const respondWith = vi.fn<(promise: Promise<Response>) => void>()
    listeners.get('fetch')!({ request: input, respondWith })
    return { respondWith, response: respondWith.mock.calls[0]?.[0] }
  }
  async function message(event: { data?: unknown; source?: unknown; origin?: string }) {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    listeners.get('message')!({ ...event, waitUntil })
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise))
    return waitUntil
  }
  return { stores, caches, clients, fetch, self, forbidden, listeners, lifecycle, dispatchFetch, message }
}

describe('worker: instalación pública y transaccional', () => {
  it('usa un token literal de versión y funciona como script clásico sin imports', () => {
    expect(source).toContain("const VERSION = '__POKEFOLIO_BUILD__'")
    const first = worker()
    expect([...first.listeners.keys()]).toEqual(['install', 'activate', 'fetch', 'message'])
    expect(first.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('precachea exclusivamente seis rutas públicas, sin credenciales, redirects ni HTTP cache anterior', async () => {
    const w = worker()
    await w.lifecycle('install')
    expect([...w.stores.keys()]).toEqual([cacheName])
    const cache = w.stores.get(cacheName)!
    expect([...cache.entries.keys()]).toEqual(paths.map((path) => `${origin}${path}`))
    expect(w.fetch).toHaveBeenCalledTimes(6)
    for (const req of [...w.fetch.mock.calls.map(([input]) => input), ...cache.storedRequests]) {
      expect(req.method).toBe('GET')
      expect(req.credentials).toBe('omit')
      expect(req.cache).toBe('reload')
      expect(req.redirect).toBe('error')
      expect(req.mode).toBe('same-origin')
      expect([...req.headers]).toEqual([])
      expect(new URL(req.url).search).toBe('')
    }
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
    expect(w.self.clients.claim).not.toHaveBeenCalled()
    expect(w.forbidden).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'rechazo de red', bad: () => Promise.reject(new Error('Offline')) },
    { label: 'HTTP 401', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { status: 401 }) },
    { label: 'HTTP 404', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { status: 404 }) },
    { label: 'HTTP 500', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { status: 500 }) },
    { label: 'HTTP 206', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { status: 206 }) },
    { label: 'MIME incorrecto', bad: () => wireResponse(paths[0]!, offlineHtml, 'application/json') },
    { label: 'fallback index con 200', bad: () => wireResponse(paths[0]!, '<html><div id="root">personal</div></html>', 'text/html') },
    { label: 'otro origen', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { url: 'https://evil.test/pwa/offline.html' }) },
    { label: 'otra ruta', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { url: `${origin}/index.html` }) },
    { label: 'query inesperada', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { url: `${origin}${paths[0]}?token=secret` }) },
    { label: 'redirect seguido', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { redirected: true }) },
    { label: 'respuesta opaque', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { type: 'opaque' }) },
    { label: 'respuesta opaqueredirect', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { type: 'opaqueredirect' }) },
    { label: 'respuesta CORS', bad: () => wireResponse(paths[0]!, offlineHtml, 'text/html', { type: 'cors' }) },
  ])('rechaza $label sin tocar cachés existentes', async ({ bad }) => {
    const w = worker()
    const old = new MemoryCache()
    old.entries.set(`${origin}/pwa/offline.html`, wireResponse(paths[0]!, 'old public', 'text/html'))
    w.stores.set('pokefolio-offline-old', old)
    w.stores.set('other-app-cache', new MemoryCache())
    w.fetch.mockImplementationOnce(async () => bad())
    await expect(w.lifecycle('install')).rejects.toThrow()
    expect([...w.stores.keys()]).toEqual(['pokefolio-offline-old', 'other-app-cache'])
    expect(await old.entries.get(`${origin}/pwa/offline.html`)!.clone().text()).toBe('old public')
    expect(w.caches.delete).not.toHaveBeenCalled()
    expect(w.forbidden).not.toHaveBeenCalled()
  })

  it.each(['/pwa/offline.css', '/pwa/offline.js', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png'])(
    'rechaza fallback HTML en %s aunque el servidor lo etiquete incorrectamente', async (path) => {
      const w = worker()
      w.fetch.mockImplementation(async (input) => new URL(input.url).pathname === path
        ? wireResponse(path, '<html>index</html>', path.endsWith('.png') ? 'image/png' : 'text/html')
        : publicResponse(input))
      await expect(w.lifecycle('install')).rejects.toThrow()
      expect(w.stores.size).toBe(0)
    })

  it('elimina una caché nueva parcial si put falla y conserva la activa anterior y las ajenas', async () => {
    const w = worker({ failPutAt: 3 })
    const old = new MemoryCache()
    const foreign = new MemoryCache()
    w.stores.set('pokefolio-offline-active', old)
    w.stores.set('private-unrelated', foreign)
    await expect(w.lifecycle('install')).rejects.toThrow()
    expect([...w.stores.keys()]).toEqual(['pokefolio-offline-active', 'private-unrelated'])
    expect(w.stores.get('pokefolio-offline-active')).toBe(old)
    expect(w.stores.get('private-unrelated')).toBe(foreign)
    expect(w.caches.delete.mock.calls).toEqual([[cacheName]])
  })

  it('valida todos los recursos antes del primer put aunque falle el último', async () => {
    const w = worker()
    w.fetch.mockImplementation(async (input) => {
      if (input.url.endsWith('apple-touch-icon.png')) throw new Error('Offline')
      return publicResponse(input)
    })
    await expect(w.lifecycle('install')).rejects.toThrow()
    expect(w.fetch).toHaveBeenCalledTimes(6)
    expect(w.caches.open).not.toHaveBeenCalled()
  })

  it('una reinstalación del mismo hash reutiliza sin escribir ni borrar la caché completa', async () => {
    const w = worker()
    await w.lifecycle('install')
    const existing = w.stores.get(cacheName)!
    existing.put.mockClear()
    await w.lifecycle('install')
    expect(existing.put).not.toHaveBeenCalled()
    expect(w.caches.delete).not.toHaveBeenCalled()
  })

  it('ni un fallo de red ni una caché incompleta permiten modificar la caché de la misma versión', async () => {
    const w = worker()
    const existing = new MemoryCache()
    w.stores.set(cacheName, existing)
    w.fetch.mockRejectedValueOnce(new Error('Offline'))
    await expect(w.lifecycle('install')).rejects.toThrow()
    await expect(w.lifecycle('install')).rejects.toThrow()
    expect(w.stores.get(cacheName)).toBe(existing)
    expect(existing.put).not.toHaveBeenCalled()
    expect(w.caches.delete).not.toHaveBeenCalled()
  })

  it('otro build utiliza otra caché', async () => {
    const w = worker({ version: 'next-hash' })
    await w.lifecycle('install')
    expect([...w.stores.keys()]).toEqual(['pokefolio-offline-next-hash'])
  })
})

describe('worker: passthrough sin respondWith para solicitudes no elegibles', () => {
  const unsafePaths = [
    '/manifest.webmanifest', '/manifest.webmanifest?health=1', '/index.html', '/sw.js', '/pokefolio.svg',
    '/api/cards', '/api/price-alerts', '/api/account', '/events', '/auth', '/auth/callback', '/oauth/callback',
    '/rest/v1/wishlist_items', '/storage/v1/object/private', '/unknown', '/catalogo/unknown', '/catalogo//',
    '/CATALOGO', '/pwa/other.js', '/pwa/offline.html/extra', '/pwa/offline.html/', '/pwa/%6fffline.html',
    `${origin}//`, '/?', '/pwa/offline.html?', '/catalogo#access_token=secret', '/pwa/offline.html#',
    '/?code=oauth-code', '/?access_token=secret', '/?refresh_token=secret', '/?error=access_denied',
    '/catalogo?state=secret', '/coleccion?token=secret', '/deseos?search=private', '/contacto?anything=1',
    '/privacidad?anything=1', '/pwa/offline.html?token=secret', '/pwa/offline.css?v=1', '/pwa/offline.js?v=1',
    '/pwa/icon-192.png?v=1', '/pwa/icon-512.png?v=1', '/pwa/apple-touch-icon.png?v=1',
    'https://project.supabase.co/auth/v1/token', 'https://project.supabase.co/rest/v1/cards',
    'https://accounts.google.com/o/oauth2/auth', 'https://api.tcgdex.net/v2/en/cards',
    'https://assets.tcgdex.net/en/swsh/swsh3/136/high.webp', 'https://evil.test/pwa/offline.html',
    'https://evil.test/catalogo', 'http://www.pokefoliotcg.es/catalogo', 'https://www.pokefoliotcg.es:444/catalogo',
  ]
  it.each(unsafePaths)('no intercepta %s ni consulta caches/red', (path) => {
    const w = worker()
    for (const navigation of [false, true]) expect(w.dispatchFetch(request(path, {}, navigation)).respondWith).not.toHaveBeenCalled()
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.caches.open).not.toHaveBeenCalled()
    expect(w.forbidden).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('no intercepta %s ni en las rutas permitidas', (method) => {
    const w = worker()
    for (const path of [...paths, '/catalogo', '/api/events', '/oauth/callback']) {
      expect(w.dispatchFetch(request(path, { method }, true)).respondWith).not.toHaveBeenCalled()
    }
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.caches.open).not.toHaveBeenCalled()
  })

  it.each(['Authorization', 'Cookie', 'Proxy-Authorization', 'Range'])('no intercepta solicitudes con cabecera %s (incluida vacía)', (header) => {
    const w = worker()
    for (const path of [...paths, '/', '/coleccion', '/deseos']) {
      for (const value of ['', 'private-token']) {
        expect(w.dispatchFetch(request(path, { headers: { [header]: value } }, true)).respondWith).not.toHaveBeenCalled()
      }
    }
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.caches.open).not.toHaveBeenCalled()
  })

  it('no intercepta fetch de HTML de aplicación aunque la ruta sea conocida', () => {
    const w = worker()
    for (const path of ['/', '/catalogo', '/coleccion', '/deseos', '/contacto', '/privacidad']) {
      expect(w.dispatchFetch(request(path)).respondWith).not.toHaveBeenCalled()
    }
  })
})

describe('worker: navegación network-first, nunca almacenamiento de HTML de aplicación', () => {
  it.each(['/', '/catalogo', '/catalogo/', '/coleccion', '/coleccion/', '/deseos', '/deseos/', '/contacto', '/contacto/', '/privacidad', '/privacidad/'])(
    'ofrece la misma pantalla pública offline en %s solo si la red rechaza', async (path) => {
      const w = worker()
      await w.lifecycle('install')
      const cache = w.stores.get(cacheName)!
      cache.put.mockClear()
      w.fetch.mockRejectedValue(new Error('Network failed with private details'))
      const input = request(path, { credentials: 'include' }, true)
      const result = await w.dispatchFetch(input).response
      expect(w.fetch).toHaveBeenLastCalledWith(input)
      expect(result?.status).toBe(200)
      expect(await result?.text()).toBe(offlineHtml)
      expect(cache.put).not.toHaveBeenCalled()
      expect([...cache.entries.keys()]).toEqual(paths.map((p) => `${origin}${p}`))
      expect(w.forbidden).not.toHaveBeenCalled()
    })

  it.each([200, 401, 403, 404, 500, 503])('devuelve HTTP %s intacto, sin fallback ni escrituras', async (status) => {
    const w = worker()
    await w.lifecycle('install')
    w.caches.open.mockClear()
    const response = wireResponse('/coleccion', 'private-account-secret', 'text/html', { status })
    w.fetch.mockResolvedValue(response)
    const result = await w.dispatchFetch(request('/coleccion', {}, true)).response
    expect(result).toBe(response)
    expect(await result?.text()).toBe('private-account-secret')
    expect(w.caches.open).not.toHaveBeenCalled()
    expect(w.stores.get(cacheName)!.put).toHaveBeenCalledTimes(6)
    for (const value of w.stores.get(cacheName)!.entries.values()) {
      expect(await value.clone().text()).not.toContain('private-account-secret')
    }
  })

  it('no enmascara una redirección manual opaca', async () => {
    const w = worker()
    const opaque = withMetadata(Response.error(), { url: '', type: 'opaqueredirect', redirected: false })
    w.fetch.mockResolvedValue(opaque)
    expect(await w.dispatchFetch(request('/catalogo/', {}, true)).response).toBe(opaque)
    expect(w.caches.open).not.toHaveBeenCalled()
  })

  it('no enmascara una redirección normal ni modifica la Request original', async () => {
    const w = worker()
    const response = wireResponse('/catalogo', 'redirect', 'text/html', { status: 308 })
    w.fetch.mockResolvedValue(response)
    const input = request('/catalogo/', { redirect: 'manual', credentials: 'include' }, true)
    expect(await w.dispatchFetch(input).response).toBe(response)
    expect(w.fetch).toHaveBeenCalledWith(input)
  })

  it('fallo de red sin fallback disponible conserva un error de red, nunca usa caches ajenas', async () => {
    const w = worker()
    const foreign = new MemoryCache()
    foreign.entries.set(`${origin}/pwa/offline.html`, wireResponse(paths[0]!, 'private data'))
    w.stores.set('foreign', foreign)
    w.fetch.mockRejectedValue(new Error('Offline'))
    expect((await w.dispatchFetch(request('/deseos', {}, true)).response)?.type).toBe('error')
    expect(foreign.match).not.toHaveBeenCalled()
  })

  it('un fallo de CacheStorage no revela errores internos', async () => {
    const w = worker()
    w.fetch.mockRejectedValue(new Error('Offline'))
    w.caches.open.mockRejectedValue(new Error('Private details'))
    expect((await w.dispatchFetch(request('/coleccion', {}, true)).response)?.type).toBe('error')
    expect(w.forbidden).not.toHaveBeenCalled()
  })
})

describe('worker: estáticos públicos sin escritura runtime', () => {
  it.each(paths)('sirve %s desde la caché propia sin red', async (path) => {
    const w = worker()
    await w.lifecycle('install')
    w.fetch.mockClear()
    const result = await w.dispatchFetch(request(path)).response
    expect(result?.status).toBe(200)
    expect(result?.url).toBe(`${origin}${path}`)
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.stores.get(cacheName)!.put).toHaveBeenCalledTimes(6)
  })

  it('un miss solicita el recurso sin cookies implícitas ni cabeceras del cliente y no lo guarda', async () => {
    const w = worker()
    const input = request('/pwa/offline.css', { credentials: 'include', headers: { 'x-private-user': 'secret' } })
    expect((await w.dispatchFetch(input).response)?.status).toBe(200)
    const fetched = w.fetch.mock.calls[0]![0]
    expect(fetched.credentials).toBe('omit')
    expect([...fetched.headers]).toEqual([])
    expect(fetched.redirect).toBe('error')
    expect(w.stores.get(cacheName)!.entries.size).toBe(0)
  })

  it('cache averiada permite red pública sin persistir ni imprimir el error', async () => {
    const w = worker()
    w.caches.open.mockRejectedValue(new Error('Unavailable'))
    expect((await w.dispatchFetch(request('/pwa/offline.js')).response)?.status).toBe(200)
    expect(w.stores.size).toBe(0)
    expect(w.forbidden).not.toHaveBeenCalled()
  })
})

describe('worker: activación explícita y limpieza acotada', () => {
  it('activate elimina SOLO versiones antiguas del prefijo propio antes de clients.claim', async () => {
    const w = worker()
    await w.lifecycle('install')
    for (const name of ['pokefolio-offline-old', 'pokefolio-offline-older', 'other-app', 'pokefolio-online-v1', 'x-pokefolio-offline-old']) {
      w.stores.set(name, new MemoryCache())
    }
    await w.lifecycle('activate')
    expect([...w.stores.keys()]).toEqual([cacheName, 'other-app', 'pokefolio-online-v1', 'x-pokefolio-offline-old'])
    expect(w.caches.delete.mock.calls).toEqual([['pokefolio-offline-old'], ['pokefolio-offline-older']])
    expect(w.self.clients.claim).toHaveBeenCalledTimes(1)
    expect(w.self.clients.claim.mock.invocationCallOrder[0]).toBeGreaterThan(w.caches.delete.mock.invocationCallOrder[1]!)
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
    expect(w.forbidden).not.toHaveBeenCalled()
  })

  const client = { id: 'window-1', type: 'window', url: `${origin}/catalogo` }

  it('solo acepta SKIP_WAITING del WindowClient real del mismo origen y scope mediante waitUntil', async () => {
    const w = worker()
    w.clients.set(client.id, client)
    const waitUntil = await w.message({ origin, source: client, data: { type: 'SKIP_WAITING' } })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(w.self.clients.get).toHaveBeenCalledWith(client.id)
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1)
    expect(w.self.clients.claim).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'tipo desconocido', event: { origin, source: client, data: { type: 'UPDATE' } } },
    { label: 'sin data', event: { origin, source: client } },
    { label: 'sin source', event: { origin, data: { type: 'SKIP_WAITING' } } },
    { label: 'origen externo', event: { origin: 'https://evil.test', source: client, data: { type: 'SKIP_WAITING' } } },
    { label: 'origen vacío', event: { origin: '', source: client, data: { type: 'SKIP_WAITING' } } },
    { label: 'source externo', event: { origin, source: { ...client, url: 'https://evil.test/catalogo' }, data: { type: 'SKIP_WAITING' } } },
    { label: 'puerto distinto', event: { origin, source: { ...client, url: 'https://www.pokefoliotcg.es:444/catalogo' }, data: { type: 'SKIP_WAITING' } } },
    { label: 'URL inválida', event: { origin, source: { ...client, url: 'invalid' }, data: { type: 'SKIP_WAITING' } } },
    { label: 'worker', event: { origin, source: { ...client, type: 'worker' }, data: { type: 'SKIP_WAITING' } } },
    { label: 'MessagePort', event: { origin, source: {}, data: { type: 'SKIP_WAITING' } } },
    { label: 'id vacío', event: { origin, source: { ...client, id: '' }, data: { type: 'SKIP_WAITING' } } },
  ])('ignora mensaje $label sin prolongar el evento', async ({ event }) => {
    const w = worker()
    w.clients.set(client.id, client)
    expect(await w.message(event)).not.toHaveBeenCalled()
    expect(w.self.clients.get).not.toHaveBeenCalled()
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
  })

  it.each([
    undefined, { ...client, id: 'other' }, { ...client, type: 'worker' },
    { ...client, url: 'https://evil.test/' }, { ...client, url: `${origin}/deseos` },
  ])('revalida el cliente vivo y rechaza inexistentes/cambiados: %j', async (live) => {
    const w = worker()
    if (live) w.clients.set(client.id, live)
    expect(await w.message({ origin, source: client, data: { type: 'SKIP_WAITING' } })).toHaveBeenCalledTimes(1)
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('rechaza un WindowClient fuera del scope', async () => {
    const w = worker({ scope: `${origin}/app/` })
    w.clients.set(client.id, client)
    expect(await w.message({ origin, source: client, data: { type: 'SKIP_WAITING' } })).not.toHaveBeenCalled()
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('absorbe la desaparición del cliente sin logs ni mensajes a otras pestañas', async () => {
    const w = worker()
    w.self.clients.get.mockRejectedValue(new Error('Client gone'))
    await w.message({ origin, source: client, data: { type: 'SKIP_WAITING' } })
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
    expect(w.forbidden).not.toHaveBeenCalled()
    expect([...w.listeners.keys()]).not.toContain('sync')
    expect([...w.listeners.keys()]).not.toContain('push')
    expect(source).not.toMatch(/\.navigate\(|\.postMessage\(|matchAll\(/)
  })
})
