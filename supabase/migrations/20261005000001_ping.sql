-- ping: lo llama el workflow "Mantener activa la demo" para que el plan gratis no pause el
-- proyecto. Con un 401 (anon sin permisos) Supabase lo pausó igual: hace falta una consulta
-- que responda 200. Es lo único que anon puede ejecutar; no lee tablas ni devuelve datos.
create function public.ping()
returns boolean
language sql stable security invoker set search_path = '' as $$
  select true;
$$;

revoke all on function public.ping() from public, anon, authenticated;
grant execute on function public.ping() to anon;
