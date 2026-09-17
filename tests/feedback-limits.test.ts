import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let db: PGlite
const insert = () => db.query("insert into public.feedback(topic,email,message) values('sugerencia','visitor@example.com','Mensaje de prueba')")
async function anon() { await db.exec('reset role; set role anon;') }
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/003_feedback.sql', import.meta.url), 'utf8'))
  await anon(); await insert(); await db.exec('reset role;')
  await db.exec(readFileSync(new URL('../supabase/migrations/004_feedback_limits.sql', import.meta.url), 'utf8'))
  expect((await db.query('select id from public.feedback')).rows).toHaveLength(1)
})
beforeEach(async () => {
  await db.exec(`reset role; delete from public.feedback;
    update pokefolio_private.feedback_quota set hour_start='-infinity',day_start='-infinity',last_message='-infinity',hour_count=0,day_count=0;`)
  await anon()
})
afterAll(async () => { await db?.close() })

describe('Cuotas persistentes y privacidad del contacto', () => {
  it('permite insertar pero no consultar, editar ni borrar mensajes', async () => {
    await insert()
    await expect(db.query('select * from public.feedback')).rejects.toThrow()
    await expect(db.query("update public.feedback set message='otro'")).rejects.toThrow()
    await expect(db.query('delete from public.feedback')).rejects.toThrow()
    await expect(db.query('select * from pokefolio_private.feedback_quota')).rejects.toThrow()
    await expect(db.query('select pokefolio_private.guard_feedback_rate()')).rejects.toThrow()
  })
  it('no permite asignar propietario ni fecha para evadir los límites', async () => {
    await expect(db.query("insert into public.feedback(message,created_at) values('prueba','2000-01-01')")).rejects.toThrow()
    await expect(db.query("insert into public.feedback(message,user_id) values('prueba',null)")).rejects.toThrow()
  })
  it('rechaza envíos consecutivos y conserva el mensaje aceptado', async () => {
    await insert()
    await expect(insert()).rejects.toThrow('feedback_rate_limit')
    await db.exec('reset role;')
    expect((await db.query('select id from public.feedback')).rows).toHaveLength(1)
  })
  it('bloquea el límite horario aunque cambie el rol', async () => {
    await db.exec("reset role; update pokefolio_private.feedback_quota set hour_start=date_trunc('hour',now()),hour_count=10;")
    await anon(); await expect(insert()).rejects.toThrow('feedback_rate_limit')
    await db.exec('reset role; set role authenticated;')
    await expect(insert()).rejects.toThrow('feedback_rate_limit')
  })
  it('bloquea el límite diario aunque cambie la hora', async () => {
    await db.exec("reset role; update pokefolio_private.feedback_quota set day_start=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',day_count=50;")
    await anon(); await expect(insert()).rejects.toThrow('feedback_rate_limit')
  })
  it('restablece cuotas al pasar sus ventanas y no las consume ante un error', async () => {
    await db.exec("reset role; update pokefolio_private.feedback_quota set hour_start=now()-interval '2 days',day_start=now()-interval '2 days',hour_count=10,day_count=50;")
    await anon()
    await expect(db.query("insert into public.feedback(message,topic) values('x','invalid')")).rejects.toThrow()
    await insert()
    await db.exec('reset role;')
    expect((await db.query('select hour_count,day_count from pokefolio_private.feedback_quota')).rows).toEqual([{ hour_count: 1, day_count: 1 }])
  })
})