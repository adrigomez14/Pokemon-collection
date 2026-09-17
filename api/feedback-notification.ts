import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import nodemailer from 'nodemailer'
import { z } from 'zod'

const MAX_BODY = 32768
const topics = { sugerencia: 'Sugerencia', error: 'Error', otro: 'Otro' } as const
const eventSchema = z.object({
  type: z.literal('INSERT'), schema: z.literal('public'), table: z.literal('feedback'),
  record: z.object({
    id: z.string().uuid(), topic: z.enum(['sugerencia', 'error', 'otro']),
    email: z.string().max(200).nullable().optional(),
    message: z.string().trim().min(1).max(4000), created_at: z.string().datetime({ offset: true }),
  }),
})
const emailSchema = z.string().trim().max(200).email()
const configSchema = z.object({
  host: z.string().trim().min(1), port: z.enum(['465', '587']),
  user: emailSchema, password: z.string().min(1), to: emailSchema,
})

// Evita duplicados simultáneos o recientes en ESTA instancia. No es una cola durable.
const deliveries = new Map<string, { expires: number; task: Promise<void> }>()

function reply(response: ServerResponse, status: number, result: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ result }))
}

async function readBody(request: IncomingMessage & { body?: unknown }) {
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw new Error('body_too_large')
  if (request.body !== undefined) {
    const raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) throw new Error('body_too_large')
    return JSON.parse(raw) as unknown
  }
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const part = Buffer.from(chunk)
    size += part.length
    if (size > MAX_BODY) throw new Error('body_too_large')
    parts.push(part)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
}

/** Recibe únicamente avisos autenticados de INSERT en public.feedback. */
export default async function handler(request: IncomingMessage & { body?: unknown }, response: ServerResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    reply(response, 405, 'method_not_allowed'); return
  }
  const secret = process.env.WEBHOOK_SECRET?.trim()
  if (!secret || secret.length < 32) { reply(response, 503, 'not_configured'); return }
  const authorization = request.headers.authorization
  if (typeof authorization !== 'string' || authorization.length > 1000 || !timingSafeEqual(
    createHash('sha256').update(authorization).digest(),
    createHash('sha256').update(`Bearer ${secret}`).digest(),
  )) { reply(response, 401, 'unauthorized'); return }
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    reply(response, 415, 'unsupported_media_type'); return
  }
  let input: unknown
  try { input = await readBody(request) }
  catch (error) { reply(response, error instanceof Error && error.message === 'body_too_large' ? 413 : 400, 'invalid_body'); return }
  const event = eventSchema.safeParse(input)
  if (!event.success) { reply(response, 400, 'invalid_event'); return }
  const config = configSchema.safeParse({
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER, password: process.env.SMTP_PASS, to: process.env.CONTACT_TO,
  })
  if (!config.success) { reply(response, 503, 'not_configured'); return }

  const { record } = event.data
  const now = Date.now()
  for (const [id, delivery] of deliveries) if (delivery.expires < now) deliveries.delete(id)
  const existing = deliveries.get(record.id)
  if (existing) {
    try { await existing.task; reply(response, 200, 'already_processed') }
    catch { reply(response, 502, 'smtp_failed') }
    return
  }
  if (deliveries.size >= 500) { reply(response, 503, 'temporarily_unavailable'); return }
  const task = (async () => {
    const { host, port, user, password, to } = config.data
    const transport = nodemailer.createTransport({
      host, port: Number(port), secure: port === '465', requireTLS: true,
      auth: { user, pass: password }, tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      disableFileAccess: true, disableUrlAccess: true,
    })
    const visitor = emailSchema.safeParse(record.email)
    try {
      const result = await transport.sendMail({
        from: { name: 'Pokéfolio · Contacto', address: user }, to,
        ...(visitor.success ? { replyTo: visitor.data } : {}),
        subject: `Pokéfolio · ${topics[record.topic]}`,
        // Sin HTML, adjuntos, destinatarios del visitante ni contenido en cabeceras.
        text: [
          `Nuevo mensaje de contacto: ${topics[record.topic]}`,
          `Referencia: ${record.id}`, `Fecha: ${record.created_at}`,
          `Correo indicado (no verificado): ${record.email || 'No indicado'}`,
          '', record.message, '',
          'El mensaje permanece guardado en la tabla feedback de Supabase.',
        ].join('\n'),
      })
      if (!result.accepted?.length) throw new Error('smtp_not_accepted')
    } finally { transport.close() }
  })()
  deliveries.set(record.id, { expires: now + 60 * 60 * 1000, task })
  try { await task; reply(response, 200, 'smtp_accepted') }
  catch {
    deliveries.delete(record.id)
    // No registrar el cuerpo, el correo del visitante ni errores SMTP con credenciales.
    console.error('feedback_notification_failed', record.id)
    reply(response, 502, 'smtp_failed')
  }
}