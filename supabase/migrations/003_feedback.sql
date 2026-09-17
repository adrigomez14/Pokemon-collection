-- Ejecutar una vez DESPUÉS de 001_collection.sql y 002_cardmarket_links.sql.
-- Buzón de contacto: cualquiera puede insertar (con o sin sesión), nadie puede leer
-- desde el navegador. El titular del proyecto lee los mensajes desde el editor de
-- tablas de Supabase (que usa la clave de servicio y no está sujeto a RLS).
begin;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  topic text not null default 'otro' check (topic in ('sugerencia', 'error', 'otro')),
  email text check (email is null or length(email) between 3 and 200),
  message text not null check (length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;
alter table public.feedback force row level security;

-- Solo INSERT: sin política de select/update/delete no hay forma de leer ni de
-- modificar mensajes desde el cliente, ni siquiera los propios.
create policy insert_feedback on public.feedback for insert to anon, authenticated
  with check (length(trim(message)) > 0);

revoke all on public.feedback from anon, authenticated;
-- user_id no se concede en el insert: no puede fijarlo el remitente, solo el trigger de abajo.
grant insert (topic, email, message) on public.feedback to anon, authenticated;

-- El remitente no elige su propio user_id: se toma de la sesión (o queda en null si es anónimo).
create function public.stamp_feedback_sender() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;
create trigger stamp_feedback_sender before insert on public.feedback
  for each row execute function public.stamp_feedback_sender();

revoke all on function public.stamp_feedback_sender() from public, anon, authenticated;
commit;
