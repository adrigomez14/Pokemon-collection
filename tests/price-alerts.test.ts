import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  upsert: vi.fn(), sendMail: vi.fn(), createTransport: vi.fn(), close: vi.fn(), createConnection: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }))
vi.mock('node:net', () => ({ createConnection: mocks.createConnection }))
import handler, { LIMITS } from '../api/price-alerts'

const secret = 'test-only-cron-secret-at-least-32-characters'
const item = { user_id: 'user', list_id: 'list', card_id: 'base1-1', language: 'en', target_price: 10,
  card_snapshot: { name: 'Alakazam', localId: '1' } }
const delivery = { status: 'ready', email: 'current@example.test', language: 'en', target_price: 10,
  observed_price: 8, card_snapshot: item.card_snapshot }
let items: typeof item[]
let claims: { id: string; lease_token: string }[]
let dbCall: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>

async function invoke(method = 'GET', authorization: unknown = `Bearer ${secret}`) {
  const request = { method, headers: { authorization }, body: { email: 'attacker@example.test' } } as unknown as IncomingMessage
  const headers = new Map<string, string>()
  let body = ''
  const response = { statusCode: 0, setHeader: (name: string, value: string) => headers.set(name, value),
    end: (value: string) => { body = value } } as unknown as ServerResponse
  await handler(request, response)
  return { status: response.statusCode, body: JSON.parse(body), headers }
}
function enqueue(count = 1) {
  claims = Array.from({ length: count }, (_, n) => ({ id: `alert-${n}`, lease_token: `unique-token-${n}` }))
}
function priceResponse(price = 8) {
  return { ok: true, json: async () => ({ pricing: { cardmarket: { trend: price } } }) } as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  items = []; claims = []
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('SUPABASE_URL', 'https://db.invalid'); vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key')
  vi.stubEnv('SMTP_HOST', 'smtp.invalid'); vi.stubEnv('SMTP_PORT', '465')
  vi.stubEnv('SMTP_USER', 'sender@example.test'); vi.stubEnv('SMTP_PASS', 'not-a-real-secret')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(priceResponse()))
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc, from: mocks.from })
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close })
  mocks.createConnection.mockImplementation(() => { throw new Error('Unexpected socket: all tests must remain offline') })
  mocks.sendMail.mockResolvedValue({ accepted: ['current@example.test'] })
  dbCall = async (name, args) => {
    if (name === 'claim_wishlist_price_checks') return { data: items.splice(0, Number(args.p_limit)), error: null }
    if (name === 'claim_wishlist_alert_email') return { data: claims.splice(0, 1), error: null }
    if (name === 'prepare_wishlist_alert_email') return { data: delivery, error: null }
    if (name === 'finish_wishlist_alert_email') return { data: true, error: null }
    throw new Error(`Unexpected RPC ${name}`)
  }
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown> = {}) => ({ abortSignal: (signal: AbortSignal) => {
    expect(signal).toBeInstanceOf(AbortSignal)
    return dbCall(name, args)
  } }))
  mocks.upsert.mockImplementation(() => ({ select: (columns: string) => {
    expect(columns).toBe('id')
    return { abortSignal: (signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      // maybeSingle es terminal: no ofrece abortSignal (como PostgREST real).
      return { maybeSingle: async () => ({ data: { id: 'new-alert' }, error: null }) }
    } }
  } }))
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe('wishlist_price_alerts') // Prohíbe lectura ilimitada de wishlist_items.
    return { upsert: mocks.upsert }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Contrato HTTP y configuración sin secretos reales', () => {
  it('405 con Allow y no-store, sin inicializar servicios', async () => {
    const result = await invoke('POST')
    expect(result.status).toBe(405)
    expect(result.headers.get('Allow')).toBe('GET')
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it.each(['', 'Bearer incorrect', `Bearer ${secret} `, [`Bearer ${secret}`], null])('401 sin auth exacta: %j', async (auth) => {
    expect((await invoke('GET', auth)).status).toBe(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it.each(['', 'short', 's'.repeat(31)])('no admite CRON_SECRET ausente o corto: %j', async (value) => {
    vi.stubEnv('CRON_SECRET', value)
    expect((await invoke('GET', `Bearer ${value}`)).status).toBe(401)
  })
  it('acepta 32 caracteres y devuelve JSON objeto con counters numéricos sin doble serialización', async () => {
    vi.stubEnv('CRON_SECRET', 's'.repeat(32))
    const result = await invoke('GET', `Bearer ${'s'.repeat(32)}`)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ result: 'ok', checked: 0, alerted: 0, emailed: 0, errors: 0 })
    expect(typeof result.body).toBe('object')
    expect(result.headers.get('Content-Type')).toContain('application/json')
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.createClient).toHaveBeenCalledWith('https://db.invalid', 'server-test-key',
      { auth: { persistSession: false, autoRefreshToken: false } })
  })
  it.each(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])('503 sin %s', async (name) => {
    vi.stubEnv(name, '')
    expect((await invoke()).status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('503 si el cliente no puede inicializarse, sin filtrar errores', async () => {
    mocks.createClient.mockImplementationOnce(() => { throw new Error('private credentials') })
    expect((await invoke()).body).toEqual({ result: 'not_configured' })
  })
  it.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'])('sin %s no reclama ni consume correo pendiente', async (name) => {
    enqueue(); vi.stubEnv(name, '')
    expect((await invoke()).body).toMatchObject({ claimed: 0, smtpConfigured: false })
    expect(claims).toHaveLength(1)
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain('claim_wishlist_alert_email')
  })
})

