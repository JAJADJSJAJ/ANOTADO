-- Escrituras de parse-order atómicas, control de concurrencia y límite de uso atómico.
--
-- Antes, parse-order escribía en pasos sueltos (conversación, mensaje, borrador, uso_ia) y
-- dos mensajes simultáneos podían pisarse. Ahora:
--   1. consumir_limite_ia: cuenta la llamada por usuario y por negocio en un solo upsert.
--   2. La IA se llama SIN escribir nada (si falla, no queda estado a medias).
--   3. guardar_interpretacion: en una transacción crea o bloquea la conversación, verifica
--      la versión (si otro mensaje se guardó en el medio, falla con 40001), guarda el mensaje,
--      el borrador, los pendientes y el uso de IA.
-- Ambas funciones son solo para service_role (las llama la Edge Function después de
-- verificar el JWT y el rol): reciben el usuario por parámetro y no deben ser invocables
-- desde el navegador.

alter table public.conversaciones add column version int not null default 0;

create table public.limites_ia (
  negocio_id uuid not null references public.negocios on delete cascade,
  -- 'negocio' para el total del negocio, o el uuid del usuario.
  clave text not null,
  ventana timestamptz not null,
  cuenta int not null,
  primary key (negocio_id, clave, ventana)
);
alter table public.limites_ia enable row level security;  -- sin policies: solo service_role

create function public.consumir_limite_ia(
  p_negocio_id uuid,
  p_user_id uuid,
  p_max_negocio int,
  p_max_usuario int
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ventana timestamptz := date_trunc('minute', now());
  v_negocio int;
  v_usuario int;
begin
  -- Limpieza de ventanas viejas del mismo negocio (usa la PK, es barato).
  delete from public.limites_ia where negocio_id = p_negocio_id and ventana < v_ventana - interval '10 minutes';

  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (p_negocio_id, 'negocio', v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_negocio;

  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (p_negocio_id, p_user_id::text, v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_usuario;

  return v_negocio <= p_max_negocio and v_usuario <= p_max_usuario;
end;
$$;

create function public.guardar_interpretacion(
  p_negocio_id uuid,
  p_conversacion_id uuid,       -- null: conversación nueva
  p_version int,                -- versión leída antes de llamar a la IA (null si es nueva)
  p_etiqueta text,              -- null: no cambiar
  p_mensaje text,
  p_borrador jsonb,
  p_pendientes jsonb,
  p_modelo text,
  p_tokens_entrada int,
  p_tokens_salida int
) returns table (conversacion_id uuid, version int)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_conversacion_id;
  v_estado text;
  v_version int;
begin
  if jsonb_typeof(p_borrador) is distinct from 'object' or jsonb_typeof(p_pendientes) is distinct from 'object' then
    raise exception 'borrador y pendientes tienen que ser objetos' using errcode = '22023';
  end if;
  if p_mensaje is null or length(p_mensaje) not between 1 and 2000 then
    raise exception 'mensaje inválido' using errcode = '22023';
  end if;
  -- Defensa en profundidad: la Edge Function ya filtra, pero la base tampoco acepta un
  -- borrador con productos de otro negocio (ifs separados: primero el tipo, después recorrer).
  if jsonb_typeof(coalesce(p_borrador -> 'items', '[]')) is distinct from 'array' then
    raise exception 'borrador.items tiene que ser una lista' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_borrador -> 'items', '[]')) i
    where not exists (
      select 1 from public.productos p
      where p.negocio_id = p_negocio_id and p.id::text = i ->> 'producto_id'
    )
  ) then
    raise exception 'El borrador tiene productos que no son de este negocio' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.conversaciones (negocio_id, etiqueta, borrador, pendientes, version, ultimo_mensaje_at)
    values (p_negocio_id, nullif(btrim(p_etiqueta), ''), p_borrador, p_pendientes, 1, now())
    returning id, conversaciones.version into v_id, v_version;
  else
    -- Bloqueo de la fila: un solo guardado por conversación a la vez.
    select c.estado, c.version into v_estado, v_version
    from public.conversaciones c
    where c.id = v_id and c.negocio_id = p_negocio_id
    for update;
    if not found or v_estado <> 'abierta' then
      raise exception 'La conversación no existe o ya está cerrada' using errcode = '22023';
    end if;
    if v_version is distinct from p_version then
      raise exception 'Llegó otro mensaje mientras se procesaba este' using errcode = '40001';
    end if;
    update public.conversaciones c
    set borrador = p_borrador,
        pendientes = p_pendientes,
        version = c.version + 1,
        ultimo_mensaje_at = now(),
        etiqueta = coalesce(nullif(btrim(p_etiqueta), ''), c.etiqueta)
    where c.id = v_id
    returning c.version into v_version;
  end if;

  insert into public.mensajes (negocio_id, conversacion_id, rol, contenido)
  values (p_negocio_id, v_id, 'cliente', p_mensaje);

  insert into public.uso_ia (negocio_id, conversacion_id, modelo, tokens_entrada, tokens_salida)
  values (p_negocio_id, v_id, p_modelo, greatest(p_tokens_entrada, 0), greatest(p_tokens_salida, 0));

  return query select v_id, v_version;
end;
$$;

revoke all on function public.consumir_limite_ia(uuid, uuid, int, int) from public, anon, authenticated;
revoke all on function public.guardar_interpretacion(uuid, uuid, int, text, text, jsonb, jsonb, text, int, int)
  from public, anon, authenticated;
grant execute on function public.consumir_limite_ia(uuid, uuid, int, int) to service_role;
grant execute on function public.guardar_interpretacion(uuid, uuid, int, text, text, jsonb, jsonb, text, int, int)
  to service_role;

-- Índice para cargar el historial de una conversación filtrando también por negocio.
create index mensajes_negocio_conversacion on public.mensajes (negocio_id, conversacion_id, created_at desc);
