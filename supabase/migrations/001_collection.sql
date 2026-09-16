-- Ejecutar una vez en el editor SQL de un proyecto nuevo de Supabase.
begin;

create table public.collection_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null check (length(card_id) between 1 and 100),
  language text not null check (language in ('es', 'en', 'ja')),
  variant text not null check (variant in ('normal', 'holo', 'reverse', 'firstEdition')),
  condition text not null check (condition in ('M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO')),
  quantity integer not null check (quantity between 1 and 9999),
  manual_value numeric(12, 2) check (manual_value between 0 and 9999999),
  notes text not null default '' check (length(notes) <= 2000),
  card_snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  constraint valid_snapshot check (
    jsonb_typeof(card_snapshot) = 'object'
    and octet_length(card_snapshot::text) <= 32000
    and (card_snapshot ->> 'id') is not null
    and card_snapshot ->> 'id' = card_id
    and (card_snapshot ->> 'name') is not null
    and length(card_snapshot ->> 'name') between 1 and 200
    and (card_snapshot ->> 'localId') is not null
    and (card_snapshot #>> '{set,id}') is not null
    and (card_snapshot #>> '{set,name}') is not null
  ),
  constraint collection_identity unique (user_id, card_id, language, variant, condition)
);

-- La seguridad está en Postgres, no en filtros del navegador.
alter table public.collection_entries enable row level security;
alter table public.collection_entries force row level security;
create policy own_entries on public.collection_entries for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.collection_entries from anon, authenticated;
grant select, delete on public.collection_entries to authenticated;
grant insert (user_id, card_id, language, variant, condition, quantity, manual_value, notes, card_snapshot)
  on public.collection_entries to authenticated;
grant update (card_id, language, variant, condition, quantity, manual_value, notes, card_snapshot)
  on public.collection_entries to authenticated;

create function public.touch_collection_entry() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger update_collection_timestamp before update on public.collection_entries
  for each row execute function public.touch_collection_entry();

-- Suma atómica: dos dispositivos no pierden incrementos concurrentes.
-- Si ya existe el registro, se conservan las notas y la valoración manual anteriores.
create function public.add_collection_entry(entry jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere autenticación' using errcode = '42501';
  end if;
  if jsonb_typeof(entry) is distinct from 'object' then
    raise exception 'Entrada no válida' using errcode = '22023';
  end if;
  insert into public.collection_entries as existing
    (user_id, card_id, language, variant, condition, quantity, manual_value, notes, card_snapshot)
  values (
    auth.uid(), entry ->> 'card_id', entry ->> 'language', entry ->> 'variant',
    entry ->> 'condition', (entry ->> 'quantity')::integer,
    (entry ->> 'manual_value')::numeric, coalesce(entry ->> 'notes', ''), entry -> 'card_snapshot'
  )
  on conflict (user_id, card_id, language, variant, condition)
  do update set quantity = existing.quantity + excluded.quantity, card_snapshot = excluded.card_snapshot;
end;
$$;

-- Importación transaccional e idempotente: reemplaza coincidencias, no suma duplicados.
create function public.import_collection(entries jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere autenticación' using errcode = '42501';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' then
    raise exception 'Se requiere una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(entries) > 3000 or octet_length(entries::text) > 5242880 then
    raise exception 'Copia demasiado grande' using errcode = '22023';
  end if;
  insert into public.collection_entries
    (user_id, card_id, language, variant, condition, quantity, manual_value, notes, card_snapshot)
  select auth.uid(), item.card_id, item.language, item.variant, item.condition,
    item.quantity, item.manual_value, coalesce(item.notes, ''), item.card_snapshot
  from jsonb_to_recordset(entries) as item(
    card_id text, language text, variant text, condition text, quantity integer,
    manual_value numeric, notes text, card_snapshot jsonb
  )
  on conflict (user_id, card_id, language, variant, condition)
  do update set quantity = excluded.quantity, manual_value = excluded.manual_value,
    notes = excluded.notes, card_snapshot = excluded.card_snapshot;
end;
$$;

revoke all on function public.touch_collection_entry() from public, anon, authenticated;
revoke all on function public.add_collection_entry(jsonb) from public, anon;
revoke all on function public.import_collection(jsonb) from public, anon;
grant execute on function public.add_collection_entry(jsonb) to authenticated;
grant execute on function public.import_collection(jsonb) to authenticated;
commit;