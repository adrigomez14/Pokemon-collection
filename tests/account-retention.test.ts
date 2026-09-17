import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { entry } from './fixtures'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const sql005 = readFileSync(new URL('../supabase/migrations/005_account_and_retention.sql', import.meta.url), 'utf8')
const sql006 = readFileSync(new URL('../supabase/migrations/006_schedule_feedback_retention.sql', import.meta.url), 'utf8')
let db: PGlite

const passwordAMR = (offset = 0) => [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) + offset }]
const claims = (id: string = alice) => ({ sub: id, role: 'authenticated', is_anonymous: false, amr: passwordAMR() })

async function asClaims(jwt: Record<string, unknown>, role: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec('reset role;')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(jwt)])
  // Solo dos roles constantes de prueba; nunca interpolar un rol recibido por la aplicación.
  await db.exec(role === 'anon' ? 'set role anon;' : 'set role authenticated;')
}
const remove = (confirmation: string | null = 'ELIMINAR') => db.query('select public.delete_own_account($1::text)', [confirmation])

async function snapshot() {
  await db.exec('reset role;')
  return {
    users: (await db.query<{ id: string }>('select id from auth.users order by id')).rows,
    collection: (await db.query<{ id: string; user_id: string; quantity: number; notes: string }>('select id, user_id, quantity, notes from public.collection_entries order by id')).rows,
    feedback: (await db.query<{ id: string; user_id: string | null; message: string; created_at: Date }>('select id, user_id, message, created_at from public.feedback order by id')).rows,
  }
}

async function seed() {
  await db.exec(`reset role; drop trigger if exists block_test_delete on auth.users;
    delete from public.feedback; delete from auth.users;
    insert into auth.users values ('${alice}'), ('${bob}');`)
  for (const id of [alice, bob]) {
    await asClaims(claims(id))
    await db.query('select public.add_collection_entry($1::jsonb)', [JSON.stringify(entry)])
    await db.exec("reset role; update pokefolio_private.feedback_quota set last_message='-infinity',hour_count=0,day_count=0;")
    await db.query('insert into public.feedback(message) values($1)', [`contact-${id}`])
  }
  await asClaims({ role: 'anon' }, 'anon')
  await db.exec("reset role; update pokefolio_private.feedback_quota set last_message='-infinity',hour_count=0,day_count=0;")
  await db.query("insert into public.feedback(message) values('anonymous-contact')")
}

