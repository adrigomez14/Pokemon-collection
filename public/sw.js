/* Worker clásico: solo recursos públicos de la pantalla offline, nunca datos de la aplicación. */
const VERSION = '__POKEFOLIO_BUILD__'
const CACHE_PREFIX = 'pokefolio-offline-'
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`
const OFFLINE_PATH = '/pwa/offline.html'
const STATIC_TYPES = new Map([
  [OFFLINE_PATH, ['text/html']],
  ['/pwa/offline.css', ['text/css']],
  ['/pwa/offline.js', ['text/javascript', 'application/javascript']],
  ['/pwa/icon-192.png', ['image/png']],
  ['/pwa/icon-512.png', ['image/png']],
  ['/pwa/apple-touch-icon.png', ['image/png']],
])
const NAVIGATION_PATHS = new Set(['/', '/catalogo', '/coleccion', '/deseos', '/contacto', '/privacidad']
  .flatMap((path) => path === '/' ? [path] : [path, `${path}/`]))

function publicRequest(path) {
  return new Request(new URL(path, self.location.origin).href, {
    credentials: 'omit', cache: 'reload', redirect: 'error', mode: 'same-origin',
  })
}

async function validStaticResponse(path, response) {
  if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected
    || response.url !== new URL(path, self.location.origin).href) return false
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!STATIC_TYPES.get(path)?.includes(contentType)) return false
  // Un rewrite SPA puede devolver index.html con 200 y text/html: no basta comprobar el MIME.
  if (path === OFFLINE_PATH) {
    return (await response.clone().text()).includes('<meta name="pokefolio-offline" content="public-static-v1">')
  }
  if (contentType === 'image/png') {
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  }
  return true
}

async function installOfflineResources() {
  // Descargar y validar todo antes de escribir. Secuencial: no quedan put pendientes tras un rollback.
  const resources = []
  for (const path of STATIC_TYPES.keys()) {
    const request = publicRequest(path)
    const response = await fetch(request)
    if (!await validStaticResponse(path, response)) throw new Error('Recurso público offline no válido')
    resources.push({ path, request, response })
  }
  // Una reinstalación de la misma versión nunca debe borrar o alterar una caché ya activa.
  if ((await caches.keys()).includes(CACHE_NAME)) {
    const existing = await caches.open(CACHE_NAME)
    for (const { path, request } of resources) {
      if (!await validStaticResponse(path, await existing.match(request))) {
        throw new Error('La caché offline existente no está completa')
      }
    }
    return
  }
  try {
    const cache = await caches.open(CACHE_NAME)
    for (const { request, response } of resources) await cache.put(request, response)
  } catch {
    await caches.delete(CACHE_NAME)
    throw new Error('No se pudo preparar la caché offline')
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(installOfflineResources())
  // Sin skipWaiting automático: una actualización requiere confirmación en la UI.
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

async function offlineNavigation(request) {
  try {
    // No guardar HTML, no transformar estados HTTP ni respuestas opacas de redirecciones.
    return await fetch(request)
  } catch {
    try {
      const cache = await caches.open(CACHE_NAME)
      return await cache.match(new URL(OFFLINE_PATH, self.location.origin).href) || Response.error()
    } catch {
      return Response.error()
    }
  }
}

async function publicStatic(path) {
  const request = publicRequest(path)
  try {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
  } catch { /* Una caché no disponible no impide solicitar el recurso público. */ }
  // No hay escrituras en runtime, ni siquiera cuando falta un recurso estático.
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.headers.has('authorization') || request.headers.has('cookie')
    || request.headers.has('proxy-authorization') || request.headers.has('range')) return
  const url = new URL(request.url)
  // También dejar pasar delimitadores vacíos «?»/«#», sin normalizar URLs del cliente.
  if (url.origin !== self.location.origin || url.href.includes('?') || url.href.includes('#')
    || url.username || url.password) return
  if (STATIC_TYPES.has(url.pathname)) {
    event.respondWith(publicStatic(url.pathname))
    return
  }
  // Solo un slash final opcional: las rutas desconocidas conservan sus errores/redirecciones originales.
  if (request.mode === 'navigate' && NAVIGATION_PATHS.has(url.pathname)) {
    event.respondWith(offlineNavigation(request))
  }
})

function trustedWindowClient(client) {
  if (!client || client.type !== 'window' || typeof client.id !== 'string' || !client.id) return false
  try {
    const url = new URL(client.url)
    const scope = new URL(self.registration.scope)
    return url.origin === self.location.origin && scope.origin === url.origin
      && !url.username && !url.password && url.pathname.startsWith(scope.pathname)
  } catch {
    return false
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SKIP_WAITING' || event.origin !== self.location.origin
    || !trustedWindowClient(event.source)) return
  event.waitUntil((async () => {
    try {
      const client = await self.clients.get(event.source.id)
      if (trustedWindowClient(client) && client.id === event.source.id && client.url === event.source.url) {
        await self.skipWaiting()
      }
    } catch { /* Un cliente desaparecido o una activación fallida no altera otras pestañas. */ }
  })())
})
