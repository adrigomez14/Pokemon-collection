import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const languageCodes = new Set(['es', 'en', 'ja'])
type WishlistItem = {
  user_id: string; list_id: string; card_id: string; language: 'es' | 'en' | 'ja'
  target_price: number; card_snapshot: { name: string; localId: string }
}
type User = { email?: string; user_metadata?: { price_alert_email?: boolean } }

function reply(response: ServerResponse, status: number, result: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ result }))
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

async function currentPrice(item: WishlistItem) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/${item.language}/cards/${encodeURIComponent(item.card_id)}`, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json() as { pricing?: { cardmarket?: { trend?: number | null; low?: number | null } | null } | null }
    const trend = data.pricing?.cardmarket?.trend
    const low = data.pricing?.cardmarket?.low
    const price = typeof trend === 'number' && trend > 0 ? trend : typeof low === 'number' && low > 0 ? low : null
    return price !== null && Number.isFinite(price) ? Math.round(price * 100) / 100 : null
  } finally { clearTimeout(timeout) }
}

async function sendEmail(item: WishlistItem, price: number, email: string) {
  const host = process.env.SMTP_HOST?.trim()
  const port = process.env.SMTP_PORT === '465' || process.env.SMTP_PORT === '587' ? Number(process.env.SMTP_PORT) : 0
  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASS
  if (!host || !port || !user || !password) return false
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true, auth: { user, pass: password },
    tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true,
  })
  try {
    const result = await transport.sendMail({
      from: { name: 'Pokéfolio · Alertas', address: user }, to: email,
      subject: `Pokéfolio · ${item.card_snapshot.name} ha alcanzado tu precio objetivo`,
      text: [
        `${item.card_snapshot.name} (${item.language.toUpperCase()} · ${item.card_snapshot.localId}) ha alcanzado tu precio objetivo.`,
        `Precio observado: ${price.toFixed(2)} €`, `Precio objetivo: ${item.target_price.toFixed(2)} €`,
        '', 'Abre tu lista de deseos en Pokéfolio para revisar la carta y el enlace de compra.',
      ].join('\n'),
    })
    return Boolean(result.accepted?.length)
  } finally { transport.close() }
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); reply(response, 405, 'method_not_allowed'); return }
  if (!authorized(request)) { reply(response, 401, 'unauthorized'); return }
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) { reply(response, 503, 'not_configured'); return }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.from('wishlist_items')
    .select('user_id,list_id,card_id,language,target_price,card_snapshot')
    .not('target_price', 'is', null)
  if (error) { reply(response, 502, 'wishlist_read_failed'); return }
  const items = (data ?? []).filter((item): item is WishlistItem => languageCodes.has(item.language) && typeof item.target_price === 'number' && item.target_price >= 0)
  let checked = 0; let alerted = 0; let emailed = 0
  for (const item of items) {
    const price = await currentPrice(item).catch(() => null)
    if (price === null) continue
    checked++
    if (price > item.target_price) continue
    const { data: alert, error: insertError } = await admin.from('wishlist_price_alerts').upsert({
      user_id: item.user_id, list_id: item.list_id, card_id: item.card_id, language: item.language,
      target_price: item.target_price, observed_price: price,
    }, { onConflict: 'user_id,list_id,card_id,language,target_price', ignoreDuplicates: true }).select('id').maybeSingle()
    if (insertError || !alert) continue
    alerted++
    const user = await admin.auth.admin.getUserById(item.user_id).then((result) => result.data.user as User | null).catch(() => null)
    if (user?.user_metadata?.price_alert_email === true && user.email && await sendEmail(item, price, user.email).catch(() => false)) emailed++
  }
  reply(response, 200, JSON.stringify({ checked, alerted, emailed }))
}
