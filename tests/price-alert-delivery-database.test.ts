import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), sendMail: vi.fn(), close: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: bridge.rpc, from: bridge.from }) }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: bridge.sendMail, close: bridge.close }) } }))
import handler from '../api/price-alerts'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const list = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherList = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secret = 'isolated-test-secret-at-least-32-characters'
let db: PGlite
let historical: Record<string, unknown>[]
let failAck = false

async function seed() {
  await db.exec(`reset role; delete from auth.users;
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${alice}','alice-current@example.test','{"price_alert_email":true}'),
      ('${bob}','bob@example.test','{"price_alert_email":true}');
    insert into public.wishlists(id,user_id,name) values
      ('${list}','${alice}','Favoritas'), ('${otherList}','${bob}','Otra');
    insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot,target_price) values
      ('${list}','${alice}','base1-1','en','{"id":"base1-1","name":"Alakazam","localId":"1"}',10);
    set role service_role;`)
}
// Payload antiguo: válido antes de 010 y durante la ventana SQL → backend nuevo.
async function insertLegacyAlert(target = 10) {
  const { rows } = await db.query<{ id: string }>(`insert into public.wishlist_price_alerts
    (user_id,list_id,card_id,language,target_price,observed_price)
    values($1,$2,'base1-1','en',$3,8) returning id`, [alice, list, target])
  return rows[0].id
}
// Cola post-010: el productor nuevo debe indicar el estado, sin depender del DEFAULT.
async function insertAlert(target = 10) {
  const { rows } = await db.query<{ id: string }>(`insert into public.wishlist_price_alerts
    (user_id,list_id,card_id,language,target_price,observed_price,email_state)
    values($1,$2,'base1-1','en',$3,8,'pending') returning id`, [alice, list, target])
  return rows[0].id
}
type Claim = { id: string; lease_token: string }
async function claim() { return (await db.query<Claim>('select * from public.claim_wishlist_alert_email()')).rows }
async function prepare(c: Claim) {
  return (await db.query<{ value: { status: string; email?: string } }>(
    'select public.prepare_wishlist_alert_email($1,$2) as value', [c.id, c.lease_token])).rows[0].value
}
async function finish(c: Claim, outcome: string) {
  return (await db.query<{ value: boolean }>('select public.finish_wishlist_alert_email($1,$2,$3) as value',
    [c.id, c.lease_token, outcome])).rows[0].value
}
async function rows() {
  return (await db.query<{ id: string; email_state: string; email_attempts: number; email_lease_token: string | null;
    email_sent_at: Date | null; email_next_attempt_at: Date }>('select * from public.wishlist_price_alerts order by id')).rows
}
async function runCron() {
  const request = { method: 'GET', headers: { authorization: `Bearer ${secret}` } } as IncomingMessage
  let body = ''
  const response = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { body = value } } as unknown as ServerResponse
  await handler(request, response)
  return { status: response.statusCode, ...JSON.parse(body) }
}
async function asUser(id = alice, role = 'authenticated', anonymous = false) {
  await db.exec('reset role;')
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role, is_anonymous: anonymous })])
  await db.exec(`set role ${role};`) // Roles constantes del test, no entrada externa.
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant usage on schema auth,public to anon,authenticated;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`)
  for (const migration of ['007_wishlists.sql', '008_wishlist_target_price.sql', '009_wishlist_price_alerts.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'))
  }
  // Simula una instalación con avisos históricos ANTES de aplicar 010.
  await seed()
  await db.exec('reset role;')
  const old = await insertLegacyAlert()
  await db.exec(readFileSync(new URL('../supabase/migrations/010_wishlist_alert_email_delivery.sql', import.meta.url), 'utf8'))
  historical = (await db.query<Record<string, unknown>>('select id,email_state,email_attempts,email_sent_at from public.wishlist_price_alerts')).rows
  expect(historical[0]).toEqual({ id: old, email_state: 'legacy', email_attempts: 0, email_sent_at: null })
  await db.exec('set role service_role;')
  expect(await claim()).toEqual([])
})

beforeEach(async () => {
  await seed()
  failAck = false
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('SUPABASE_URL', 'https://db.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only')
  vi.stubEnv('SMTP_HOST', 'smtp.invalid'); vi.stubEnv('SMTP_PORT', '465')
  vi.stubEnv('SMTP_USER', 'sender@example.test'); vi.stubEnv('SMTP_PASS', 'test-only')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pricing: { cardmarket: { trend: 8 } } }) }))
  bridge.sendMail.mockResolvedValue({ accepted: ['alice-current@example.test'] })
  // Adaptador de transporte PostgREST: ejecuta las RPC/INSERT REALES en WASM.
  // No hay mocks de la máquina de estados, permisos, deduplicación ni leases.
  bridge.rpc.mockImplementation((name: string, args: Record<string, unknown> = {}) => ({
    abortSignal: async (signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      try {
        if (failAck && name === 'finish_wishlist_alert_email') throw new Error('simulated DB outage')
        const definitions: Record<string, [string, unknown[]]> = {
          claim_wishlist_price_checks: ['select * from public.claim_wishlist_price_checks($1)', [args.p_limit]],
          claim_wishlist_alert_email: ['select * from public.claim_wishlist_alert_email()', []],
          prepare_wishlist_alert_email: ['select public.prepare_wishlist_alert_email($1,$2) as value', [args.p_id, args.p_token]],
          finish_wishlist_alert_email: ['select public.finish_wishlist_alert_email($1,$2,$3) as value', [args.p_id, args.p_token, args.p_outcome]],
        }
        const [sql, parameters] = definitions[name]
        const result = await db.query<{ value: unknown }>(sql, parameters)
        return { data: name.startsWith('claim_') ? result.rows : result.rows[0].value, error: null }
      } catch (error) { return { data: null, error } }
    },
  }))
  bridge.from.mockImplementation((table: string) => {
    expect(table).toBe('wishlist_price_alerts')
    return { upsert: (item: Record<string, unknown>, options: unknown) => {
      expect(options).toEqual({ onConflict: 'user_id,list_id,card_id,language,target_price', ignoreDuplicates: true })
      expect(item.email_state).toBe('pending')
      return { select: () => ({ abortSignal: () => ({ maybeSingle: async () => {
        try {
          const result = await db.query(`insert into public.wishlist_price_alerts
            (user_id,list_id,card_id,language,target_price,observed_price,email_state) values($1,$2,$3,$4,$5,$6,$7)
            on conflict(user_id,list_id,card_id,language,target_price) do nothing returning id`,
          [item.user_id, item.list_id, item.card_id, item.language, item.target_price, item.observed_price, item.email_state])
          return { data: result.rows[0] ?? null, error: null }
        } catch (error) { return { data: null, error } }
      } }) }) }
    } }
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
afterAll(async () => { await db?.close() })

describe('010: SQL real, permisos y leases', () => {
  it('excluye registros históricos y encola los nuevos solo con pending explícito', async () => {
    expect(historical[0].email_state).toBe('legacy')
    await insertAlert()
    expect((await rows())[0]).toMatchObject({ email_state: 'pending', email_attempts: 0 })
    expect(await claim()).toHaveLength(1)
  })
  it('reclamaciones concurrentes no comparten alerta ni token; recupera lease expirado y cerca ACK antiguos', async () => {
    await insertAlert(); await insertAlert(9)
    // PGlite serializa conexiones: comprueba dos reclamaciones en competencia.
    // El bloqueo entre conexiones PostgreSQL se garantiza por FOR UPDATE SKIP LOCKED,
    // no se simula aquí una segunda sesión PostgreSQL independiente.
    const [one, two] = await Promise.all([claim(), claim()])
    expect(one).toHaveLength(1); expect(two).toHaveLength(1)
    expect(one[0].id).not.toBe(two[0].id)
    expect(one[0].lease_token).not.toBe(two[0].lease_token)
    expect(await claim()).toEqual([])
    expect(await finish({ ...one[0], lease_token: bob }, 'sent')).toBe(false)
    await db.query("update public.wishlist_price_alerts set email_lease_until=now()-interval '1 second' where id=$1", [one[0].id])
    expect(await finish(one[0], 'sent')).toBe(false)
    expect(await prepare(one[0])).toEqual({ status: 'lost' })
    const [recovered] = await claim()
    expect(recovered.id).toBe(one[0].id)
    expect(recovered.lease_token).not.toBe(one[0].lease_token)
    expect(await finish(one[0], 'retry')).toBe(false)
    expect(await finish(recovered, 'sent')).toBe(true)
    expect(await finish(recovered, 'sent')).toBe(false)
    expect((await rows()).find((row) => row.id === recovered.id)?.email_attempts).toBe(2)
  })
  it('retry aplica backoff de 15 minutos a 24 horas y no entra en bucle inmediato', async () => {
    await insertAlert()
    let [c] = await claim()
    await finish(c, 'retry')
    let delay = (await db.query<{ seconds: number }>(`select extract(epoch from email_next_attempt_at-now())::float8 as seconds
      from public.wishlist_price_alerts`)).rows[0].seconds
    expect(delay).toBeGreaterThan(895); expect(delay).toBeLessThanOrEqual(900)
    expect(await claim()).toEqual([])
    await db.exec("update public.wishlist_price_alerts set email_attempts=20,email_next_attempt_at=now()-interval '1 second';")
    ;[c] = await claim()
    await finish(c, 'retry')
    delay = (await db.query<{ seconds: number }>(`select extract(epoch from email_next_attempt_at-now())::float8 as seconds
      from public.wishlist_price_alerts`)).rows[0].seconds
    expect(delay).toBeGreaterThan(86395); expect(delay).toBeLessThanOrEqual(86400)
    await expect(finish(c, 'invalid')).rejects.toMatchObject({ code: '22023' })
  })
  it.each(['anon', 'authenticated'])('deniega RPC, leases y escrituras privilegiadas a %s incluso con claims service_role', async (role) => {
    await insertAlert()
    await asUser(alice, role)
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: alice, role: 'service_role' })])
    for (const sql of [
      'select * from public.claim_wishlist_price_checks(8)', 'select * from public.claim_wishlist_alert_email()',
      `select public.prepare_wishlist_alert_email('${alice}','${bob}')`,
      `select public.finish_wishlist_alert_email('${alice}','${bob}','sent')`,
      'select email_lease_token from public.wishlist_price_alerts',
      'select price_checked_at from public.wishlist_items',
      "update public.wishlist_price_alerts set email_state='sent'", 'update public.wishlist_items set price_checked_at=now()',
      'select email from auth.users',
    ]) await expect(db.query(sql)).rejects.toMatchObject({ code: '42501' })
  })
  it('mantiene RLS, lectura propia y UPDATE(read_at/target_price) sin ampliar INSERT', async () => {
    await insertAlert()
    await asUser()
    expect((await db.query('select id,observed_price from public.wishlist_price_alerts')).rows).toHaveLength(1)
    expect((await db.query('update public.wishlist_price_alerts set read_at=now() returning id')).rows).toHaveLength(1)
    expect((await db.query('update public.wishlist_items set target_price=11 returning target_price')).rows).toHaveLength(1)
    await expect(db.query(`insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot,target_price)
      values('${list}','${alice}','base1-1','en','{}',10)`)).rejects.toMatchObject({ code: '42501' })
    await asUser(bob)
    expect((await db.query('select id from public.wishlist_price_alerts')).rows).toEqual([])
    expect((await db.query('update public.wishlist_price_alerts set read_at=now() returning id')).rows).toEqual([])
    expect((await db.query('select card_id from public.wishlist_items')).rows).toEqual([])
    await asUser(alice, 'authenticated', true)
    expect((await db.query('select id from public.wishlist_price_alerts')).rows).toEqual([])
    await db.exec('reset role;')
    const tables = (await db.query(`select relrowsecurity,relforcerowsecurity from pg_class
      where oid in ('public.wishlists'::regclass,'public.wishlist_items'::regclass,'public.wishlist_price_alerts'::regclass)`)).rows
    expect(tables).toEqual(Array(3).fill({ relrowsecurity: true, relforcerowsecurity: true }))
    const functions = (await db.query<{ prosecdef: boolean; proconfig: string[]; public_execute: boolean }>(`
      select p.prosecdef,p.proconfig,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
      from pg_proc p where p.proname in ('claim_wishlist_price_checks','claim_wishlist_alert_email','prepare_wishlist_alert_email','finish_wishlist_alert_email')`)).rows
    expect(functions).toHaveLength(4)
    for (const f of functions) expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=pg_catalog'], public_execute: false })
  })
  it('páginas acotadas progresan más allá de 1000 aunque todos los precios sean iguales', async () => {
    await db.exec('reset role;')
    await db.query(`insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot,target_price)
      select $1,$2,'card-'||n,'en',jsonb_build_object('id','card-'||n,'name','Carta','localId',n::text),10
      from generate_series(1,1005) n`, [list, alice])
    await db.exec('set role service_role;')
    const seen = new Set<string>()
    for (let page = 0; page < 130; page++) {
      const items = (await db.query<{ card_id: string }>('select * from public.claim_wishlist_price_checks(10000)')).rows
      expect(items.length).toBeLessThanOrEqual(8)
      if (!items.length) break
      for (const item of items) { expect(seen.has(item.card_id)).toBe(false); seen.add(item.card_id) }
    }
    expect(seen.size).toBe(1006)
    expect((await db.query('select * from public.claim_wishlist_price_checks(8)')).rows).toEqual([])
    await db.exec("update public.wishlist_items set price_checked_at=now()-interval '61 minutes';")
    expect((await db.query('select * from public.claim_wishlist_price_checks(8)')).rows).toHaveLength(8)
  })
})

describe('Cron + SQL real en memoria (sin red ni correo real)', () => {
  it('cron antiguo inserta sin email_state DESPUÉS de 010: legacy, sin claim ni SMTP del nuevo cron', async () => {
    const id = await insertLegacyAlert()
    const before = await rows()
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ id, email_state: 'legacy', email_attempts: 0, email_sent_at: null })
    expect(await claim()).toEqual([])
    // El nuevo cron vuelve a observar el mismo precio: DO NOTHING debe conservar legacy.
    expect(await runCron()).toMatchObject({ status: 200, checked: 1, alerted: 0, claimed: 0, emailed: 0 })
    expect(await rows()).toEqual(before)
    expect(await claim()).toEqual([])
    expect(bridge.sendMail).not.toHaveBeenCalled()
  })
  it.each(['pending', 'retry', 'sending', 'sent', 'skipped', 'failed', 'legacy'])(
    'upsert duplicado con pending explícito no resetea %s ni intentos, backoff, ACK o lease', async (state) => {
      if (state === 'legacy') await insertLegacyAlert()
      else {
        await insertAlert()
        if (state !== 'pending') {
          const [c] = await claim()
          if (state !== 'sending') expect(await finish(c, state)).toBe(true)
        }
      }
      const before = await rows()
      expect(before[0].email_state).toBe(state === 'retry' ? 'pending' : state)
      // Aislar la inserción de precios: no permitir que los trabajadores modifiquen la fila.
      vi.stubEnv('SMTP_PASS', '')
      for (let attempt = 0; attempt < 2; attempt++) {
        await db.exec("update public.wishlist_items set price_checked_at=now()-interval '61 minutes';")
        expect(await runCron()).toMatchObject({ status: 200, checked: 1, alerted: 0, claimed: 0, errors: 0 })
        expect(await rows()).toEqual(before)
      }
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(bridge.sendMail).not.toHaveBeenCalled()
    })
  it.each(['provider_failure', 'price_rebound', 'same_low_price'])('SMTP transitorio → retry posterior con %s → sin reenvío', async (scenario) => {
    bridge.sendMail.mockRejectedValueOnce(Object.assign(new Error('temporary'), { responseCode: 451 }))
    const first = await runCron()
    expect(first).toMatchObject({ status: 200, alerted: 1, claimed: 1, emailed: 0, retried: 1 })
    expect((await rows())[0]).toMatchObject({ email_state: 'pending', email_attempts: 1 })
    expect((await runCron()).claimed).toBe(0)
    expect(bridge.sendMail).toHaveBeenCalledTimes(1)
    await db.exec(`update public.wishlist_price_alerts set email_next_attempt_at=now()-interval '1 second';
      update public.wishlist_items set price_checked_at=now()-interval '61 minutes';`)
    if (scenario === 'provider_failure') vi.mocked(fetch).mockRejectedValue(new Error('provider down'))
    if (scenario === 'price_rebound') vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ pricing: { cardmarket: { trend: 99 } } }) } as Response)
    const second = await runCron()
    expect(second).toMatchObject({ status: 200, alerted: 0, emailed: 1, smtpAccepted: 1 })
    expect((await rows())[0]).toMatchObject({ email_state: 'sent', email_attempts: 2, email_lease_token: null })
    expect((await rows())[0].email_sent_at).not.toBeNull()
    expect((await runCron()).emailed).toBe(0)
    expect(bridge.sendMail).toHaveBeenCalledTimes(2)
    expect(bridge.sendMail.mock.calls[1][0].text).toContain('8.00')
  })
  it('dos crons simultáneos no envían dos veces una alerta', async () => {
    await insertAlert()
    const result = await Promise.all([runCron(), runCron()])
    expect(result.reduce((sum, r) => sum + r.emailed, 0)).toBe(1)
    expect(bridge.sendMail).toHaveBeenCalledTimes(1)
  })
  it.each(['optout', 'string_optin', 'changed_target', 'null_target', 'deleted_item', 'deleted_user'])('revalida %s después de reclamar, antes de SMTP', async (scenario) => {
    await insertAlert()
    const [c] = await claim()
    await db.exec('reset role;')
    const changes: Record<string, string> = {
      optout: `update auth.users set raw_user_meta_data='{"price_alert_email":false}' where id='${alice}'`,
      string_optin: `update auth.users set raw_user_meta_data='{"price_alert_email":"true"}' where id='${alice}'`,
      changed_target: 'update public.wishlist_items set target_price=9',
      null_target: 'update public.wishlist_items set target_price=null',
      deleted_item: 'delete from public.wishlist_items',
      deleted_user: `delete from auth.users where id='${alice}'`,
    }
    await db.exec(changes[scenario]); await db.exec('set role service_role;')
    expect((await prepare(c)).status).toBe(scenario.startsWith('deleted_') ? 'lost' : 'skipped')
    if (!scenario.startsWith('deleted_')) {
      expect((await rows())[0].email_state).toBe('skipped')
      // Evitar nuevos avisos por el objetivo cambiado; solo interesa esta cola.
      await db.exec('update public.wishlist_items set price_checked_at=now();')
    }
    expect((await runCron()).emailed).toBe(0)
    expect(bridge.sendMail).not.toHaveBeenCalled()
  })
  it('optout en el cron omite la cola definitivamente y usa correo actual cuando está activo', async () => {
    await insertAlert()
    await db.exec(`reset role; update auth.users set raw_user_meta_data='{}' where id='${alice}'; set role service_role;`)
    expect(await runCron()).toMatchObject({ skipped: 1, emailed: 0 })
    await db.exec(`reset role; update auth.users set raw_user_meta_data='{"price_alert_email":true}',email='changed@example.test'
      where id='${alice}'; set role service_role;`)
    expect((await runCron()).claimed).toBe(0)
    await insertAlert(9)
    await db.exec('update public.wishlist_items set target_price=9;')
    expect((await runCron()).emailed).toBe(1)
    expect(bridge.sendMail.mock.calls[0][0].to).toEqual({ address: 'changed@example.test', name: '' })
  })
  it('sin SMTP preserva pendientes y sus intentos, también los recién creados', async () => {
    vi.stubEnv('SMTP_PASS', '')
    expect(await runCron()).toMatchObject({ alerted: 1, claimed: 0, emailed: 0, smtpConfigured: false })
    expect((await rows())[0]).toMatchObject({ email_state: 'pending', email_attempts: 0 })
    expect(bridge.sendMail).not.toHaveBeenCalled()
    vi.stubEnv('SMTP_PASS', 'test-only')
    expect((await runCron()).emailed).toBe(1)
  })
  it('fallo DB tras aceptación SMTP no cuenta como emailed y deja lease recuperable', async () => {
    failAck = true
    expect(await runCron()).toMatchObject({ status: 502, smtpAccepted: 1, emailed: 0, errors: 1 })
    expect((await rows())[0].email_state).toBe('sending')
    expect((await runCron()).claimed).toBe(0)
    failAck = false
    await db.exec("update public.wishlist_price_alerts set email_lease_until=now()-interval '1 second';")
    expect((await runCron()).emailed).toBe(1)
    // Demuestra explícitamente la ventana de duplicación SMTP aceptada por diseño.
    expect(bridge.sendMail).toHaveBeenCalledTimes(2)
  })
  it('5xx SMTP termina en failed, sin reintentos infinitos', async () => {
    bridge.sendMail.mockRejectedValue(Object.assign(new Error('invalid recipient'), { responseCode: 550 }))
    expect(await runCron()).toMatchObject({ failed: 1, emailed: 0 })
    expect((await rows())[0].email_state).toBe('failed')
    expect((await runCron()).claimed).toBe(0)
  })
})
