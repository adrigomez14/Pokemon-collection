-- Ejecutar una vez DESPUÉS de 001_collection.sql. No elimina cartas ni modifica RLS.
begin;

alter table public.collection_entries add column cardmarket_url text;
alter table public.collection_entries add constraint valid_cardmarket_url check (
  cardmarket_url is null or (
    length(cardmarket_url) <= 1000
    and cardmarket_url ~ '^https://www[.]cardmarket[.]com/(es|en|fr|de|it|pt)/Pokemon/Products/Singles/[^/?#]+/[^/?#]+/?([?][^#]*)?(#.*)?$'
  )
);
grant insert (cardmarket_url), update (cardmarket_url) on public.collection_entries to authenticated;

-- Añadir copias conserva el enlace anterior si no se aporta uno nuevo.
create or replace function public.add_collection_entry(entry jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere autenticación' using errcode = '42501';
  end if;
  if jsonb_typeof(entry) is distinct from 'object' then
    raise exception 'Entrada no válida' using errcode = '22023';
  end if;
  insert into public.collection_entries as existing
    (user_id, card_id, language, variant, condition, quantity, manual_value, notes, card_snapshot, cardmarket_url)
  values (
    auth.uid(), entry ->> 'card_id', entry ->> 'language', entry ->> 'variant',
    entry ->> 'condition', (entry ->> 'quantity')::integer,
    (entry ->> 'manual_value')::numeric, coalesce(entry ->> 'notes', ''), entry -> 'card_snapshot', entry ->> 'cardmarket_url'
  )
  on conflict (user_id, card_id, language, variant, condition)
  do update set quantity = existing.quantity + excluded.quantity, card_snapshot = excluded.card_snapshot,
    cardmarket_url = coalesce(excluded.cardmarket_url, existing.cardmarket_url);
end;
$$;

-- Las copias antiguas sin enlace siguen siendo compatibles.
create or replace function public.import_collection(entries jsonb) returns void
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
    (user_id, card_id, language, variant, condition, quantity, manual_value, notes, card_snapshot, cardmarket_url)
  select auth.uid(), item.card_id, item.language, item.variant, item.condition,
    item.quantity, item.manual_value, coalesce(item.notes, ''), item.card_snapshot, item.cardmarket_url
  from jsonb_to_recordset(entries) as item(
    card_id text, language text, variant text, condition text, quantity integer,
    manual_value numeric, notes text, card_snapshot jsonb, cardmarket_url text
  )
  on conflict (user_id, card_id, language, variant, condition)
  do update set quantity = excluded.quantity, manual_value = excluded.manual_value,
    notes = excluded.notes, card_snapshot = excluded.card_snapshot, cardmarket_url = excluded.cardmarket_url;
end;
$$;

revoke all on function public.add_collection_entry(jsonb) from public, anon;
revoke all on function public.import_collection(jsonb) from public, anon;
grant execute on function public.add_collection_entry(jsonb) to authenticated;
grant execute on function public.import_collection(jsonb) to authenticated;
commit;