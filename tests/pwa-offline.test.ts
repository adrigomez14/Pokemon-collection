import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync(new URL('../public/pwa/offline.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/pwa/offline.css', import.meta.url), 'utf8')
const script = readFileSync(new URL('../public/pwa/offline.js', import.meta.url), 'utf8')

function page() {
  const buttonListeners = new Map<string, () => void>()
  const windowListeners = new Map<string, () => void>()
  const attributes = new Map<string, string>()
  const retry = {
    disabled: false,
    setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
    removeAttribute: vi.fn((name: string) => attributes.delete(name)),
    addEventListener: (name: string, listener: () => void) => buttonListeners.set(name, listener),
  }
  const status = { textContent: 'Initial message' }
  const replace = vi.fn<(path: string) => void>()
  const forbidden = vi.fn(() => { throw new Error('Must not read private state or navigation URL') })
  const location = { replace }
  for (const name of ['href', 'search', 'hash', 'pathname', 'origin', 'reload', 'assign']) {
    Object.defineProperty(location, name, { get: forbidden })
  }
  const window = { location, addEventListener: (name: string, listener: () => void) => windowListeners.set(name, listener) }
  const document = { getElementById: (id: string) => id === 'retry' ? retry : id === 'connection-status' ? status : null }
  const fetch = vi.fn<(path: string, options: RequestInit) => Promise<Response>>()
  fetch.mockResolvedValue(Response.json({ name: 'Pokéfolio' }))
  const context = { window, document, fetch, AbortController, setTimeout, clearTimeout, console: { log: forbidden, error: forbidden, warn: forbidden } }
  for (const target of [context, window, document]) {
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'cookie']) {
      Object.defineProperty(target, name, { get: forbidden })
    }
  }
  runInNewContext(script, context)
  return { retry, status, attributes, fetch, replace, forbidden,
    click: () => buttonListeners.get('click')!(), online: () => windowListeners.get('online')!() }
}