describe('Precios paginados, presupuesto y errores aislados', () => {
  it('lee lotes de 8, máximo 80 por cron, y avanza al siguiente lote de pendientes', async () => {
    items = Array.from({ length: 1050 }, (_, n) => ({ ...item, card_id: `card-${n}` }))
    expect((await invoke()).body).toMatchObject({ attempted: 80, checked: 80, alerted: 80 })
    expect(items[0].card_id).toBe('card-80')
    expect((await invoke()).body.attempted).toBe(80)
    expect(items[0].card_id).toBe('card-160')
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'claim_wishlist_price_checks')).toHaveLength(20)
    for (const [name, args] of mocks.rpc.mock.calls) {
      if (name === 'claim_wishlist_price_checks') expect(args).toEqual({ p_limit: 8 })
    }
  })
  it('respeta tiempo de precios y conserva presupuesto para pendientes', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    items = Array.from({ length: 50 }, () => ({ ...item })); enqueue()
    vi.mocked(fetch).mockImplementation(async () => { now = 9000; return priceResponse() })
    const result = (await invoke()).body
    expect(result).toMatchObject({ attempted: 8, emailed: 1, budgetExhausted: true })
    expect(items).toHaveLength(42)
  })
  it('no reclama leases cuando falta tiempo suficiente para completar envío y ACK', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const original = dbCall
    dbCall = async (name, args) => { const result = await original(name, args); now = 40000; return result }
    enqueue()
    expect((await invoke()).body).toMatchObject({ claimed: 0, budgetExhausted: true })
    expect(claims).toHaveLength(1)
  })
  it('limita consultas simultáneas al tamaño del lote y envía señal timeout', async () => {
    items = Array.from({ length: 12 }, () => ({ ...item }))
    let active = 0; let maximum = 0
    vi.mocked(fetch).mockImplementation(async (_, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      active++; maximum = Math.max(maximum, active)
      await Promise.resolve(); active--
      return priceResponse()
    })
    expect((await invoke()).body.checked).toBe(12)
    expect(maximum).toBeLessThanOrEqual(LIMITS.priceBatch)
  })
  it.each(['throw', 'http', 'bad_json', 'invalid_price'])('fallo proveedor %s no bloquea la cola', async (failure) => {
    items = [{ ...item }]; enqueue()
    if (failure === 'throw') vi.mocked(fetch).mockRejectedValue(new Error('down'))
    if (failure === 'http') vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    if (failure === 'bad_json') vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => { throw new Error('json') } } as unknown as Response)
    if (failure === 'invalid_price') vi.mocked(fetch).mockResolvedValue(priceResponse(Infinity))
    expect((await invoke()).body).toMatchObject({ priceFailures: 1, alerted: 0, emailed: 1 })
  })
  it('aborta un proveedor colgado y aún entrega pendientes', async () => {
    items = [{ ...item }]; enqueue()
    vi.mocked(fetch).mockImplementation((_, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    expect((await invoke()).body).toMatchObject({ priceFailures: 1, emailed: 1 })
  }, 15000)
  it('incluye precio igual al objetivo y usa low cuando trend no es válido', async () => {
    items = [{ ...item }]
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ pricing: { cardmarket: { trend: -1, low: 10 } } }) } as Response)
    expect((await invoke()).body.alerted).toBe(1)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ observed_price: 10, email_state: 'pending' }),
      { onConflict: 'user_id,list_id,card_id,language,target_price', ignoreDuplicates: true })
  })
  it('fallo DB al leer precios no impide entregar la cola', async () => {
    enqueue()
    const original = dbCall
    dbCall = async (name, args) => name === 'claim_wishlist_price_checks'
      ? { data: null, error: { message: 'private SQL' } } : original(name, args)
    const result = await invoke()
    expect(result.status).toBe(502)
    expect(result.body).toMatchObject({ errors: 1, emailed: 1 })
    expect(JSON.stringify(result.body)).not.toContain('private SQL')
  })
  it('fallo INSERT no cuenta nuevas alertas; continúa cola independiente', async () => {
    items = [{ ...item }]; enqueue()
    mocks.upsert.mockImplementation(() => { throw new Error('db') })
    expect((await invoke()).body).toMatchObject({ alerted: 0, errors: 1, emailed: 1 })
  })
})

