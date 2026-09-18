import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createConnection, type Socket } from 'node:net'
import nodemailer from 'nodemailer'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Límites operativos propios, no cuotas del proveedor. Cron Hobby: diario, 09:00 UTC.
// 55 s de trabajo dentro de maxDuration=60; precios reservan como máximo 20 s.
export const LIMITS = Object.freeze({ runMs: 55000, priceMs: 20000, dbMs: 3000,
  fetchMs: 5000, smtpMs: 12000, priceBatch: 8, priceItems: 80, emailWorkers: 2, emails: 20,
  priceSlotMs: 12000, emailSlotMs: 22000 })
type WishlistItem = {
  user_id: string; list_id: string; card_id: string; language: 'es' | 'en' | 'ja'
  target_price: number; card_snapshot: { name: string; localId: string }
}
type Delivery = Pick<WishlistItem, 'language' | 'target_price' | 'card_snapshot'> & {
  status: 'ready'; email: string; observed_price: number
}
type Claim = { id: string; lease_token: string }
type Outcome = 'sent' | 'retry' | 'failed' | 'skipped'
type Admin = SupabaseClient

function reply(response: ServerResponse, status: number, body: object) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function authorized(request: IncomingMessage) {
  const secret = process.env.CRON_SECRET?.trim()
  const authorization = request.headers.authorization
  if (!secret || secret.length < 32 || typeof authorization !== 'string') return false
  return timingSafeEqual(
    createHash('sha256').update(authorization).digest(),
    createHash('sha256').update(`Bearer ${secret}`).digest(),
  )
}

async function rpc<T>(admin: Admin, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await admin.rpc(name, args).abortSignal(AbortSignal.timeout(LIMITS.dbMs))
  if (error || data === null) throw new Error('database_operation_failed')
  return data as T
}

async function currentPrice(item: WishlistItem) {
  const response = await fetch(`https://api.tcgdex.net/v2/${item.language}/cards/${encodeURIComponent(item.card_id)}`,
    { signal: AbortSignal.timeout(LIMITS.fetchMs) })
  if (!response.ok) return null
  const data = await response.json() as { pricing?: { cardmarket?: { trend?: number | null; low?: number | null } | null } | null }
  const market = data?.pricing?.cardmarket
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 9999999
  const price = valid(market?.trend) ? market.trend : valid(market?.low) ? market.low : null
  return price === null ? null : Math.round(price * 100) / 100
}

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim()
  const port = process.env.SMTP_PORT === '465' || process.env.SMTP_PORT === '587' ? Number(process.env.SMTP_PORT) : 0
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  return host && port && user && pass ? { host, port, user, pass } : null
}

