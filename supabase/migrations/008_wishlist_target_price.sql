-- Aplicar una sola vez después de 007_wishlists.sql.
-- Añade el precio objetivo privado de cada carta en una lista de deseos.
begin;

alter table public.wishlist_items
  add column target_price numeric(12, 2);

alter table public.wishlist_items
  add constraint wishlist_target_price_valid
  check (target_price is null or (target_price >= 0 and target_price <= 9999999));

grant update (target_price) on public.wishlist_items to authenticated;

commit;
