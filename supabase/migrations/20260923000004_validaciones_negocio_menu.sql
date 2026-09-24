-- Validaciones de datos que carga el dueño (revisión de seguridad de la Fase 2).
--
-- 1. Jornada: la hora de corte no puede ser 24:00 (Postgres la acepta como `time`, y restarla
--    corre los pedidos al día anterior). La zona horaria tiene que existir: con una inválida,
--    el trigger de numeración falla y no se puede crear ningún pedido.
-- 2. Menú: largos máximos para nombres y alias. Van al prompt de la IA en cada mensaje; sin
--    tope, un menú inflado encarece y degrada cada llamada.

alter table public.negocios
  add constraint hora_corte_valida check (hora_corte_jornada < '24:00'),
  add constraint nombre_negocio_largo check (length(nombre) between 1 and 120);

create function public.validar_zona_horaria() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.zona_horaria) then
    raise exception 'Zona horaria desconocida: %', new.zona_horaria using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger negocios_zona_horaria
  before insert or update of zona_horaria on public.negocios
  for each row execute function public.validar_zona_horaria();

-- Alias: hasta 20, cada uno de 1 a 60 caracteres. Función inmutable para poder usarla en un check.
create function public.alias_validos(alias text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(array_length(alias, 1), 0) <= 20
     and not exists (select 1 from unnest(alias) a where length(a) not between 1 and 60);
$$;

alter table public.productos
  add constraint nombre_producto_largo check (length(nombre) between 1 and 120),
  add constraint alias_producto_validos check (public.alias_validos(alias));

alter table public.categorias
  add constraint nombre_categoria_largo check (length(nombre) between 1 and 60);

revoke all on function public.validar_zona_horaria() from public, anon, authenticated;
revoke all on function public.alias_validos(text[]) from public, anon, authenticated;
-- El check se evalúa con los permisos de quien escribe (el dueño desde la web). Es una función
-- pura, sin acceso a datos: darle EXECUTE a authenticated no expone nada.
grant execute on function public.alias_validos(text[]) to authenticated;