beforeAll(async () => {
  db = new PGlite()
  // Estos stubs solo existen en la base WASM aislada. En producción los claims
  // proceden de un JWT firmado y verificado por PostgREST, no del navegador sin validar.
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
  `)
  for (const file of ['001_collection.sql', '002_cardmarket_links.sql', '003_feedback.sql', '004_feedback_limits.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  await seed()
  const before = await snapshot()
  await db.exec(sql005)
  expect(await snapshot()).toEqual(before)
  await db.exec(sql005)
  expect(await snapshot()).toEqual(before)
})
beforeEach(async () => { await seed() })
afterAll(async () => { await db?.close() })

describe('RPC de cuenta: permisos, reautenticación y transacciones', () => {
  it('desplegar y repetir 005 conserva usuarios, colecciones y mensajes', async () => {
    const before = await snapshot()
    await db.exec(sql005)
    expect(await snapshot()).toEqual(before)
  })

  it.each([alice, bob])('solo borra la cuenta autenticada %s y sus datos asociados', async (id) => {
    const otherId = id === alice ? bob : alice
    const before = await snapshot()
    await asClaims({ ...claims(id), user_metadata: { user_id: otherId, sub: otherId } })
    await remove()
    const after = await snapshot()
    expect(after.users).toEqual([{ id: otherId }])
    expect(after.collection).toEqual(before.collection.filter((row) => row.user_id === otherId))
    expect(after.feedback).toEqual(before.feedback.filter((row) => row.user_id !== id))
  })

  it('no acepta un ID objetivo libre ni permite borrar auth.users directamente', async () => {
    const before = await snapshot()
    await asClaims(claims())
    await expect(db.query('select public.delete_own_account($1::text, $2::uuid)', ['ELIMINAR', bob])).rejects.toThrow()
    await expect(db.query('delete from auth.users where id=$1', [bob])).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })

  it.each(['eliminar', ' ELIMINAR', 'ELIMINAR ', '', null])('confirmación %j no borra nada', async (confirmation) => {
    const before = await snapshot()
    await asClaims(claims())
    await expect(remove(confirmation)).rejects.toThrow('confirmación ELIMINAR')
    expect(await snapshot()).toEqual(before)
  })

  it.each([
    ['sin amr', undefined],
    ['vacío', []],
    ['objeto en vez de lista', { method: 'password', timestamp: 123 }],
    ['texto', 'password'],
    ['null', null],
    ['entrada null', [null]],
    ['timestamp ausente', [{ method: 'password' }]],
    ['timestamp texto', [{ method: 'password', timestamp: '123' }]],
    ['timestamp inválido', [{ method: 'password', timestamp: 'not-a-date' }]],
    ['timestamp objeto', [{ method: 'password', timestamp: {} }]],
    ['timestamp enorme', [{ method: 'password', timestamp: 1e30 }]],
    ['timestamp negativo', [{ method: 'password', timestamp: -1 }]],
  ])('rechaza AMR %s sin alterar datos', async (_label, amr) => {
    const before = await snapshot()
    await asClaims({ ...claims(), amr })
    await expect(remove()).rejects.toThrow('Verifica de nuevo tu contraseña')
    expect(await snapshot()).toEqual(before)
  })

  it.each([-301, -3600, 61, 3600])('rechaza contraseña fuera de ventana (%s segundos)', async (offset) => {
    await asClaims({ ...claims(), amr: passwordAMR(offset) })
    await expect(remove()).rejects.toThrow('Verifica de nuevo tu contraseña')
    expect((await snapshot()).users).toHaveLength(2)
  })

  it.each([-240, 30])('admite contraseña dentro de ventana (%s segundos)', async (offset) => {
    await asClaims({ ...claims(), amr: passwordAMR(offset) })
    await expect(remove()).resolves.toBeDefined()
    expect((await snapshot()).users).toEqual([{ id: bob }])
  })

  it('un JWT renovado recientemente no sustituye una contraseña reciente', async () => {
    await asClaims({ ...claims(), iat: Math.floor(Date.now() / 1000), amr: [
      ...passwordAMR(-3600), { method: 'token_refresh', timestamp: Math.floor(Date.now() / 1000) },
    ], user_metadata: { amr: passwordAMR() } })
    await expect(remove()).rejects.toThrow('Verifica de nuevo tu contraseña')
    expect((await snapshot()).users).toHaveLength(2)
  })

  it.each(['oauth', 'recovery', 'magiclink', 'token_refresh', 'anonymous'])('el método %s no equivale a password', async (method) => {
    await asClaims({ ...claims(), amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }] })
    await expect(remove()).rejects.toThrow('Verifica de nuevo tu contraseña')
  })

  it('deniega el rol anon incluso con claims que imitan una cuenta autenticada', async () => {
    await asClaims(claims(), 'anon')
    await expect(remove()).rejects.toThrow('permission denied')
  })

  it.each([
    { ...claims(), sub: null },
    { ...claims(), role: 'anon' },
    { ...claims(), role: 'service_role' },
    { ...claims(), role: null },
    { ...claims(), is_anonymous: true },
  ])('valida UID, rol firmado y cuenta no anónima: %j', async (jwt) => {
    await asClaims({ ...jwt, amr: passwordAMR() })
    await expect(remove()).rejects.toThrow('Se requiere una cuenta autenticada')
    expect((await snapshot()).users).toHaveLength(2)
  })

  it('revierte el borrado previo de mensajes si falla el borrado de auth.users', async () => {
    const before = await snapshot()
    await db.exec(`create or replace function public.block_account_delete_test() returns trigger language plpgsql as
      $$ begin raise exception 'simulated delete failure'; end; $$;
      create trigger block_test_delete before delete on auth.users for each row execute function public.block_account_delete_test();`)
    await asClaims(claims())
    await expect(remove()).rejects.toThrow('simulated delete failure')
    expect(await snapshot()).toEqual(before)
  })

  it('rechaza la repetición con una cuenta ya eliminada', async () => {
    await asClaims(claims())
    await remove()
    await expect(remove()).rejects.toThrow('No se ha encontrado la cuenta')
    expect((await snapshot()).users).toEqual([{ id: bob }])
  })

  it('fija propietario y search_path vacío y no permite funciones privilegiadas a PUBLIC', async () => {
    await db.exec('reset role;')
    const { rows } = await db.query<{ name: string; owner: string; definer: boolean; config: string[] }>(`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer, p.proconfig as config
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='public' and p.proname='delete_own_account')
        or (n.nspname='pokefolio_private' and p.proname='purge_feedback')`)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.owner).toBe('postgres')
      expect(row.definer).toBe(true)
      expect(row.config).toContain('search_path=""')
    }
    const grants = await db.query<{ name: string; grantee: number }>(`
      select p.proname as name, acl.grantee from pg_proc p
      cross join lateral aclexplode(p.proacl) acl
      where p.oid in ('public.delete_own_account(text)'::regprocedure, 'pokefolio_private.purge_feedback()'::regprocedure)
        and acl.grantee=0`)
    expect(grants.rows).toEqual([])
  })
})

describe('Retención de contacto y programación separada', () => {
  it('purga únicamente mensajes anteriores a seis meses y devuelve el recuento', async () => {
    await db.exec(`reset role; begin;
      update public.feedback set created_at = now() - interval '7 months' where user_id='${alice}';
      update public.feedback set created_at = now() - interval '6 months' where user_id='${bob}';
      update public.feedback set created_at = now() - interval '1 day' where user_id is null;`)
    const before = await snapshot()
    const { rows } = await db.query<{ count: number }>('select pokefolio_private.purge_feedback() as count')
    expect(rows).toEqual([{ count: 1 }])
    const after = await snapshot()
    expect(after.users).toEqual(before.users)
    expect(after.collection).toEqual(before.collection)
    expect(after.feedback).toEqual(before.feedback.filter((row) => row.user_id !== alice))
    expect((await db.query('select pokefolio_private.purge_feedback() as count')).rows).toEqual([{ count: 0 }])
    await db.exec('commit;')
  })

  it('aplica la retención también a mensajes anónimos antiguos', async () => {
    await db.exec("reset role; update public.feedback set created_at=now()-interval '7 months' where user_id is null;")
    expect((await db.query('select pokefolio_private.purge_feedback() as count')).rows).toEqual([{ count: 1 }])
    expect((await snapshot()).feedback).toHaveLength(2)
  })

  it.each(['anon', 'authenticated'] as const)('impide ejecutar la purga al rol %s', async (role) => {
    await asClaims(claims(), role)
    await expect(db.query('select pokefolio_private.purge_feedback()')).rejects.toThrow('permission denied')
    expect((await snapshot()).feedback).toHaveLength(3)
  })

  it('revoca EXECUTE además del acceso al esquema privado', async () => {
    await db.exec('reset role;')
    const { rows } = await db.query<{ role: string; allowed: boolean }>(`
      select role, has_function_privilege(role, 'pokefolio_private.purge_feedback()', 'execute') as allowed
      from (values ('anon'), ('authenticated'), ('postgres')) as roles(role)`)
    expect(rows).toEqual([{ role: 'anon', allowed: false }, { role: 'authenticated', allowed: false }, { role: 'postgres', allowed: true }])
  })

  it('006 contiene un único job diario y no ejecuta pg_cron en PGlite', () => {
    const executable = sql006.replace(/--[^\n]*/g, '')
    expect(executable).toMatch(/create extension if not exists pg_cron with schema pg_catalog;/i)
    expect(executable).toMatch(/current_user <> 'postgres'/)
    expect(executable).toMatch(/cron\.schedule\(\s*'pokefolio-feedback-retention',\s*'17 3 \* \* \*',\s*'select pokefolio_private\.purge_feedback\(\);'\s*\)/)
    expect(executable.match(/cron\.schedule\(/g)).toHaveLength(1)
    expect(executable.match(/purge_feedback\(\);/g)).toHaveLength(1)
    expect(executable).not.toMatch(/delete\s+from|drop\s+extension|cron\.unschedule/i)
    expect(executable.trim()).toMatch(/^begin;[\s\S]*commit;$/)
  })
})