describe('Entrega acotada y confirmación durable', () => {
  it('solo reclama una alerta por trabajador libre, nunca una cola de leases en memoria', async () => {
    enqueue(30)
    const release: (() => void)[] = []
    mocks.sendMail.mockImplementationOnce(() => new Promise((resolve) => release.push(() => resolve({ accepted: ['current@example.test'] }))))
      .mockImplementationOnce(() => new Promise((resolve) => release.push(() => resolve({ accepted: ['current@example.test'] }))))
    const pending = invoke()
    await vi.waitFor(() => expect(mocks.sendMail).toHaveBeenCalledTimes(2))
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'claim_wishlist_alert_email')).toHaveLength(2)
    release.forEach((finish) => finish())
    expect((await pending).body).toMatchObject({ claimed: 20, emailed: 20 })
    expect(claims).toHaveLength(10)
  })
  it.each([false, 'error', 'throw'])('ACK DB %s no cuenta sent y no realiza ACK especulativo', async (failure) => {
    enqueue()
    const original = dbCall
    dbCall = async (name, args) => {
      if (name !== 'finish_wishlist_alert_email') return original(name, args)
      if (failure === 'throw') throw new Error('database unavailable')
      return { data: false, error: failure === 'error' ? { code: 'db' } : null }
    }
    const result = await invoke()
    expect(result.status).toBe(502)
    expect(result.body).toMatchObject({ smtpAccepted: 1, emailed: 0, errors: 1 })
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'finish_wishlist_alert_email')).toHaveLength(1)
  })
  it.each(['lost', 'skipped', 'error'])('prepare %s impide SMTP', async (status) => {
    enqueue()
    const original = dbCall
    dbCall = async (name, args) => name === 'prepare_wishlist_alert_email'
      ? { data: { status }, error: status === 'error' ? { code: 'db' } : null } : original(name, args)
    expect((await invoke()).body.emailed).toBe(0)
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
  it('timeout SMTP total cierra transporte y reprograma, sin consumir todo maxDuration', async () => {
    vi.useFakeTimers()
    enqueue()
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    const socketReady = vi.fn()
    mocks.createConnection.mockReturnValue(socket)
    mocks.sendMail.mockImplementation(() => {
      mocks.createTransport.mock.calls[0][0].getSocket({}, socketReady)
      socket.emit('connect')
      return new Promise(() => {})
    })
    const pending = invoke()
    await vi.advanceTimersByTimeAsync(LIMITS.smtpMs + 1)
    expect((await pending).body).toMatchObject({ retried: 1, emailed: 0 })
    expect(socketReady).toHaveBeenCalledWith(null, { connection: socket })
    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    mocks.createTransport.mock.calls[0][0].getSocket({}, late)
    expect(late).toHaveBeenCalledWith(expect.any(Error), false)
    expect(mocks.createConnection).toHaveBeenCalledTimes(1)
  })
  it('timeout destruye también una conexión TCP que nunca llega a conectar', async () => {
    vi.useFakeTimers(); enqueue()
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    mocks.createConnection.mockReturnValue(socket)
    mocks.sendMail.mockImplementation(() => {
      mocks.createTransport.mock.calls[0][0].getSocket({}, vi.fn())
      return new Promise(() => {})
    })
    const pending = invoke()
    await vi.advanceTimersByTimeAsync(LIMITS.smtpMs + 1)
    expect((await pending).body.retried).toBe(1)
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
  it.each([451, 550, undefined])('clasifica respuesta SMTP %s y libera el transporte', async (code) => {
    enqueue()
    mocks.sendMail.mockRejectedValue(Object.assign(new Error('do not expose credentials'), { responseCode: code }))
    const result = (await invoke()).body
    expect(result).toMatchObject({ emailed: 0, retried: code === 550 ? 0 : 1, failed: code === 550 ? 1 : 0 })
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('credentials')
  })
  it('SMTP sin destinatarios aceptados no cuenta correo enviado', async () => {
    enqueue(); mocks.sendMail.mockResolvedValue({ accepted: [] })
    expect((await invoke()).body).toMatchObject({ emailed: 0, smtpAccepted: 0, retried: 1 })
  })
  it('correo actual estructurado, texto plano y TLS, nunca email del body ni precio actual', async () => {
    enqueue(); vi.stubEnv('SMTP_PORT', '587')
    expect((await invoke()).body.emailed).toBe(1)
    expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({ to: { address: 'current@example.test', name: '' } })
    const message = mocks.sendMail.mock.calls[0][0]
    expect(message.text).toContain('8.00'); expect(message.text).toContain('puede haber cambiado')
    expect(message.html).toBeUndefined(); expect(message.attachments).toBeUndefined()
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false,
      requireTLS: true, disableFileAccess: true, disableUrlAccess: true }))
  })
  it('no interpreta direcciones múltiples o cabeceras inyectadas como destinatarios', async () => {
    enqueue()
    const original = dbCall
    dbCall = async (name, args) => name === 'prepare_wishlist_alert_email'
      ? { data: { ...delivery, email: 'a@example.test, attacker@example.test' }, error: null } : original(name, args)
    expect((await invoke()).body).toMatchObject({ skipped: 1, emailed: 0 })
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
})
