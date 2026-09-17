import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { entry } from './fixtures'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const sql007 = readFileSync(new URL('../supabase/migrations/007_wishlists.sql', import.meta.url), 'utf8')
const card = { id: 'base1-1', name: 'Alakazam', localId: '1', image: 'https://assets.tcgdex.net/en/base/base1/1' }
const jwt = (id = alice) => ({ sub: id, role: 'authenticated', is_anonymous: false,
  amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
})
let db: PGlite
let aliceList: string
let aliceOtherList: string
let bobList: string

async function asClaims(claims: Record<string, unknown>, role: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec('reset role;')
  // Stubs exclusivos de WASM: en Supabase solo PostgREST fija claims de un JWT verificado.
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)])
  await db.exec(role === 'anon' ? 'set role anon;' : 'set role authenticated;')
}
async function createList(userId = alice, name: string | null = 'Favoritas') {
  const { rows } = await db.query<{ id: string }>('insert into public.wishlists(user_id,name) values($1,$2) returning id', [userId, name])
  return rows[0].id
}
function addItem(listId = aliceList, userId = alice, snapshot: unknown = card, language: string | null = 'en', cardId: string | null = card.id) {
  return db.query(`insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot)
    values($1,$2,$3,$4,$5::jsonb) on conflict(list_id,card_id,language) do nothing`,
  [listId, userId, cardId, language, JSON.stringify(snapshot)])
}
async function legacySnapshot() {
  await db.exec('reset role;')
  return {
    users: (await db.query<{ id: string }>('select * from auth.users order by id')).rows,
    collection: (await db.query<{ user_id: string }>('select * from public.collection_entries order by id')).rows,
    feedback: (await db.query<{ user_id: string | null }>('select * from public.feedback order by id')).rows,
    quota: (await db.query('select * from pokefolio_private.feedback_quota')).rows,
  }
}
async function wishlistSnapshot() {
  await db.exec('reset role;')
  return {
    lists: (await db.query<{ id: string; user_id: string }>('select * from public.wishlists order by id')).rows,
    items: (await db.query<{ list_id: string; user_id: string }>('select * from public.wishlist_items order by list_id,card_id,language')).rows,
  }
}
async function seedBase() {
  await db.exec(`reset role; delete from public.feedback; delete from auth.users;
    insert into auth.users values ('${alice}'), ('${bob}');`)
  for (const id of [alice, bob]) {
    await asClaims(jwt(id))
    await db.query('select public.add_collection_entry($1::jsonb)', [JSON.stringify(entry)])
    await db.exec("reset role; update pokefolio_private.feedback_quota set last_message='-infinity',hour_count=0,day_count=0;")
    await asClaims(jwt(id))
    await db.query('insert into public.feedback(message) values($1)', [`contact-${id}`])
  }
}

