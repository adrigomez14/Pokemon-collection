-- Aplicar una sola vez como administrador después de 001-006.
-- Solo crea listas privadas: no altera migraciones anteriores ni datos existentes.
begin;

create table public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint wishlist_name_valid check ((
    length(name) between 1 and 80
    -- Mismos espacios de trim() de JavaScript, incluyendo espacios Unicode.
    and name = btrim(name, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  ) is true),
  constraint wishlist_owner_identity unique (id, user_id)
);

create table public.wishlist_items (
  list_id uuid not null,
  user_id uuid not null,
  card_id text not null check ((length(card_id) between 1 and 100) is true),
  language text not null check ((language in ('es', 'en', 'ja')) is true),
  card_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (list_id, card_id, language),
  -- No basta con dos FKs independientes: la lista debe pertenecer al MISMO usuario.
  constraint wishlist_item_owner_fk foreign key (list_id, user_id)
    references public.wishlists(id, user_id) on delete cascade,
  constraint wishlist_snapshot_valid check ((
    jsonb_typeof(card_snapshot) = 'object'
    and octet_length(card_snapshot::text) <= 32000
    and card_snapshot - array['id', 'name', 'localId', 'image']::text[] = '{}'::jsonb
    and jsonb_typeof(card_snapshot -> 'id') = 'string'
    and card_snapshot ->> 'id' = card_id
    and jsonb_typeof(card_snapshot -> 'name') = 'string'
    and length(card_snapshot ->> 'name') between 1 and 200
    and jsonb_typeof(card_snapshot -> 'localId') = 'string'
    and length(card_snapshot ->> 'localId') <= 50
    and (
      not (card_snapshot ? 'image') or card_snapshot -> 'image' = 'null'::jsonb
      or (jsonb_typeof(card_snapshot -> 'image') = 'string'
        and length(card_snapshot ->> 'image') <= 2048
        and card_snapshot ->> 'image' ~ '^https://assets[.]tcgdex[.]net/[A-Za-z0-9_./-]+$')
    )
  ) is true)
);

-- Índices para las lecturas paginadas y los filtros RLS por propietario.
create index wishlists_user_order on public.wishlists(user_id, id);
create index wishlist_items_user_order on public.wishlist_items(user_id, list_id, card_id, language);

alter table public.wishlists enable row level security;
alter table public.wishlists force row level security;
alter table public.wishlist_items enable row level security;
alter table public.wishlist_items force row level security;

-- Claims verificados por PostgREST, nunca user_metadata. Fail closed si faltan claims.
create policy own_private_wishlists on public.wishlists for all to authenticated
  using ((select auth.uid()) = user_id
    and (select auth.jwt() ->> 'role') = 'authenticated'
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb)
  with check ((select auth.uid()) = user_id
    and (select auth.jwt() ->> 'role') = 'authenticated'
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb);
create policy own_private_wishlist_items on public.wishlist_items for all to authenticated
  using ((select auth.uid()) = user_id
    and (select auth.jwt() ->> 'role') = 'authenticated'
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb)
  with check ((select auth.uid()) = user_id
    and (select auth.jwt() ->> 'role') = 'authenticated'
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb);

revoke all on public.wishlists, public.wishlist_items from public, anon, authenticated;
grant select, delete on public.wishlists, public.wishlist_items to authenticated;
grant insert (user_id, name) on public.wishlists to authenticated;
grant update (name) on public.wishlists to authenticated;
grant insert (list_id, user_id, card_id, language, card_snapshot) on public.wishlist_items to authenticated;
-- Sin UPDATE de deseos: ON CONFLICT DO NOTHING conserva identidad, fecha y ficha.
-- 005 elimina auth.users: CASCADE borra listas y, a través de ellas, sus deseos.
commit;