async function sendEmail(delivery: Delivery, config: NonNullable<ReturnType<typeof smtpConfig>>): Promise<Outcome> {
  // Dirección estructurada: no interpretar una lista arbitraria de destinatarios.
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(delivery.email)) return 'skipped'
  const { host, port, user, pass } = config
  let socket: Socket | undefined
  let closed = false
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true, auth: { user, pass },
    tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 8000,
    disableFileAccess: true, disableUrlAccess: true,
    // SMTPTransport.close() no destruye conexiones activas en Nodemailer.
    // Conservar el socket TCP para abortar también DNS/conexión/STARTTLS/DATA.
    // Nodemailer negocia TLS inmediato en 465 y STARTTLS obligatorio en 587.
    getSocket: (_options, callback) => {
      if (closed) { callback(new Error('smtp_aborted'), false); return }
      const connection = createConnection({ host, port })
      socket = connection
      const failed = (error: Error) => callback(error, false)
      connection.once('error', failed)
      connection.once('connect', () => {
        connection.removeListener('error', failed)
        if (closed) { connection.destroy(); callback(new Error('smtp_aborted'), false); return }
        callback(null, { connection })
      })
    },
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      transport.sendMail({
        from: { name: 'Pokéfolio · Alertas', address: user }, to: { address: delivery.email, name: '' },
        subject: `Pokéfolio · ${delivery.card_snapshot.name.replace(/[\r\n]/g, ' ')} ha alcanzado tu precio objetivo`,
        text: [
          `${delivery.card_snapshot.name} (${delivery.language.toUpperCase()} · ${delivery.card_snapshot.localId}) alcanzó tu precio objetivo.`,
          `Precio observado al crear el aviso: ${delivery.observed_price.toFixed(2)} €`,
          `Precio objetivo: ${delivery.target_price.toFixed(2)} €`,
          '', 'El precio puede haber cambiado. Abre tu lista de deseos en Pokéfolio para comprobarlo.',
        ].join('\n'),
      }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('smtp_timeout')), LIMITS.smtpMs) }),
    ])
    return result.accepted?.length ? 'sent' : 'retry'
  } catch (error) {
    const code = (error as { responseCode?: number })?.responseCode
    // 4xx/red/timeout reintentables; 5xx terminal. No persistir respuestas con PII.
    return typeof code === 'number' && code >= 500 && code < 600 ? 'failed' : 'retry'
  } finally {
    closed = true
    clearTimeout(timeout)
    socket?.destroy()
    transport.close()
  }
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); reply(response, 405, { result: 'method_not_allowed' }); return }
  if (!authorized(request)) { reply(response, 401, { result: 'unauthorized' }); return }
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) { reply(response, 503, { result: 'not_configured' }); return }
  const start = performance.now()
  const deadline = start + LIMITS.runMs
  const priceDeadline = start + LIMITS.priceMs
  const smtp = smtpConfig()
  const counts = { attempted: 0, checked: 0, alerted: 0, claimed: 0, smtpAccepted: 0, emailed: 0,
    retried: 0, skipped: 0, failed: 0, errors: 0, priceFailures: 0, budgetExhausted: false, smtpConfigured: Boolean(smtp) }
  let admin: Admin
  try { admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) }
  catch { reply(response, 503, { result: 'not_configured' }); return }

  // Paginación por prioridad persistida en SQL, no OFFSET ni lectura ilimitada.
  // La reclamación avanza incluso ante precio igual/bajo o caída de TCGdex.
  try {
    while (counts.attempted < LIMITS.priceItems) {
      if (performance.now() + LIMITS.priceSlotMs > priceDeadline) { counts.budgetExhausted = true; break }
      const items = await rpc<WishlistItem[]>(admin, 'claim_wishlist_price_checks', {
        p_limit: Math.min(LIMITS.priceBatch, LIMITS.priceItems - counts.attempted),
      })
      if (!items.length) break
      counts.attempted += items.length
      await Promise.all(items.map(async (item) => {
        const price = await currentPrice(item).catch(() => null)
        if (price === null) { counts.priceFailures++; return }
        counts.checked++
        if (price > item.target_price) return
        try {
          // DO NOTHING no resetea pending/retry/sent/legacy ni sus leases.
          const { data, error } = await admin.from('wishlist_price_alerts').upsert({
            user_id: item.user_id, list_id: item.list_id, card_id: item.card_id, language: item.language,
            target_price: item.target_price, observed_price: price, email_state: 'pending',
          }, { onConflict: 'user_id,list_id,card_id,language,target_price', ignoreDuplicates: true })
            .select('id').abortSignal(AbortSignal.timeout(LIMITS.dbMs)).maybeSingle()
          if (error) counts.errors++
          else if (data) counts.alerted++
        } catch { counts.errors++ }
      }))
    }
  } catch { counts.errors++ } // Un fallo de lectura no bloquea la cola de correos.

  if (smtp) {
    let reserved = 0
    const worker = async () => {
      while (reserved < LIMITS.emails) {
        if (performance.now() + LIMITS.emailSlotMs > deadline) { counts.budgetExhausted = true; break }
        reserved++ // Reserva síncrona antes de await: límite compartido entre trabajadores.
        try {
          const [claim] = await rpc<Claim[]>(admin, 'claim_wishlist_alert_email')
          if (!claim) break
          counts.claimed++
          const args = { p_id: claim.id, p_token: claim.lease_token }
          const delivery = await rpc<Delivery | { status: 'lost' | 'skipped' }>(admin, 'prepare_wishlist_alert_email', args)
          if (delivery.status === 'skipped') { counts.skipped++; continue }
          if (delivery.status !== 'ready') { counts.errors++; continue }
          const outcome = await sendEmail(delivery, smtp)
          if (outcome === 'sent') counts.smtpAccepted++
          const saved = await rpc<boolean>(admin, 'finish_wishlist_alert_email', { ...args, p_outcome: outcome })
          if (!saved) { counts.errors++; continue }
          // emailed significa aceptación SMTP Y confirmación durable, no llegada al buzón.
          if (outcome === 'sent') counts.emailed++
          else if (outcome === 'retry') counts.retried++
          else if (outcome === 'failed') counts.failed++
          else counts.skipped++
        } catch { counts.errors++; break } // Lease recuperable; no ACK especulativo tras error DB.
      }
    }
    await Promise.all(Array.from({ length: LIMITS.emailWorkers }, worker))
  }
  reply(response, counts.errors ? 502 : 200, { result: counts.errors ? 'partial_failure' : 'ok', ...counts })
}