beforeAll(async () => {
  db = new PGlite()
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
  // Solo una base local en memoria. 006 requiere pg_cron y NO se ejecuta aquí.
  for (const file of ['001_collection.sql', '002_cardmarket_links.sql', '003_feedback.sql', '004_feedback_limits.sql', '005_account_and_retention.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  await seedBase()
  const before = await legacySnapshot()
  await db.exec(sql007)
  expect(await legacySnapshot()).toEqual(before)
})
beforeEach(async () => {
  await seedBase()
  await asClaims(jwt())
  aliceList = await createList()
  aliceOtherList = await createList(alice, 'Otra lista')
  await addItem()
  await addItem(aliceOtherList)
  await asClaims(jwt(bob))
  bobList = await createList(bob)
  await addItem(bobList, bob)
  await asClaims(jwt())
})
afterAll(async () => { await db?.close() })

describe('Migración privada y permisos mínimos', () => {
  it('007 es transaccional, no cambia datos antiguos y falla si se repite', async () => {
    const executable = sql007.replace(/--[^\n]*/g, '')
    expect(executable.trim()).toMatch(/^begin;[\s\S]*commit;$/i)
    expect(executable).not.toMatch(/if\s+not\s+exists|create\s+or\s+replace|\b(delete\s+from|truncate|drop)\b/i)
    expect(executable).not.toMatch(/collection_entries|feedback|cron\./i)
    const legacy = await legacySnapshot()
    const before = await wishlistSnapshot()
    await expect(db.exec(sql007)).rejects.toMatchObject({ code: '42P07' })
    await db.exec('rollback;')
    expect(await legacySnapshot()).toEqual(legacy)
    expect(await wishlistSnapshot()).toEqual(before)
  })
  it('activa y fuerza RLS en ambas tablas y no concede nada a PUBLIC', async () => {
    await db.exec('reset role;')
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      select relname,relrowsecurity,relforcerowsecurity from pg_class
      where oid in ('public.wishlists'::regclass,'public.wishlist_items'::regclass) order by relname`)
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true })
    expect((await db.query(`select acl.grantee from pg_class c cross join lateral aclexplode(c.relacl) acl
      where c.oid in ('public.wishlists'::regclass,'public.wishlist_items'::regclass) and acl.grantee=0`)).rows).toEqual([])
    expect((await db.query(`select has_table_privilege('authenticated','public.wishlist_items','UPDATE') as update,
      has_table_privilege('authenticated','public.wishlists','TRUNCATE') as truncate,
      has_column_privilege('authenticated','public.wishlists','name','UPDATE') as rename`)).rows).toEqual([{ update: false, truncate: false, rename: true }])
  })
  it.each(['id', 'user_id', 'created_at'])('no permite actualizar identidad o fecha de listas: %s', async (column) => {
    const statements: Record<string, string> = {
      id: `update public.wishlists set id='${bob}'`,
      user_id: `update public.wishlists set user_id='${bob}'`,
      created_at: 'update public.wishlists set created_at=now()',
    }
    await expect(db.query(statements[column])).rejects.toMatchObject({ code: '42501' })
  })
  it.each(['list_id', 'user_id', 'card_id', 'language', 'card_snapshot', 'created_at'])('no permite actualizar deseos: %s', async (column) => {
    // Identificador obtenido de una lista constante de prueba, nunca de entrada externa.
    await expect(db.query(`update public.wishlist_items set ${column}=${column}`)).rejects.toMatchObject({ code: '42501' })
  })
  it('no permite fijar identificadores ni fechas generadas por la base', async () => {
    await expect(db.query('insert into public.wishlists(id,user_id,name) values($1,$2,$3)', [bob, alice, 'X'])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('insert into public.wishlists(user_id,name,created_at) values($1,$2,now())', [alice, 'X'])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query(`insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot,created_at)
      values($1,$2,$3,'es',$4,now())`, [aliceList, alice, card.id, JSON.stringify(card)])).rejects.toMatchObject({ code: '42501' })
  })
})

describe('Propiedad, RLS y listas múltiples', () => {
  it('cada cuenta solo lee sus propias listas y deseos, incluso sin filtros cliente', async () => {
    expect((await db.query('select id from public.wishlists')).rows).toHaveLength(2)
    expect((await db.query('select list_id from public.wishlist_items')).rows).toHaveLength(2)
    await asClaims(jwt(bob))
    expect((await db.query('select id from public.wishlists')).rows).toEqual([{ id: bobList }])
    expect((await db.query('select list_id from public.wishlist_items')).rows).toEqual([{ list_id: bobList }])
  })
  it('renombra y borra únicamente filas propias aunque se omitan filtros', async () => {
    expect((await db.query("update public.wishlists set name='Renombrada' returning id")).rows).toHaveLength(2)
    expect((await db.query('delete from public.wishlist_items returning list_id')).rows).toHaveLength(2)
    expect((await db.query('delete from public.wishlists returning id')).rows).toHaveLength(2)
    await asClaims(jwt(bob))
    expect((await db.query('select name from public.wishlists')).rows).toEqual([{ name: 'Favoritas' }])
    expect((await db.query('select list_id from public.wishlist_items')).rows).toEqual([{ list_id: bobList }])
  })
  it('bloquea suplantación de propietario y la inyección en una lista ajena', async () => {
    await expect(createList(bob)).rejects.toMatchObject({ code: '42501' })
    await expect(addItem(bobList, bob, card, 'es')).rejects.toMatchObject({ code: '42501' })
    // user_id propio supera RLS, pero la FK compuesta impide enlazar la lista de Bob.
    await expect(addItem(bobList, alice, card, 'es')).rejects.toMatchObject({ code: '23503' })
    await expect(addItem('99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({ code: '23503' })
  })
  it('no actualiza ni elimina filas ajenas con un identificador conocido', async () => {
    expect((await db.query("update public.wishlists set name='Ataque' where id=$1 returning id", [bobList])).rows).toEqual([])
    expect((await db.query('delete from public.wishlists where id=$1 returning id', [bobList])).rows).toEqual([])
    expect((await db.query('delete from public.wishlist_items where list_id=$1 returning list_id', [bobList])).rows).toEqual([])
  })
  it('añadir es idempotente y no sustituye la ficha ni la fecha originales', async () => {
    const before = (await db.query('select * from public.wishlist_items where list_id=$1', [aliceList])).rows
    await addItem(aliceList, alice, { ...card, name: 'No sobrescribir' })
    await addItem()
    expect((await db.query('select * from public.wishlist_items where list_id=$1', [aliceList])).rows).toEqual(before)
    await addItem(aliceList, alice, card, 'es')
    await addItem(aliceList, alice, card, 'ja')
    expect((await db.query('select language from public.wishlist_items where list_id=$1 order by language', [aliceList])).rows).toEqual([{ language: 'en' }, { language: 'es' }, { language: 'ja' }])
    expect((await db.query('select list_id from public.wishlist_items where list_id=$1', [aliceOtherList])).rows).toHaveLength(1)
    await expect(db.query(`insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot)
      values($1,$2,$3,'en',$4)`, [aliceList, alice, card.id, JSON.stringify(card)])).rejects.toMatchObject({ code: '23505' })
  })
  it('no toca la colección poseída al añadir, renombrar o borrar deseos', async () => {
    const before = await legacySnapshot()
    await asClaims(jwt())
    await addItem(aliceList, alice, card, 'es')
    const extra = await createList(alice, 'Otra')
    await addItem(extra)
    await db.query("update public.wishlists set name='Nueva' where id=$1", [extra])
    await db.query('delete from public.wishlist_items where list_id=$1 and card_id=$2 and language=$3', [aliceList, card.id, 'es'])
    await db.query('delete from public.wishlists where id=$1', [extra])
    expect(await legacySnapshot()).toEqual(before)
  })
  it('borrar una lista elimina solo sus deseos en cascada', async () => {
    await db.query('delete from public.wishlists where id=$1', [aliceList])
    const after = await wishlistSnapshot()
    expect(after.lists.map((row) => row.id).sort()).toEqual([aliceOtherList, bobList].sort())
    expect(after.items.map((row) => row.list_id).sort()).toEqual([aliceOtherList, bobList].sort())
  })
  it('la FK de listas requiere una cuenta existente incluso para el administrador', async () => {
    await db.exec('reset role;')
    await expect(createList('99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({ code: '23503' })
  })
})

describe('Anon y cuentas autenticadas anónimas', () => {
  it.each([{}, jwt()])('el rol anon carece de todos los permisos incluso con claims falsificados %#', async (claims) => {
    await asClaims(claims, 'anon')
    await expect(db.query('select * from public.wishlists')).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select * from public.wishlist_items')).rejects.toMatchObject({ code: '42501' })
    await expect(createList()).rejects.toMatchObject({ code: '42501' })
    await expect(addItem()).rejects.toMatchObject({ code: '42501' })
    await expect(db.query("update public.wishlists set name='X'")).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('delete from public.wishlists')).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('delete from public.wishlist_items')).rejects.toMatchObject({ code: '42501' })
  })
  it.each([
    { ...jwt(), is_anonymous: true },
    { ...jwt(), is_anonymous: null },
    { ...jwt(), is_anonymous: undefined },
    { ...jwt(), is_anonymous: 'false' },
    { ...jwt(), role: 'anon' },
    { ...jwt(), role: undefined },
    { ...jwt(), sub: null },
    { ...jwt(), is_anonymous: true, user_metadata: { is_anonymous: false, role: 'authenticated' } },
  ])('RLS deniega claims no aptos para listas privadas %#', async (claims) => {
    const before = await wishlistSnapshot()
    await asClaims(claims)
    expect((await db.query('select * from public.wishlists')).rows).toEqual([])
    expect((await db.query('select * from public.wishlist_items')).rows).toEqual([])
    await expect(createList()).rejects.toMatchObject({ code: '42501' })
    await expect(addItem(aliceList, alice, card, 'es')).rejects.toMatchObject({ code: '42501' })
    expect((await db.query("update public.wishlists set name='X' returning id")).rows).toEqual([])
    expect((await db.query('delete from public.wishlists returning id')).rows).toEqual([])
    expect((await db.query('delete from public.wishlist_items returning list_id')).rows).toEqual([])
    expect(await wishlistSnapshot()).toEqual(before)
  })
})

describe('Restricciones SQL reales de nombres y JSON', () => {
  it.each(['', ' ', '\t\n', '\u00a0\u2000\ufeff', ' A', 'A ', '\nA', 'A\n', 'a'.repeat(81), null])('rechaza nombre no normalizado %j', async (name) => {
    await expect(createList(alice, name)).rejects.toMatchObject({ code: name === null ? '23502' : '23514' })
  })
  it.each(['a', 'a'.repeat(80), 'Mi lista', '日本語'])('acepta nombre válido %j', async (name) => {
    await expect(createList(alice, name)).resolves.toEqual(expect.any(String))
  })
  it.each([
    null, [], 'text', 123, true, {},
    { name: card.name, localId: card.localId },
    { id: card.id, localId: card.localId },
    { id: card.id, name: card.name },
    { ...card, id: null }, { ...card, name: null }, { ...card, localId: null },
    { ...card, id: 1 }, { ...card, name: 1 }, { ...card, localId: 1 },
    { ...card, name: {} }, { ...card, localId: [] }, { ...card, image: {} },
    { ...card, image: 1 }, { ...card, image: true },
    { ...card, id: 'otra' }, { ...card, name: '' },
    { ...card, name: 'x'.repeat(201) }, { ...card, localId: 'x'.repeat(51) },
    { ...card, quantity: 1 }, { ...card, set: { id: 'base1' } },
    { ...card, pricing: {} }, { ...card, secret: null },
    { ...card, image: '' }, { ...card, image: 'https://evil.example/a' },
    { ...card, image: 'http://assets.tcgdex.net/a' },
    { ...card, image: 'https://assets.tcgdex.net.evil.example/a' },
    { ...card, image: 'https://assets.tcgdex.net@evil.example/a' },
    { ...card, image: 'https://assets.tcgdex.net:443/a' },
    { ...card, image: 'https://assets.tcgdex.net/a?tracking=1' },
    { ...card, image: 'https://assets.tcgdex.net/a#fragment' },
    { ...card, image: 'https://assets.tcgdex.net/a\n' },
    { ...card, image: `https://assets.tcgdex.net/${'a'.repeat(2048)}` },
  ])('rechaza corrupción de snapshot %# sin aceptar NULL en CHECK', async (snapshot) => {
    await expect(addItem(aliceList, alice, snapshot, 'es')).rejects.toThrow()
    expect((await db.query("select * from public.wishlist_items where language='es'")).rows).toEqual([])
  })
  it.each([
    { id: card.id, name: card.name, localId: '' },
    { ...card, image: null }, card, { ...card, image: 'https://assets.tcgdex.net/en/sv/sv03.5/200' },
    { ...card, name: 'x'.repeat(200), localId: 'x'.repeat(50) },
  ])('admite ficha breve, imagen opcional/nula y límites %#', async (snapshot) => {
    await addItem(aliceList, alice, snapshot, 'es')
    expect((await db.query('select card_snapshot from public.wishlist_items where list_id=$1 and language=$2', [aliceList, 'es'])).rows).toEqual([{ card_snapshot: snapshot }])
  })
  it.each(['fr', '', null])('rechaza idioma %j', async (language) => {
    await expect(addItem(aliceList, alice, card, language)).rejects.toThrow()
  })
  it.each(['', 'x'.repeat(101), null])('rechaza identificador %j incluso si coincide con JSON', async (id) => {
    await expect(addItem(aliceList, alice, { ...card, id }, 'es', id)).rejects.toThrow()
  })
  it('rechaza SQL NULL del snapshot además de JSON null', async () => {
    await expect(db.query(`insert into public.wishlist_items(list_id,user_id,card_id,language,card_snapshot)
      values($1,$2,$3,'es',null)`, [aliceList, alice, card.id])).rejects.toMatchObject({ code: '23502' })
  })
})

describe('Borrado de cuenta 005 sin cambiar su SQL', () => {
  it.each([alice, bob])('005 borra en cascada listas/deseos de %s y conserva la otra cuenta', async (id) => {
    const before = await wishlistSnapshot()
    const legacy = await legacySnapshot()
    await asClaims(jwt(id))
    await db.query('select public.delete_own_account($1)', ['ELIMINAR'])
    const after = await wishlistSnapshot()
    expect(after.lists).toEqual(before.lists.filter((row) => row.user_id !== id))
    expect(after.items).toEqual(before.items.filter((row) => row.user_id !== id))
    const remaining = await legacySnapshot()
    expect(remaining.users).toEqual(legacy.users.filter((row) => row.id !== id))
    expect(remaining.collection).toEqual(legacy.collection.filter((row) => row.user_id !== id))
    expect(remaining.feedback).toEqual(legacy.feedback.filter((row) => row.user_id !== id))
  })
  it('una confirmación incorrecta no borra listas ni deseos', async () => {
    const before = await wishlistSnapshot()
    await asClaims(jwt())
    await expect(db.query("select public.delete_own_account('no')")).rejects.toMatchObject({ code: '22023' })
    expect(await wishlistSnapshot()).toEqual(before)
  })
})
