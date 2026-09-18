-- Aplicar una sola vez después de 007, 008 y 009, antes de desplegar el nuevo cron.
-- Cola privada: SMTP no es transaccional. Aceptación seguida de caída antes del ACK
-- puede duplicar un correo; un lease impide trabajadores simultáneos, no exactly-once.
begin;

alter table public.wishlist_price_alerts
  add column email_state text not null default 'legacy'
    check (email_state in ('legacy', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  add column email_attempts integer not null default 0 check (email_attempts >= 0),
  add column email_lease_token uuid,
  add column email_lease_until timestamptz,
  add column email_next_attempt_at timestamptz not null default now(),
  add column email_sent_at timestamptz,
  add constraint wishlist_email_lease_valid check (
    (email_state = 'sending' and email_lease_token is not null and email_lease_until is not null)
    or (email_state <> 'sending' and email_lease_token is null and email_lease_until is null)
  );
-- Conservar DEFAULT 'legacy' también para INSERT del cron antiguo durante el despliegue:
-- se desconoce si ya envió correo directo. Solo el cron nuevo inserta 'pending' explícito.
-- No modificar ni reencolar los registros legacy existentes.
create index wishlist_email_pending on public.wishlist_price_alerts(email_next_attempt_at, id)
  where email_state = 'pending';
create index wishlist_email_expired on public.wishlist_price_alerts(email_lease_until, id)
  where email_state = 'sending';

-- Último INTENTO de consultar precio (también avanza ante fallo del proveedor).
-- Se marca al reclamar: si el proceso aborta, vuelve a ser elegible tras una hora.
alter table public.wishlist_items add column price_checked_at timestamptz;
create index wishlist_price_check_order on public.wishlist_items
  (price_checked_at nulls first, list_id, card_id, language) where target_price is not null;

-- Sustituir SELECT de tabla por las columnas públicas originales; sin exponer leases.
revoke select on public.wishlist_items, public.wishlist_price_alerts from authenticated;
grant select (list_id, user_id, card_id, language, card_snapshot, created_at, target_price)
  on public.wishlist_items to authenticated;
grant select (id, user_id, list_id, card_id, language, target_price, observed_price, created_at, read_at)
  on public.wishlist_price_alerts to authenticated;
grant usage on schema public, auth to service_role;
grant select, update on public.wishlist_items to service_role;
grant select, insert, update on public.wishlist_price_alerts to service_role;
grant select (id, email, raw_user_meta_data) on auth.users to service_role;

-- Todas las RPC son SECURITY INVOKER: requieren el rol servidor con BYPASSRLS.
-- Sin SQL dinámico ni search_path manipulable, y sin EXECUTE para clientes/PUBLIC.
create function public.claim_wishlist_price_checks(p_limit integer)
returns table (user_id uuid, list_id uuid, card_id text, language text,
  target_price numeric, card_snapshot jsonb)
language sql security invoker set search_path = pg_catalog as $$
  with candidates as (
    select i.list_id, i.card_id, i.language from public.wishlist_items i
    where i.target_price is not null
      and (i.price_checked_at is null or i.price_checked_at < statement_timestamp() - interval '1 hour')
    order by i.price_checked_at nulls first, i.list_id, i.card_id, i.language
    limit least(greatest(coalesce(p_limit, 1), 1), 8)
    for update skip locked
  )
  update public.wishlist_items i set price_checked_at = statement_timestamp()
  from candidates c
  where (i.list_id, i.card_id, i.language) = (c.list_id, c.card_id, c.language)
  returning i.user_id, i.list_id, i.card_id, i.language, i.target_price, i.card_snapshot;
$$;

-- Reclamar JUSTO antes de trabajar, nunca un lote de correos que espere en memoria.
create function public.claim_wishlist_alert_email()
returns table (id uuid, lease_token uuid)
language sql security invoker set search_path = pg_catalog as $$
  with candidate as (
    select a.id from public.wishlist_price_alerts a
    where (a.email_state = 'pending' and a.email_next_attempt_at <= statement_timestamp())
       or (a.email_state = 'sending' and a.email_lease_until <= statement_timestamp())
    order by a.email_next_attempt_at, a.id
    limit 1 for update skip locked
  )
  update public.wishlist_price_alerts a
  set email_state = 'sending', email_lease_token = gen_random_uuid(),
      email_lease_until = statement_timestamp() + interval '120 seconds',
      email_attempts = least(a.email_attempts::bigint + 1, 2147483647)::integer
  from candidate c where a.id = c.id
  returning a.id, a.email_lease_token;
$$;

-- Revalidación inmediatamente anterior a SMTP. El email procede de auth.users,
-- nunca del snapshot, del body HTTP ni de un destinatario guardado en la alerta.
create function public.prepare_wishlist_alert_email(p_id uuid, p_token uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  a public.wishlist_price_alerts%rowtype;
  recipient text;
  snapshot jsonb;
begin
  select * into a from public.wishlist_price_alerts
  where id = p_id and email_state = 'sending' and email_lease_token = p_token
    and email_lease_until > statement_timestamp() for update;
  if not found then return jsonb_build_object('status', 'lost'); end if;

  select u.email, i.card_snapshot into recipient, snapshot
  from public.wishlist_items i join auth.users u on u.id = i.user_id
  where i.list_id = a.list_id and i.card_id = a.card_id and i.language = a.language
    and i.user_id = a.user_id and i.target_price = a.target_price
    and u.raw_user_meta_data -> 'price_alert_email' = 'true'::jsonb
    and u.email is not null and btrim(u.email) <> '';
  if not found then
    update public.wishlist_price_alerts set email_state = 'skipped',
      email_lease_token = null, email_lease_until = null where id = a.id;
    return jsonb_build_object('status', 'skipped');
  end if;
  update public.wishlist_price_alerts
    set email_lease_until = statement_timestamp() + interval '120 seconds' where id = a.id;
  return jsonb_build_object('status', 'ready', 'email', recipient,
    'card_snapshot', snapshot, 'language', a.language,
    'target_price', a.target_price, 'observed_price', a.observed_price);
end;
$$;

-- ACK cercado por token + estado + vigencia. Un trabajador antiguo no puede
-- confirmar ni reprogramar el trabajo reclamado por otro tras expirar su lease.
create function public.finish_wishlist_alert_email(p_id uuid, p_token uuid, p_outcome text)
returns boolean language plpgsql security invoker set search_path = pg_catalog as $$
declare changed integer;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'invalid delivery outcome' using errcode = '22023';
  end if;
  update public.wishlist_price_alerts a
  set email_state = case when p_outcome = 'retry' then 'pending' else p_outcome end,
      email_lease_token = null, email_lease_until = null,
      email_sent_at = case when p_outcome = 'sent' then statement_timestamp() else null end,
      email_next_attempt_at = case when p_outcome = 'retry' then statement_timestamp()
        + least(interval '24 hours', interval '15 minutes' * power(2.0, least(greatest(a.email_attempts - 1, 0), 7)))
        else a.email_next_attempt_at end
  where a.id = p_id and a.email_state = 'sending' and a.email_lease_token = p_token
    and a.email_lease_until > statement_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.claim_wishlist_price_checks(integer),
  public.claim_wishlist_alert_email(), public.prepare_wishlist_alert_email(uuid, uuid),
  public.finish_wishlist_alert_email(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_wishlist_price_checks(integer),
  public.claim_wishlist_alert_email(), public.prepare_wishlist_alert_email(uuid, uuid),
  public.finish_wishlist_alert_email(uuid, uuid, text) to service_role;
commit;
