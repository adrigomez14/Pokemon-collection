-- Aplicar como postgres después de 001-004. No repetir 004.
-- Solo define funciones y permisos: desplegar esta migración NO elimina datos.
begin;

-- La eliminación de colecciones depende de la FK ya creada en 001.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.collection_entries'::regclass
      and c.confrelid = 'auth.users'::regclass
      and c.contype = 'f' and c.confdeltype = 'c'
      and c.conkey = array[(select attnum from pg_catalog.pg_attribute
        where attrelid = 'public.collection_entries'::regclass and attname = 'user_id')]::smallint[]
      and c.confkey = array[(select attnum from pg_catalog.pg_attribute
        where attrelid = 'auth.users'::regclass and attname = 'id')]::smallint[]
  ) then
    raise exception 'Se requiere la FK de colecciones con ON DELETE CASCADE de la migración 001';
  end if;
end;
$$;

create or replace function public.delete_own_account(confirmation text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  claims jsonb := auth.jwt();
  authentication jsonb;
  password_time numeric;
  current_epoch numeric := extract(epoch from now());
  fresh_password boolean := false;
begin
  -- auth.jwt() contiene los claims del JWT verificado por PostgREST.
  -- Nunca autorizar con user_metadata ni aceptar un ID de usuario como argumento.
  if caller_id is null or claims ->> 'role' is distinct from 'authenticated'
     or claims ->> 'is_anonymous' = 'true' then
    raise exception 'Se requiere una cuenta autenticada' using errcode = '42501';
  end if;
  if confirmation is distinct from 'ELIMINAR' then
    raise exception 'Se requiere la confirmación ELIMINAR' using errcode = '22023';
  end if;

  -- Formato real: amr = [{"method":"password","timestamp":1640991600}].
  -- https://supabase.com/docs/guides/auth/jwt-fields
  -- iat reciente o token_refresh NO acreditan conocimiento reciente de contraseña.
  if jsonb_typeof(claims -> 'amr') = 'array' then
    for authentication in select value from jsonb_array_elements(claims -> 'amr') loop
      if authentication ->> 'method' = 'password'
         and jsonb_typeof(authentication -> 'timestamp') = 'number'
         and (authentication ->> 'timestamp') ~ '^[0-9]{1,12}$' then
        password_time := (authentication ->> 'timestamp')::numeric;
        if password_time >= current_epoch - 300 and password_time <= current_epoch + 60 then
          fresh_password := true;
        end if;
      end if;
    end loop;
  end if;
  if not fresh_password then
    raise exception 'Verifica de nuevo tu contraseña antes de eliminar la cuenta' using errcode = '42501';
  end if;

  -- Primero los mensajes: su FK original es ON DELETE SET NULL, no CASCADE.
  delete from public.feedback where user_id = caller_id;
  delete from auth.users where id = caller_id;
  if not found then
    -- Revierte también la eliminación de mensajes si la cuenta ya no existe.
    raise exception 'No se ha encontrado la cuenta autenticada' using errcode = '42501';
  end if;
end;
$$;
alter function public.delete_own_account(text) owner to postgres;
revoke all on function public.delete_own_account(text) from public, anon, authenticated;
grant execute on function public.delete_own_account(text) to authenticated;

create schema if not exists pokefolio_private authorization postgres;
revoke all on schema pokefolio_private from public, anon, authenticated;

create or replace function pokefolio_private.purge_feedback() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  deleted_count integer;
begin
  delete from public.feedback where created_at < now() - interval '6 months';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
alter function pokefolio_private.purge_feedback() owner to postgres;
-- Solo el propietario postgres (administración / tarea Cron), nunca el navegador.
revoke all on function pokefolio_private.purge_feedback() from public, anon, authenticated;
-- No se registra el contenido de los mensajes. Cron recibe solo el recuento.
commit;