async function flush() {
  // Vaciar microtareas de Fetch, Response.json, Promise.race y finally sin red ni temporizadores reales.
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

afterEach(() => { vi.useRealTimers() })

describe('pantalla offline: contenido público, CSP y accesibilidad', () => {
  it('HTML español estático sin inline script/style, CDN, formulario ni datos personales', () => {
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('<meta name="pokefolio-offline" content="public-static-v1">')
    expect(html).toContain('Pokéfolio')
    expect(html).toContain('no muestra ni guarda datos')
    expect(html).toContain('No se guardan acciones para enviarlas más tarde')
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('aria-labelledby="offline-title"')
    expect(html).toContain('id="offline-title"')
    expect(html).toContain('aria-describedby="connection-status"')
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"')
    expect(html).toMatch(/<button id="retry" type="button"[^>]*>Reintentar<\/button>/)
    expect(html).toContain('<noscript>')
    expect(html).not.toMatch(/<style\b|\sstyle=|\son\w+=|<form\b|<iframe\b|https?:\/\//i)
    expect([...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attributes, body]) => ({ attributes, body })))
      .toEqual([{ attributes: ' src="/pwa/offline.js" defer', body: '' }])
    expect([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(['/pwa/offline.css', '/pwa/offline.js'])
  })

  it('CSP restringida al origen y declarada antes de cargar los recursos', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]
    expect(csp).toBe("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'")
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<link'))
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'))
  })

  it('estilos locales, safe-area, standalone, foco visible y sin animaciones o fuentes externas', () => {
    expect(css).toContain('#101b35')
    expect(css).toContain('#ff6578')
    expect(css).toContain('#ffda69')
    for (const edge of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`env(safe-area-inset-${edge})`)
    expect(css).toContain('display-mode: standalone')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('forced-colors: active')
    expect(css).toContain('min-height: 48px')
    expect(css).not.toMatch(/@import|@font-face|url\(|animation\s*:|transition\s*:/i)
    expect(script).not.toMatch(/innerHTML|document\.write|sendBeacon|localStorage|sessionStorage|indexedDB|navigator\.|location\.(href|search|hash)/)
  })
})

describe('pantalla offline: comprobación real de conexión sin datos privados', () => {
  it('no consulta nada al cargar ni lee estado privado, URL o navigator.onLine', () => {
    const p = page()
    expect(p.fetch).not.toHaveBeenCalled()
    expect(p.forbidden).not.toHaveBeenCalled()
    expect(p.replace).not.toHaveBeenCalled()
  })

  it.each([{ name: 'Pokéfolio' }, { short_name: 'Pokéfolio' }, { name: 'Otro nombre', short_name: 'Pokéfolio' }])(
    'Reintentar valida %j y reemplaza únicamente por /catalogo', async (manifest) => {
      const p = page()
      p.fetch.mockResolvedValue(Response.json(manifest))
      p.click()
      expect(p.retry.disabled).toBe(true)
      expect(p.attributes.get('aria-busy')).toBe('true')
      expect(p.status.textContent).toBe('Comprobando la conexión…')
      await flush()
      expect(p.fetch).toHaveBeenCalledTimes(1)
      expect(p.fetch).toHaveBeenCalledWith('/manifest.webmanifest', {
        cache: 'no-store', credentials: 'omit', redirect: 'error', mode: 'same-origin', signal: expect.any(AbortSignal),
      })
      expect(p.replace.mock.calls).toEqual([['/catalogo']])
      expect(p.retry.disabled).toBe(false)
      expect(p.attributes.has('aria-busy')).toBe(false)
      expect(p.forbidden).not.toHaveBeenCalled()
    })

  it.each([
    { label: 'offline', response: () => Promise.reject(new Error('private network details')) },
    { label: '500', response: () => Response.json({ name: 'Pokéfolio' }, { status: 500 }) },
    { label: '401', response: () => Response.json({ name: 'Pokéfolio' }, { status: 401 }) },
    { label: '404', response: () => Response.json({ name: 'Pokéfolio' }, { status: 404 }) },
    { label: 'HTML cautivo', response: () => new Response('<html>Sign in to wifi</html>') },
    { label: 'nombre distinto', response: () => Response.json({ name: 'Evil', short_name: 'Evil' }) },
    { label: 'sin nombre', response: () => Response.json({ start_url: '/catalogo' }) },
    { label: 'null', response: () => Response.json(null) },
    { label: 'array', response: () => Response.json(['Pokéfolio']) },
    { label: 'string', response: () => Response.json('Pokéfolio') },
    { label: 'opaque', response: () => Response.error() },
    { label: 'redirect seguido', response: () => {
      const response = Response.json({ name: 'Pokéfolio' })
      Object.defineProperty(response, 'redirected', { value: true })
      return response
    } },
  ])('mantiene pantalla y ayuda accesible con $label', async ({ response }) => {
    const p = page()
    p.fetch.mockImplementation(async () => response())
    p.click()
    await flush()
    expect(p.replace).not.toHaveBeenCalled()
    expect(p.status.textContent).toContain('No se pudo comprobar la conexión')
    expect(p.status.textContent).not.toContain('private network details')
    expect(p.retry.disabled).toBe(false)
    expect(p.attributes.has('aria-busy')).toBe(false)
    expect(p.forbidden).not.toHaveBeenCalled()
  })

  it('online no declara éxito sin verificar la red, evita duplicados y permite reintentar tras un error', async () => {
    const p = page()
    let finish!: (response: Response) => void
    p.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    p.online()
    p.online()
    p.click()
    expect(p.fetch).toHaveBeenCalledTimes(1)
    expect(p.replace).not.toHaveBeenCalled()
    expect(p.status.textContent).toBe('Comprobando la conexión…')
    finish(new Response('failed', { status: 503 }))
    await flush()
    expect(p.replace).not.toHaveBeenCalled()
    p.click()
    await flush()
    expect(p.fetch).toHaveBeenCalledTimes(2)
    expect(p.replace.mock.calls).toEqual([['/catalogo']])
  })

  it.each(['fetch', 'json'])('cancela a los ocho segundos incluso con %s pendiente y no navega con respuestas tardías', async (phase) => {
    vi.useFakeTimers()
    const p = page()
    let finish!: () => void
    if (phase === 'fetch') {
      p.fetch.mockImplementationOnce(() => new Promise((resolve) => {
        finish = () => resolve(Response.json({ name: 'Pokéfolio' }))
      }))
    } else {
      const response = Response.json({ name: 'Pokéfolio' })
      response.json = () => new Promise((resolve) => { finish = () => resolve({ name: 'Pokéfolio' }) })
      p.fetch.mockResolvedValueOnce(response)
    }
    p.click()
    await flush()
    const signal = p.fetch.mock.calls[0]![1].signal!
    await vi.advanceTimersByTimeAsync(7_999)
    expect(signal.aborted).toBe(false)
    expect(p.retry.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal.aborted).toBe(true)
    expect(p.retry.disabled).toBe(false)
    expect(p.status.textContent).toContain('No se pudo comprobar')
    finish()
    await flush()
    expect(p.replace).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    p.click()
    await flush()
    expect(p.replace.mock.calls).toEqual([['/catalogo']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('limpia el temporizador tras éxito y tras fallo', async () => {
    vi.useFakeTimers()
    const p = page()
    p.fetch.mockRejectedValueOnce(new Error('Offline'))
    p.click()
    await flush()
    expect(vi.getTimerCount()).toBe(0)
    p.online()
    await flush()
    expect(p.replace).toHaveBeenCalledWith('/catalogo')
    expect(vi.getTimerCount()).toBe(0)
  })
})
