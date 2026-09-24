-- Cocina (Fase 3): lectura acotada, cambio de estado y aviso en tiempo real.
--
-- 1. Cocina deja de leer pedidos y pedido_items directo: RLS filtra filas, no columnas, y
--    con acceso directo veía la dirección de delivery y el mensaje original del cliente.
--    Lee por pedidos_cocina(), que devuelve solo lo que se cocina.
-- 2. avanzar_estado / retroceder_estado: única forma de cambiar el estado. Solo tocan
--    estado; nunca items ni totales. Cada rol mueve lo de su área.
-- 3. Tiempo real por Broadcast desde la base, no postgres_changes (que manda la fila
--    completa). El aviso lleva solo {pedido_id, estado}; la pantalla recarga por la RPC.

-- 1. Lectura ------------------------------------------------------------------------------

drop policy "ver pedidos" on public.pedidos;
drop policy "ver items" on public.pedido_items;
create policy "ver pedidos" on public.pedidos for select to authenticated
  using (public.tiene_rol(negocio_id, '{dueno,cajero}'));
create policy "ver items" on public.pedido_items for select to authenticated
  using (public.tiene_rol(negocio_id, '{dueno,cajero}'));

-- Pedidos activos (pendiente, en cocina, listo) de las últimas 24 h, del más viejo al más
-- nuevo. Sin dirección, teléfono, mensaje original ni precios. Devuelve también la hora del
-- servidor: el temporizador no depende del reloj de la tablet.
create function public.pedidos_cocina(p_negocio_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c_max_pedidos constant int := 200;
begin
  if not public.es_miembro(p_negocio_id) then
    raise exception 'Sin acceso a este negocio' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ahora', now(),
    'pedidos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'numero', p.numero,
          'estado', p.estado,
          'origen', p.origen,
          'modo_entrega', p.entrega ->> 'modo',
          'mesa', case when p.entrega ->> 'modo' = 'mesa' then p.entrega ->> 'mesa' end,
          'notas', p.notas,
          'created_at', p.created_at,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object('nombre', i.nombre_snapshot, 'cantidad', i.cantidad, 'notas', i.notas)
              order by i.nombre_snapshot, i.id)
            from public.pedido_items i
            where i.pedido_id = p.id and i.negocio_id = p_negocio_id
          ), '[]'::jsonb)
        )
        order by p.created_at, p.numero)
      from (
        select * from public.pedidos
        where negocio_id = p_negocio_id
          and estado in ('pendiente', 'en_cocina', 'listo')
          and created_at > now() - interval '24 hours'
        order by created_at
        limit c_max_pedidos
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pedidos_cocina(uuid) from public, anon, authenticated;
grant execute on function public.pedidos_cocina(uuid) to authenticated;

-- 2. Estados ------------------------------------------------------------------------------

-- Quién mueve qué: cocina cocina, el mostrador entrega, el dueño puede todo.
-- Deshacer un paso lo puede quien pudo hacerlo.
create function public.puede_mover_estado(
  p_negocio_id uuid, p_desde public.estado_pedido, p_hacia public.estado_pedido
) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when (p_desde, p_hacia) in (('pendiente', 'en_cocina'), ('en_cocina', 'listo'),
                                ('en_cocina', 'pendiente'), ('listo', 'en_cocina'))
      then public.tiene_rol(p_negocio_id, '{dueno,cocina}')
    when (p_desde, p_hacia) in (('listo', 'entregado'), ('entregado', 'listo'))
      then public.tiene_rol(p_negocio_id, '{dueno,cajero}')
    else false
  end;
$$;

revoke all on function public.puede_mover_estado(uuid, public.estado_pedido, public.estado_pedido)
  from public, anon, authenticated;

-- Mueve el pedido de p_desde a p_hacia. p_desde es el estado que vio la pantalla: si el
-- pedido ya no está ahí (doble toque, otra tablet, reintento tras un corte) no se mueve
-- nada y se devuelve el estado actual con cambiado = false. Así un reintento nunca saltea
-- un paso.
create function public.mover_estado(
  p_pedido_id uuid, p_desde public.estado_pedido, p_hacia public.estado_pedido
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
  v_estado public.estado_pedido;
begin
  select negocio_id, estado into v_negocio_id, v_estado
  from public.pedidos where id = p_pedido_id
  for update;

  -- Mismo error si no existe o es de otro negocio: no se revela qué ids existen.
  if v_negocio_id is null or not public.es_miembro(v_negocio_id) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if p_desde is null or p_hacia is null then
    raise exception 'Ese pedido no se puede mover de estado' using errcode = '22023';
  end if;
  if not public.puede_mover_estado(v_negocio_id, p_desde, p_hacia) then
    raise exception 'Sin permiso para pasar un pedido de % a %', p_desde, p_hacia
      using errcode = '42501';
  end if;

  if v_estado is distinct from p_desde then
    return jsonb_build_object('id', p_pedido_id, 'estado', v_estado, 'cambiado', false);
  end if;

  update public.pedidos set estado = p_hacia where id = p_pedido_id;
  return jsonb_build_object('id', p_pedido_id, 'estado', p_hacia, 'cambiado', true);
end;
$$;

revoke all on function public.mover_estado(uuid, public.estado_pedido, public.estado_pedido)
  from public, anon, authenticated;

create function public.avanzar_estado(p_pedido_id uuid, p_desde public.estado_pedido)
returns jsonb
language sql security definer set search_path = '' as $$
  select public.mover_estado(p_pedido_id, p_desde, case p_desde
    when 'pendiente' then 'en_cocina'
    when 'en_cocina' then 'listo'
    when 'listo' then 'entregado'
  end::public.estado_pedido);
$$;

create function public.retroceder_estado(p_pedido_id uuid, p_desde public.estado_pedido)
returns jsonb
language sql security definer set search_path = '' as $$
  select public.mover_estado(p_pedido_id, p_desde, case p_desde
    when 'en_cocina' then 'pendiente'
    when 'listo' then 'en_cocina'
    when 'entregado' then 'listo'
  end::public.estado_pedido);
$$;

revoke all on function public.avanzar_estado(uuid, public.estado_pedido) from public, anon, authenticated;
revoke all on function public.retroceder_estado(uuid, public.estado_pedido) from public, anon, authenticated;
grant execute on function public.avanzar_estado(uuid, public.estado_pedido) to authenticated;
grant execute on function public.retroceder_estado(uuid, public.estado_pedido) to authenticated;

-- 3. Tiempo real --------------------------------------------------------------------------

-- Canal privado por negocio: negocio:<uuid>:pedidos. Devuelve null si el topic no tiene
-- esa forma (el case evita castear a uuid un texto cualquiera).
create function public.negocio_de_topic(p_topic text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_topic ~ '^negocio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:pedidos$'
      then substring(p_topic from 9 for 36)::uuid
  end;
$$;

revoke all on function public.negocio_de_topic(text) from public, anon, authenticated;
grant execute on function public.negocio_de_topic(text) to authenticated;

-- Solo los miembros del negocio se suscriben a su canal. Sin policy de insert: nadie
-- manda mensajes desde el navegador, solo el trigger.
create policy "miembros escuchan los pedidos de su negocio" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.es_miembro(public.negocio_de_topic(realtime.topic()))
  );

-- Después de crear un pedido o cambiar su estado. Corre dentro de la transacción del
-- pedido: el aviso sale al confirmar. realtime.send no falla nunca (loguea y sigue), así
-- que un problema de Realtime no impide crear ni mover pedidos.
create function public.avisar_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('pedido_id', new.id, 'estado', new.estado),
    'pedido',
    'negocio:' || new.negocio_id || ':pedidos',
    true
  );
  return null;
end;
$$;

revoke all on function public.avisar_pedido() from public, anon, authenticated;

create trigger pedidos_avisar
  after insert or update of estado on public.pedidos
  for each row execute function public.avisar_pedido();
