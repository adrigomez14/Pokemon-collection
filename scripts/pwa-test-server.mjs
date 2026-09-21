import { build } from 'vite'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const outDir = resolve(root, 'node_modules/.cache/pwa-e2e')
const origin = 'http://127.0.0.1:4175'
const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'))

// Conserva TODOS los plugins de producción, incluido el hash del worker.
// envPrefix vacío también impide incorporar VITE_* heredadas del terminal.
await build({
  root, configFile: resolve(root, 'vite.config.ts'), envDir: false, envPrefix: [],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://pokefolio-pwa-fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_pwa_fixture_not_a_real_key'),
  },
  build: { outDir, emptyOutDir: true },
})
const builtWorker = await readFile(resolve(outDir, 'sw.js'), 'utf8')
const version = builtWorker.match(/const VERSION = '([a-f0-9]{20})'/)?.[1]
if (!version || builtWorker.includes('__POKEFOLIO_BUILD__')) throw new Error('Worker sin versión de producción')

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
}
const rules = config.headers.map((rule) => ({
  ...rule,
  matches: new RegExp(`^${rule.source.split('(.*)').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`),
}))
let revision = ''
let faults = {}
let requests = []
const record = (path) => { requests.push(path); if (requests.length > 2000) requests.shift() }

const server = createServer(async (request, response) => {
  try {
    if (request.headers.host !== '127.0.0.1:4175') { response.writeHead(403).end(); return }
    const url = new URL(request.url, origin)
    const path = url.pathname
    if (path.startsWith('/__pwa_test__/')) {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Type', 'application/json')
      if (path === '/__pwa_test__/ready') { response.end('{"ready":true}'); return }
      // Solo el runner local; sin CORS, sin endpoints en el build publicado.
      if (request.headers['x-pwa-test'] !== 'local-fixture' || request.headers.origin) {
        response.writeHead(403).end(); return
      }
      if (request.method === 'GET' && path === '/__pwa_test__/state') {
        response.end(JSON.stringify({ version, revision, requests })); return
      }
      if (request.method !== 'POST') { response.writeHead(405).end(); return }
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (body.length > 8192) { response.writeHead(413).end(); return }
      }
      const input = JSON.parse(body || '{}')
      if (path === '/__pwa_test__/reset') { revision = ''; faults = {}; requests = [] }
      else if (path === '/__pwa_test__/configure') {
        if (input.revision !== undefined) {
          if (!/^[a-z0-9-]{1,40}$/.test(input.revision)) { response.writeHead(400).end(); return }
          revision = input.revision
        }
        if (input.faults !== undefined) faults = input.faults
      } else { response.writeHead(404).end(); return }
      response.end('{"ok":true}'); return
    }
    record(url.pathname + url.search)
    const destination = config.rewrites.find((rule) => rule.source === path)?.destination
    const target = path === '/' ? '/index.html' : destination || path
    response.setHeader('Content-Type', mime[extname(target)] || 'application/octet-stream')
    for (const rule of rules) if (rule.matches.test(path)) {
      for (const header of rule.headers) response.setHeader(header.key, header.value)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return }
    if (faults[path]) {
      response.writeHead(faults[path], { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(`fixture HTTP ${faults[path]}`); return
    }
    if (path === '/api/pwa-private-fixture' || path === '/api/pwa-public-fixture') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ marker: 'PWA_NON_SENSITIVE_FIXTURE_ONLY' })); return
    }
    if (path === '/sw.js') {
      response.end(revision ? builtWorker.replace(`const VERSION = '${version}'`, `const VERSION = '${version}-${revision}'`) : builtWorker)
      return
    }
    const file = resolve(outDir, `.${decodeURIComponent(target)}`)
    if (!file.startsWith(outDir + sep)) { response.writeHead(403).end(); return }
    try {
      const bytes = await readFile(file)
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('fixture HTTP 404')
    }
  } catch {
    if (!response.headersSent) response.writeHead(500)
    response.end('fixture server error')
  }
})

server.listen(4175, '127.0.0.1', () => console.log(`PWA production fixture: ${origin} (${version})`))
// Playwright posee este proceso; el cierre no deja servidores/background builds.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.closeAllConnections()
  server.close(() => process.exit(0))
})
