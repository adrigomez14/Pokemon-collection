-- Aplicar una sola vez después de 008_wishlist_target_price.sql.
-- Avisos persistentes cuando una carta alcanza el precio objetivo.
begin;

create table public.wishlist_price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  card_id text not null,
  language text not null check (language in ('es', 'en', 'ja')),
  target_price numeric(12, 2) not null check (target_price >= 0 and target_price <= 9999999),
  observed_price numeric(12, 2) not null check (observed_price >= 0 and observed_price <= 9999999),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint wishlist_alert_item_fk foreign key (list_id, card_id, language)
    references public.wishlist_items(list_id, card_id, language) on delete cascade,
  constraint wishlist_alert_once_per_target unique (user_id, list_id, card_id, language, target_price)
);

create index wishlist_price_alerts_user_order on public.wishlist_price_alerts(user_id, created_at desc);
alter table public.wishlist_price_alerts enable row level security;
alter table public.wishlist_price_alerts force row level security;

create policy read_own_wishlist_price_alerts on public.wishlist_price_alerts for select to authenticated
  using ((select auth.uid()) = user_id
    and (select auth.jwt() ->> 'role') = 'authenticated'
    and (select auth.jwt() -> 'is_anonymous') = 'false'::jsonb);
create policy mark_own_wishlist_price_alerts_read on public.wishlist_price_alerts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.wishlist_price_alerts from public, anon, authenticated;
grant select on public.wishlist_price_alerts to authenticated;
grant update (read_at) on public.wishlist_price_alerts to authenticated;

commit;
