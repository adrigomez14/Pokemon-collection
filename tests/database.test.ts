import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { entry } from './fixtures'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
let db: PGlite
async function asUser(id: string) {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
}
const add = (input: unknown = entry) => db.query('select public.add_collection_entry($1::jsonb)', [JSON.stringify(input)])
const restore = (entries: unknown[]) => db.query('select public.import_collection($1::jsonb)', [JSON.stringify(entries)])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${alice}'), ('${bob}');
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/001_collection.sql', import.meta.url), 'utf8'))
})
beforeEach(async () => {
  await db.exec('reset role; delete from public.collection_entries;')
  await asUser(alice)
})
afterAll(async () => { await db?.close() })

describe('Postgres: persistencia y aislamiento RLS', () => {
  it('guarda y suma cantidades sin crear registros duplicados', async () => {
    await add(); await add()
    const { rows } = await db.query<{ quantity: number; user_id: string }>('select quantity, user_id from public.collection_entries')
    expect(rows).toEqual([{ quantity: 4, user_id: alice }])
  })
  it('un incremento duplicado conserva las notas y el valor manual existentes', async () => {
    await add({ ...entry, manual_value: 7, notes: 'Original' })
    await add({ ...entry, manual_value: 99, notes: 'No sobrescribir' })
    const { rows } = await db.query<{ manual_value: string; notes: string }>('select manual_value, notes from public.collection_entries')
    expect(Number(rows[0].manual_value)).toBe(7)
    expect(rows[0].notes).toBe('Original')
  })
  it('otra cuenta no puede leer, editar ni borrar los registros', async () => {
    await add(); await asUser(bob)
    expect((await db.query('select * from public.collection_entries')).rows).toHaveLength(0)
    expect((await db.query('update public.collection_entries set quantity = 99 returning id')).rows).toHaveLength(0)
    expect((await db.query('delete from public.collection_entries returning id')).rows).toHaveLength(0)
    await asUser(alice)
    expect((await db.query<{ quantity: number }>('select quantity from public.collection_entries')).rows[0].quantity).toBe(2)
  })
  it('no permite insertar en nombre de otra cuenta ni transferir propietarios', async () => {
    await expect(db.query(`insert into public.collection_entries(user_id,card_id,language,variant,condition,quantity,card_snapshot)
      values($1,$2,'en','normal','NM',1,$3)`, [bob, entry.card_id, JSON.stringify(entry.card_snapshot)])).rejects.toThrow()
    await add()
    await expect(db.query('update public.collection_entries set user_id=$1', [bob])).rejects.toThrow()
  })
  it('la RPC ignora el propietario falsificado y utiliza auth.uid', async () => {
    await add({ ...entry, user_id: bob })
    expect((await db.query<{ user_id: string }>('select user_id from public.collection_entries')).rows[0].user_id).toBe(alice)
  })
  it('no permite acceso anónimo a tablas ni funciones', async () => {
    await db.exec('reset role; set role anon;')
    await expect(db.query('select * from public.collection_entries')).rejects.toThrow()
    await expect(add()).rejects.toThrow()
    await expect(restore([entry])).rejects.toThrow()
  })
  it('la importación es idempotente y conserva registros no incluidos', async () => {
    await add({ ...entry, language: 'es' })
    await restore([{ ...entry, quantity: 7 }]); await restore([{ ...entry, quantity: 7 }])
    const { rows } = await db.query<{ language: string; quantity: number }>('select language, quantity from public.collection_entries order by language')
    expect(rows).toEqual([{ language: 'en', quantity: 7 }, { language: 'es', quantity: 2 }])
  })
  it('revierte toda la importación si un registro es inválido', async () => {
    await expect(restore([entry, { ...entry, language: 'es', quantity: -1 }])).rejects.toThrow()
    expect((await db.query('select * from public.collection_entries')).rows).toHaveLength(0)
  })
  it('rechaza desbordamientos sin alterar la cantidad anterior', async () => {
    await add({ ...entry, quantity: 9999 })
    await expect(add()).rejects.toThrow()
    expect((await db.query<{ quantity: number }>('select quantity from public.collection_entries')).rows[0].quantity).toBe(9999)
  })
  it('rechaza una ficha que no coincide con el identificador', async () => {
    await expect(add({ ...entry, card_id: 'otra' })).rejects.toThrow()
  })
})