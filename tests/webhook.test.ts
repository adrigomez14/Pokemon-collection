import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }))
const secret = 'test-only-webhook-secret-0000000000000000000000'
const event = {
  type: 'INSERT', schema: 'public', table: 'feedback', old_record: null,
  record: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', topic: 'sugerencia', email: 'visitor@example.com', message: 'Me gustaría una mejora.', created_at: '2026-09-17T10:00:00Z' },
}

async function invoke(options: { method?: string; authorization?: string | string[]; body?: unknown; raw?: string[]; contentType?: string } = {}) {
  const request = Readable.from(options.raw ?? []) as IncomingMessage & { body?: unknown }
  request.method = options.method ?? 'POST'
  request.headers = { authorization: (options.authorization ?? `Bearer ${secret}`) as string, 'content-type': options.contentType ?? 'application/json' }
  if (!options.raw) request.body = options.body ?? event
  const headers = new Map<string, string>()
  let body = ''
  const response = { statusCode: 0, setHeader: (key: string, value: string) => headers.set(key, value), end: (value: string) => { body = value } } as unknown as ServerResponse
  const { default: handler } = await import('../api/feedback-notification')
  await handler(request, response)
  return { status: response.statusCode, result: JSON.parse(body).result, headers }
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubEnv('WEBHOOK_SECRET', secret)
  vi.stubEnv('SMTP_HOST', 'smtp.gmail.com'); vi.stubEnv('SMTP_PORT', '465')
  vi.stubEnv('SMTP_USER', 'owner@example.com'); vi.stubEnv('SMTP_PASS', 'test-password-not-real')
  vi.stubEnv('CONTACT_TO', 'inbox@example.com')
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close })
  smtp.sendMail.mockResolvedValue({ accepted: ['inbox@example.com'] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Webhook SMTP privado', () => {
  it('rechaza métodos distintos de POST', async () => {
    const response = await invoke({ method: 'GET' })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(smtp.sendMail).not.toHaveBeenCalled()
  })
  it('exige el secreto exacto y no acepta múltiples cabeceras', async () => {
    for (const authorization of ['Bearer incorrecto', '', ['Bearer incorrecto'], `Bearer ${secret} `]) {
      expect((await invoke({ authorization })).status).toBe(401)
    }
    expect(smtp.createTransport).not.toHaveBeenCalled()
  })
  it('falla de forma cerrada si falta configuración o el secreto es corto', async () => {
    vi.stubEnv('WEBHOOK_SECRET', 'short')
    expect((await invoke()).status).toBe(503)
    vi.stubEnv('WEBHOOK_SECRET', secret); vi.stubEnv('SMTP_PASS', '')
    expect((await invoke()).status).toBe(503)
    expect(smtp.sendMail).not.toHaveBeenCalled()
  })
  it('solo procesa INSERT de la tabla correcta con un mensaje válido', async () => {
    for (const body of [
      { ...event, type: 'UPDATE' }, { ...event, table: 'collection_entries' }, { ...event, schema: 'private' },
      { ...event, record: { ...event.record, message: ' ' } },
      { ...event, record: { ...event.record, topic: 'arbitrario' } },
    ]) expect((await invoke({ body })).status).toBe(400)
    expect(smtp.sendMail).not.toHaveBeenCalled()
  })
  it('limita tamaño y valida JSON y Content-Type', async () => {
    expect((await invoke({ body: '{invalid' })).status).toBe(400)
    expect((await invoke({ body: 'x'.repeat(32769) })).status).toBe(413)
    expect((await invoke({ raw: ['x'.repeat(32769)] })).status).toBe(413)
    expect((await invoke({ contentType: 'text/plain' })).status).toBe(415)
    expect(smtp.sendMail).not.toHaveBeenCalled()
  })
  it('envía texto plano a un destino fijo y usa el visitante solo como Reply-To', async () => {
    const response = await invoke({ body: { ...event, to: 'attacker@example.com', record: { ...event.record, message: '<script>alert(1)</script>' } } })
    expect(response.status).toBe(200)
    expect(response.result).toBe('smtp_accepted')
    const message = smtp.sendMail.mock.calls[0][0]
    expect(message.from.address).toBe('owner@example.com')
    expect(message.to).toBe('inbox@example.com')
    expect(message.replyTo).toBe('visitor@example.com')
    expect(message.text).toContain('<script>alert(1)</script>')
    expect(message.html).toBeUndefined()
    expect(message.attachments).toBeUndefined()
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, requireTLS: true, disableFileAccess: true, disableUrlAccess: true }))
    expect(smtp.close).toHaveBeenCalledTimes(1)
  })
  it('acepta cuerpos en stream y no introduce correo inválido en las cabeceras', async () => {
    const raw = JSON.stringify({ ...event, record: { ...event.record, email: 'x\r\nBcc: attacker@example.com' } })
    expect((await invoke({ raw: [raw.slice(0, 30), raw.slice(30)] })).status).toBe(200)
    expect(smtp.sendMail.mock.calls[0][0].replyTo).toBeUndefined()
  })
  it('permite mensajes sin correo opcional y puerto 587 con TLS requerido', async () => {
    vi.stubEnv('SMTP_PORT', '587')
    expect((await invoke({ body: { ...event, record: { ...event.record, email: null } } })).status).toBe(200)
    expect(smtp.sendMail.mock.calls[0][0].replyTo).toBeUndefined()
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true }))
  })
  it('evita duplicados recientes en la misma instancia', async () => {
    expect((await invoke()).status).toBe(200)
    expect((await invoke()).result).toBe('already_processed')
    expect(smtp.sendMail).toHaveBeenCalledTimes(1)
  })
  it('comparte un envío pendiente entre dos avisos simultáneos', async () => {
    let finish!: (value: unknown) => void
    smtp.sendMail.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const first = invoke(); const second = invoke()
    await vi.waitFor(() => expect(smtp.sendMail).toHaveBeenCalledTimes(1))
    finish({ accepted: ['inbox@example.com'] })
    expect((await Promise.all([first, second])).map((value) => value.status)).toEqual([200, 200])
  })
  it('no oculta fallos SMTP ni imprime sus credenciales y permite reintentar', async () => {
    smtp.sendMail.mockRejectedValueOnce(new Error('smtp password=test-password-not-real'))
    expect((await invoke()).status).toBe(502)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('test-password-not-real')
    expect((await invoke()).status).toBe(200)
    expect(smtp.sendMail).toHaveBeenCalledTimes(2)
    expect(smtp.close).toHaveBeenCalledTimes(2)
  })
  it('no indica éxito si SMTP rechaza el destinatario', async () => {
    smtp.sendMail.mockResolvedValue({ accepted: [] })
    expect((await invoke()).status).toBe(502)
  })
})