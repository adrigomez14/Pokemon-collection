-- Ejecutar una vez después de 003_feedback.sql, ANTES de activar el webhook.
-- Cuotas globales y transaccionales para un buzón personal. No modifica mensajes existentes.
begin;

create schema if not exists pokefolio_private;
revoke all on schema pokefolio_private from public, anon, authenticated;
create table pokefolio_private.feedback_quota (
  singleton boolean primary key default true check (singleton),
  hour_start timestamptz not null default '-infinity',
  day_start timestamptz not null default '-infinity',
  last_message timestamptz not null default '-infinity',
  hour_count integer not null default 0,
  day_count integer not null default 0
);
insert into pokefolio_private.feedback_quota(singleton) values (true);
alter table pokefolio_private.feedback_quota enable row level security;
revoke all on pokefolio_private.feedback_quota from public, anon, authenticated;

create function pokefolio_private.guard_feedback_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  quota pokefolio_private.feedback_quota%rowtype;
  current_timepoint timestamptz;
  current_hour timestamptz;
  current_day timestamptz;
begin
  -- Bloqueo de una única fila: varios usuarios o instancias no pueden saltarse la cuota.
  select * into strict quota from pokefolio_private.feedback_quota where singleton = true for update;
  current_timepoint := clock_timestamp();
  current_hour := date_trunc('hour', current_timepoint at time zone 'UTC') at time zone 'UTC';
  current_day := date_trunc('day', current_timepoint at time zone 'UTC') at time zone 'UTC';
  if quota.hour_start <> current_hour then quota.hour_count := 0; end if;
  if quota.day_start <> current_day then quota.day_count := 0; end if;
  if current_timepoint - quota.last_message < interval '10 seconds'
     or quota.hour_count >= 10 or quota.day_count >= 50 then
    raise exception 'feedback_rate_limit' using errcode = 'P0001';
  end if;
  update pokefolio_private.feedback_quota set
    hour_start = current_hour, day_start = current_day, last_message = current_timepoint,
    hour_count = quota.hour_count + 1, day_count = quota.day_count + 1
  where singleton = true;
  return new;
end;
$$;
revoke all on function pokefolio_private.guard_feedback_rate() from public, anon, authenticated;
create trigger guard_feedback_rate before insert on public.feedback
  for each row execute function pokefolio_private.guard_feedback_rate();
commit;