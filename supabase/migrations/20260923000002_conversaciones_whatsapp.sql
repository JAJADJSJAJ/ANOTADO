-- Conversaciones de WhatsApp (tarjetas del mostrador y, más adelante, el webhook).
--
-- 1. etiqueta: nombre corto que pone el cajero ("Ana") para distinguir tarjetas.
-- 2. pendientes: dudosos, preguntas y errores de la última interpretación, para que no se
--    pierdan al recargar la página (y para WhatsApp real, donde no hay pantalla esperando).
-- 3. confirmar_pedido acepta una conversación: la vincula al pedido y la cierra.
-- 4. cerrar_conversacion: descartar una tarjeta sin crear pedido.

alter table public.conversaciones
  add column etiqueta text check (length(etiqueta) <= 40),
  add column pendientes jsonb not null default '{"dudosos":[],"preguntas":[],"errores":[]}';

-- confirmar_pedido cambia de firma (parámetro nuevo): se reemplaza entera.
drop function public.confirmar_pedido(uuid, public.origen_pedido, jsonb, jsonb, text);

create function public.confirmar_pedido(
  p_negocio_id uuid,
  p_origen public.origen_pedido,
  p_items jsonb,
  p_entrega jsonb default null,
  p_notas text default null,
  p_conversacion_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_max_items constant int := 30;
  c_max_cantidad constant int := 20;
  c_max_notas_item constant int := 200;
  c_max_notas constant int := 500;
  c_max_direccion constant int := 200;
  c_max_mesa constant int := 20;

  v_item jsonb;
  v_pos int := 0;
  v_cantidad int;
  v_notas_item text;
  v_producto_id uuid;
  v_nombre text;
  v_precio int;
  v_modo text;
  v_texto text;
  v_entrega jsonb;
  v_notas text;
  v_total int := 0;
  v_pedido_id uuid;
  v_numero int;
  v_cliente_id uuid;
  v_mensaje_original text;

  a_producto uuid[] := '{}';
  a_nombre text[] := '{}';
  a_precio int[] := '{}';
  a_cantidad int[] := '{}';
  a_notas text[] := '{}';
begin
  -- 1. Permiso: dueño o cajero del negocio. Cocina no crea pedidos.
  if not public.tiene_rol(p_negocio_id, '{dueno,cajero}') then
    raise exception 'Sin permiso para crear pedidos en este negocio' using errcode = '42501';
  end if;

  -- 1b. Conversación (opcional): tiene que ser de ESTE negocio y estar abierta. Se bloquea
  -- la fila para que dos cajeros no confirmen la misma conversación a la vez.
  if p_conversacion_id is not null then
    select cliente_id into v_cliente_id
    from public.conversaciones
    where id = p_conversacion_id and negocio_id = p_negocio_id and estado = 'abierta'
    for update;
    if not found then
      raise exception 'La conversación no existe o ya está cerrada' using errcode = '22023';
    end if;
    -- Mensajes del cliente, en orden, para que en el historial se vea qué se pidió.
    select left(string_agg(contenido, E'\n' order by created_at), 2000) into v_mensaje_original
    from public.mensajes
    where conversacion_id = p_conversacion_id and rol = 'cliente';
  end if;

  -- 2. Items.
  -- Primero el tipo, después el largo: jsonb_array_length falla sobre algo que no es array.
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Los productos tienen que venir como lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > c_max_items then
    raise exception 'Máximo % productos por pedido', c_max_items using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;

    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'producto_id') is distinct from 'string'
       or (v_item ->> 'producto_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Item %: producto inválido', v_pos using errcode = '22023';
    end if;
    v_producto_id := (v_item ->> 'producto_id')::uuid;

    -- Ifs anidados: un OR no garantiza orden de evaluación y el cast fallaría con texto.
    if jsonb_typeof(v_item -> 'cantidad') is distinct from 'number' then
      raise exception 'Item %: la cantidad tiene que ser un número', v_pos using errcode = '22023';
    end if;
    if (v_item ->> 'cantidad')::numeric <> trunc((v_item ->> 'cantidad')::numeric)
       or (v_item ->> 'cantidad')::numeric not between 1 and c_max_cantidad then
      raise exception 'Item %: la cantidad tiene que ser un entero entre 1 y %', v_pos, c_max_cantidad
        using errcode = '22023';
    end if;
    v_cantidad := (v_item ->> 'cantidad')::int;

    v_notas_item := nullif(btrim(v_item ->> 'notas'), '');
    if length(v_notas_item) > c_max_notas_item then
      raise exception 'Item %: notas de más de % caracteres', v_pos, c_max_notas_item using errcode = '22023';
    end if;

    -- Precio y nombre desde la base. Solo productos activos de ESTE negocio.
    select nombre, precio_centavos into v_nombre, v_precio
    from public.productos
    where id = v_producto_id and negocio_id = p_negocio_id and activo;
    if not found then
      raise exception 'Item %: el producto no existe o está agotado', v_pos using errcode = '22023';
    end if;

    a_producto := a_producto || v_producto_id;
    a_nombre := a_nombre || v_nombre;
    a_precio := a_precio || v_precio;
    a_cantidad := a_cantidad || v_cantidad;
    a_notas := a_notas || v_notas_item;
    v_total := v_total + v_precio * v_cantidad;
  end loop;

  -- 3. Entrega: se reconstruye con solo los campos conocidos (se descarta cualquier otro).
  if p_entrega is null or p_entrega = 'null'::jsonb then
    v_entrega := null;
  else
    v_modo := p_entrega ->> 'modo';
    if v_modo = 'retiro' then
      v_entrega := jsonb_build_object('modo', 'retiro');
    elsif v_modo = 'delivery' then
      v_texto := nullif(btrim(p_entrega ->> 'direccion'), '');
      if v_texto is null or length(v_texto) > c_max_direccion then
        raise exception 'Delivery necesita una dirección (máximo % caracteres)', c_max_direccion
          using errcode = '22023';
      end if;
      v_entrega := jsonb_build_object('modo', 'delivery', 'direccion', v_texto);
    elsif v_modo = 'mesa' then
      v_texto := nullif(btrim(p_entrega ->> 'mesa'), '');
      if v_texto is null or length(v_texto) > c_max_mesa then
        raise exception 'Falta el número de mesa' using errcode = '22023';
      end if;
      v_entrega := jsonb_build_object('modo', 'mesa', 'mesa', v_texto);
    else
      raise exception 'Modo de entrega inválido' using errcode = '22023';
    end if;
  end if;

  v_notas := nullif(btrim(p_notas), '');
  if length(v_notas) > c_max_notas then
    raise exception 'Notas de más de % caracteres', c_max_notas using errcode = '22023';
  end if;

  -- 4. Crear pedido e items. numero y jornada los pone el trigger.
  insert into public.pedidos
    (negocio_id, origen, entrega, notas, total_centavos, creado_por, conversacion_id, cliente_id, mensaje_original)
  values
    (p_negocio_id, p_origen, v_entrega, v_notas, v_total, auth.uid(), p_conversacion_id, v_cliente_id, v_mensaje_original)
  returning id, numero into v_pedido_id, v_numero;

  insert into public.pedido_items
    (negocio_id, pedido_id, producto_id, nombre_snapshot, precio_unitario_centavos, cantidad, notas)
  select p_negocio_id, v_pedido_id, i.producto_id, i.nombre, i.precio, i.cantidad, i.notas
  from unnest(a_producto, a_nombre, a_precio, a_cantidad, a_notas)
    as i (producto_id, nombre, precio, cantidad, notas);

  -- 5. La conversación queda cerrada: el próximo mensaje del cliente abre otra.
  if p_conversacion_id is not null then
    update public.conversaciones
    set estado = 'cerrada', pendientes = '{"dudosos":[],"preguntas":[],"errores":[]}'
    where id = p_conversacion_id;
  end if;

  return jsonb_build_object('id', v_pedido_id, 'numero', v_numero, 'total_centavos', v_total);
end;
$$;

revoke all on function public.confirmar_pedido(uuid, public.origen_pedido, jsonb, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.confirmar_pedido(uuid, public.origen_pedido, jsonb, jsonb, text, uuid)
  to authenticated;

-- Descartar una conversación (tarjeta) sin crear pedido. Solo dueño o cajero de su negocio.
create function public.cerrar_conversacion(p_conversacion_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.conversaciones where id = p_conversacion_id;
  -- Mismo error si no existe o si es de otro negocio: no se revela qué ids existen.
  if v_negocio_id is null or not public.tiene_rol(v_negocio_id, '{dueno,cajero}') then
    raise exception 'Sin permiso sobre esta conversación' using errcode = '42501';
  end if;
  update public.conversaciones
  set estado = 'cerrada', pendientes = '{"dudosos":[],"preguntas":[],"errores":[]}'
  where id = p_conversacion_id and estado = 'abierta';
end;
$$;

revoke all on function public.cerrar_conversacion(uuid) from public, anon, authenticated;
grant execute on function public.cerrar_conversacion(uuid) to authenticated;
