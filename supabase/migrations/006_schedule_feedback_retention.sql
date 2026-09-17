-- ACTIVACIÓN MANUAL NECESARIA para la retención automática elegida de seis meses.
-- Revisar y activar antes de publicar esa política; no se ejecuta desde el frontend.
-- Requisito: 005 aplicada. Ejecutar como postgres, no con el rol del navegador.
-- Dashboard Supabase > Integrations > Cron > Enable pg_cron.
-- https://supabase.com/docs/guides/cron/install
-- La instalación SQL documentada usa pg_catalog; si la extensión no está disponible
-- o no está precargada, activar primero la integración Cron y seguir la guía del proveedor.
-- Este archivo no ejecuta purge_feedback al desplegarse: programa ejecuciones futuras.
begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Programa esta tarea como postgres';
  end if;
  if to_regprocedure('pokefolio_private.purge_feedback()') is null then
    raise exception 'Aplica primero la migración 005';
  end if;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 03:17 cada día; Supabase utiliza GMT/UTC por defecto. Confirmar cron.timezone.
-- El mismo nombre y propietario reemplazan el job por upsert, sin crear duplicados.
-- https://supabase.com/docs/guides/cron/quickstart#edit-a-job
select cron.schedule(
  'pokefolio-feedback-retention',
  '17 3 * * *',
  'select pokefolio_private.purge_feedback();'
);

commit;
