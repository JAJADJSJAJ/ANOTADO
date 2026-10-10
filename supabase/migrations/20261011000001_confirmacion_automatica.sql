-- Fase 7: stock del día y confirmación automática (pedido de Fran: "que no dependa de que en el
-- local se confirme el pedido, pero que sea seguro").
--
--   1. Stock del día por producto (opcional). Se descuenta al confirmar, en la misma transacción
--      y con los productos bloqueados siempre en el mismo orden (por id): si dos pedidos piden la
--      última unidad a la vez, el segundo espera al primero, ve que no alcanza y no se crea. En 0
--      el producto queda agotado solo. Cada jornada vuelve al número del día (pg_cron), y si un
--      pedido se cancela, lo que descontó vuelve.
--   2. crear_pedido_interno: el cuerpo de confirmar_pedido (validaciones, stock, total desde la
--      base), sin el chequeo de rol. Lo usan el mostrador (confirmar_pedido, que exige dueño o
--      cajero) y la confirmación automática (confirmar_automatico, solo el servidor).
--   3. Confirmación automática, prendible por local (negocios.config.auto). El cliente dice "eso
--      es todo", el bot le manda el resumen con el total y pregunta "¿Lo confirmo?"; con el "sí",
--      la base revisa TODO en la misma transacción y recién ahí crea el pedido. Si algo no cumple
--      (topes, cliente nuevo, cocina llena, sin stock, el pedido cambió), queda para el cajero.
--   4. Si el cliente terminó y nadie confirma en X minutos, el bot le avisa (pg_cron).

-- 0. Jornada actual de un local (misma cuenta que asignar_numero_pedido) -----------------------

create function public.jornada_actual(p_negocio_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select ((now() at time zone n.zona_horaria) - n.hora_corte_jornada::interval)::date
  from public.negocios n where n.id = p_negocio_id;
$$;

revoke all on function public.jornada_actual(uuid) from public, anon, authenticated;

-- 1. Stock ----------------------------------------------------------------------------------------

alter table public.productos
  -- Cuántos hay cada jornada (lo pone el dueño). null = sin control de stock.
  add column stock_dia int check (stock_dia between 0 and 10000),
  -- Cuántos quedan en stock_jornada. Si la jornada ya pasó, quedan stock_dia.
  add column stock int check (stock >= 0),
  add column stock_jornada date,
  -- Lo agotó el stock (no una persona): vuelve solo cuando se repone.
  add column agotado_por_stock boolean not null default false;

comment on column public.productos.stock_dia is 'Unidades por jornada; null = sin control de stock.';
comment on column public.productos.stock is 'Unidades que quedan en stock_jornada (si la jornada pasó, quedan stock_dia).';

-- Qué ítems descontaron stock: solo esos lo devuelven si el pedido se cancela.
alter table public.pedido_items add column descontado boolean not null default false;

-- Pedidos que se confirmaron solos (para los topes por cliente y para que el cajero lo vea).
alter table public.pedidos add column automatico boolean not null default false;

-- Lo que quedan hoy de un producto (null = sin control). Para leer, no bloquea.
create function public.stock_disponible(p public.productos) returns int
language sql stable security definer set search_path = '' as $$
  select case
    when p.stock_dia is null then null
    when p.stock_jornada = public.jornada_actual(p.negocio_id) then p.stock
    else p.stock_dia
  end;
$$;

revoke all on function public.stock_disponible(public.productos) from public, anon;
grant execute on function public.stock_disponible(public.productos) to authenticated;

-- Cuando el dueño cambia el stock del día, hoy arranca con ese número.
create function public.ajustar_stock_dia() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.stock_dia is not distinct from old.stock_dia then
    return new;
  end if;
  if new.stock_dia is null then
    new.stock := null;
    new.stock_jornada := null;
    if new.agotado_por_stock then
      new.activo := true;
      new.agotado_por_stock := false;
    end if;
  else
    new.stock := new.stock_dia;
    new.stock_jornada := public.jornada_actual(new.negocio_id);
    if new.stock_dia = 0 then
      new.activo := false;
      new.agotado_por_stock := true;
    elsif new.agotado_por_stock then
      new.activo := true;
      new.agotado_por_stock := false;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ajustar_stock_dia() from public, anon, authenticated;

create trigger productos_stock_dia before insert or update of stock_dia on public.productos
  for each row execute function public.ajustar_stock_dia();

-- Cada jornada nueva, cada producto con stock vuelve a su número del día (cada 10 minutos se mira
-- qué locales cambiaron de jornada: cada uno corta a su hora y en su zona horaria).
create function public.reponer_stock_diario() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.productos p
  set stock = p.stock_dia,
      stock_jornada = public.jornada_actual(p.negocio_id),
      activo = case when p.agotado_por_stock and p.stock_dia > 0 then true else p.activo end,
      agotado_por_stock = p.stock_dia = 0
  where p.stock_dia is not null
    and p.stock_jornada is distinct from public.jornada_actual(p.negocio_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.reponer_stock_diario() from public, anon, authenticated;

-- Un pedido cancelado devuelve lo que descontó, si sigue siendo la misma jornada del stock. Nunca
-- por encima del stock del día: si el dueño lo cambió después de la venta, hoy arrancó de nuevo
-- con ese número (revisión).
create function public.devolver_stock_cancelado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estado <> 'cancelado' then
    return null;
  end if;
  update public.productos p
  set stock = least(p.stock + d.cantidad, p.stock_dia),
      activo = case when p.agotado_por_stock then true else p.activo end,
      agotado_por_stock = false
  from (
    select i.producto_id, sum(i.cantidad)::int as cantidad
    from public.pedido_items i
    where i.pedido_id = new.id and i.descontado
    group by i.producto_id
  ) d
  where p.id = d.producto_id and p.stock_dia is not null and p.stock_jornada = new.jornada;
  return null;
end;
$$;

revoke all on function public.devolver_stock_cancelado() from public, anon, authenticated;

create trigger pedidos_devolver_stock after update of estado on public.pedidos
  for each row when (old.estado is distinct from new.estado and new.estado = 'cancelado')
  execute function public.devolver_stock_cancelado();

-- En la demo, los visitantes no tocan el menú base, salvo agotado y lo que mueve el stock al
-- confirmar (que pasa con su auth.uid(), dentro de las funciones). El stock del día, no.
create or replace function public.exigir_producto_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_negocio_id uuid := case when tg_op = 'DELETE' then old.negocio_id else new.negocio_id end;
  v_duenio uuid;
begin
  if v_uid is null or not public.es_demo(v_negocio_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    -- De a uno por local: dos altas simultáneas no pasan el tope.
    perform pg_advisory_xact_lock(hashtextextended('demo-productos:' || v_negocio_id, 0));
    if (select count(*) from public.demo_productos_agregados a where a.user_id = v_uid) >= 3 then
      raise exception 'En la demo podés agregar hasta 3 productos.' using errcode = '42501';
    end if;
    if (select count(*) from public.demo_productos_agregados a where a.negocio_id = v_negocio_id) >= 40 then
      raise exception 'La demo ya tiene muchos productos agregados. Probá mañana.' using errcode = '42501';
    end if;
    return new;
  end if;

  select a.user_id into v_duenio from public.demo_productos_agregados a where a.producto_id = old.id;
  if v_duenio is distinct from v_uid then
    -- Menú base o producto de otro visitante: solo agotado / disponible y el stock que mueve un pedido.
    if tg_op = 'DELETE' or new.negocio_id is distinct from old.negocio_id
       or to_jsonb(new) - array['activo', 'stock', 'stock_jornada', 'agotado_por_stock']
          is distinct from to_jsonb(old) - array['activo', 'stock', 'stock_jornada', 'agotado_por_stock'] then
      raise exception 'Los productos de la demo no se editan: agregá uno tuyo para probar.' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and new.negocio_id is distinct from old.negocio_id then
    raise exception 'En la demo esto no se puede cambiar.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- La reposición horaria de la demo también vuelve el stock al número del día.
create or replace function public.reponer_agotados_demo() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.productos p
  set activo = true,
      stock = p.stock_dia,
      stock_jornada = case when p.stock_dia is null then null else public.jornada_actual(p.negocio_id) end,
      agotado_por_stock = false
  from public.negocios ng
  where ng.id = p.negocio_id and ng.es_demo
    and (not p.activo or p.stock is distinct from p.stock_dia);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 2. Crear el pedido (sin chequeo de rol) ----------------------------------------------------------

-- Igual que confirmar_pedido hasta ahora, más el stock. El total sale siempre de la base. Errores:
-- 22023 datos inválidos o producto agotado; AN001 no alcanza el stock (con el nombre y cuántos
-- quedan en el mensaje).
create function public.crear_pedido_interno(
  p_negocio_id uuid,
  p_origen public.origen_pedido,
  p_items jsonb,
  p_entrega jsonb,
  p_notas text,
  p_conversacion_id uuid,
  p_creado_por uuid,
  p_automatico boolean
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
  v_zona_texto text;
  v_zona_id uuid;
  v_zona_nombre text;
  v_envio int := 0;
  v_pedido_id uuid;
  v_numero int;
  v_cliente_id uuid;
  v_mensaje_original text;
  v_jornada date := public.jornada_actual(p_negocio_id);
  v_prod record;
  v_quedan int;

  a_producto uuid[] := '{}';
  a_nombre text[] := '{}';
  a_precio int[] := '{}';
  a_cantidad int[] := '{}';
  a_notas text[] := '{}';
  a_descontado uuid[] := '{}';
begin
  -- Conversación (opcional): de ESTE negocio y abierta. Se bloquea la fila para que dos
  -- confirmaciones (dos cajeros, o el cajero y la automática) no confirmen lo mismo.
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

  -- Items. Primero el tipo, después el largo: jsonb_array_length falla sobre algo que no es array.
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

    -- Que exista y sea de ESTE negocio. Si está activo y el precio se miran abajo, con la fila bloqueada.
    if not exists (select 1 from public.productos where id = v_producto_id and negocio_id = p_negocio_id) then
      raise exception 'Item %: el producto no existe o está agotado', v_pos using errcode = '22023';
    end if;

    a_producto := a_producto || v_producto_id;
    a_cantidad := a_cantidad || v_cantidad;
    a_notas := a_notas || v_notas_item;
  end loop;

  -- Stock: se bloquean los productos del pedido SIEMPRE en el mismo orden (por id), así dos pedidos
  -- con los mismos productos no se traban entre sí: uno espera al otro y ve lo que quedó.
  for v_prod in
    select p.id, p.nombre, p.precio_centavos, p.activo, p.agotado_por_stock, p.stock_dia, p.stock, p.stock_jornada, c.total
    from public.productos p
    join (select u.id, sum(u.cantidad)::int as total from unnest(a_producto, a_cantidad) as u (id, cantidad) group by u.id) c
      on c.id = p.id
    order by p.id
    for update of p
  loop
    -- Agotado por el stock (por ejemplo, otro pedido se llevó lo último mientras este esperaba el
    -- bloqueo): mismo error que cuando no alcanza, para que el bot le diga que se terminó.
    if not v_prod.activo and v_prod.agotado_por_stock then
      raise exception 'Se terminó %', v_prod.nombre using errcode = 'AN001';
    end if;
    if not v_prod.activo then
      raise exception '% está agotado', v_prod.nombre using errcode = '22023';
    end if;
    if v_prod.stock_dia is not null then
      v_quedan := case when v_prod.stock_jornada = v_jornada then v_prod.stock else v_prod.stock_dia end;
      if v_quedan < v_prod.total then
        raise exception '%', case when v_quedan = 0 then 'Se terminó ' || v_prod.nombre
                                  else 'De ' || v_prod.nombre || ' quedan ' || v_quedan end
          using errcode = 'AN001';
      end if;
      update public.productos
      set stock = v_quedan - v_prod.total,
          stock_jornada = v_jornada,
          activo = v_quedan - v_prod.total > 0,
          agotado_por_stock = v_quedan - v_prod.total = 0
      where id = v_prod.id;
      a_descontado := a_descontado || v_prod.id;
    end if;
  end loop;

  -- Nombre y precio desde la base (ya bloqueados), en el orden de los items.
  for v_pos in 1 .. coalesce(array_length(a_producto, 1), 0) loop
    select nombre, precio_centavos into v_nombre, v_precio from public.productos where id = a_producto[v_pos];
    a_nombre := a_nombre || v_nombre;
    a_precio := a_precio || v_precio;
    v_total := v_total + v_precio * a_cantidad[v_pos];
  end loop;

  -- Entrega: se reconstruye con solo los campos conocidos (se descarta cualquier otro).
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

      -- Zona: de ESTE negocio y activa. El costo sale de la base.
      v_zona_texto := nullif(btrim(p_entrega ->> 'zona_id'), '');
      if v_zona_texto is not null then
        if v_zona_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'Zona de envío inválida' using errcode = '22023';
        end if;
        select id, nombre, costo_centavos into v_zona_id, v_zona_nombre, v_envio
        from public.zonas_envio
        where id = v_zona_texto::uuid and negocio_id = p_negocio_id and activa;
        if not found then
          raise exception 'La zona de envío no existe o no está activa' using errcode = '22023';
        end if;
        v_entrega := v_entrega || jsonb_build_object('zona', v_zona_nombre);
      elsif exists (select 1 from public.zonas_envio where negocio_id = p_negocio_id and activa) then
        raise exception 'Elegí la zona de envío' using errcode = '22023';
      end if;
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

  v_total := v_total + v_envio;

  -- Crear pedido e items. numero y jornada los pone el trigger.
  insert into public.pedidos
    (negocio_id, origen, entrega, notas, total_centavos, creado_por, conversacion_id, cliente_id,
     mensaje_original, zona_id, envio_centavos, automatico)
  values
    (p_negocio_id, p_origen, v_entrega, v_notas, v_total, p_creado_por, p_conversacion_id, v_cliente_id,
     v_mensaje_original, v_zona_id, v_envio, coalesce(p_automatico, false))
  returning id, numero into v_pedido_id, v_numero;

  insert into public.pedido_items
    (negocio_id, pedido_id, producto_id, nombre_snapshot, precio_unitario_centavos, cantidad, notas, descontado)
  select p_negocio_id, v_pedido_id, i.producto_id, i.nombre, i.precio, i.cantidad, i.notas, i.producto_id = any (a_descontado)
  from unnest(a_producto, a_nombre, a_precio, a_cantidad, a_notas)
    as i (producto_id, nombre, precio, cantidad, notas);

  -- La conversación queda cerrada: el próximo mensaje del cliente abre otra.
  if p_conversacion_id is not null then
    update public.conversaciones
    set estado = 'cerrada', pendientes = '{"dudosos":[],"preguntas":[],"errores":[]}'
    where id = p_conversacion_id;
  end if;

  return jsonb_build_object(
    'id', v_pedido_id, 'numero', v_numero, 'total_centavos', v_total, 'envio_centavos', v_envio);
end;
$$;

revoke all on function public.crear_pedido_interno(uuid, public.origen_pedido, jsonb, jsonb, text, uuid, uuid, boolean)
  from public, anon, authenticated;

-- El mostrador: dueño o cajero. Misma firma de siempre.
create or replace function public.confirmar_pedido(
  p_negocio_id uuid,
  p_origen public.origen_pedido,
  p_items jsonb,
  p_entrega jsonb default null,
  p_notas text default null,
  p_conversacion_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.tiene_rol(p_negocio_id, '{dueno,cajero}') then
    raise exception 'Sin permiso para crear pedidos en este negocio' using errcode = '42501';
  end if;
  return public.crear_pedido_interno(p_negocio_id, p_origen, p_items, p_entrega, p_notas, p_conversacion_id, auth.uid(), false);
end;
$$;

-- 3. Confirmación automática -------------------------------------------------------------------------

alter table public.conversaciones
  -- El bot le mandó al cliente el resumen con este total en esta versión de la conversación y le
  -- preguntó "¿Lo confirmo?". Cualquier cambio después sube la versión y lo invalida.
  add column resumen_version int,
  add column resumen_total int check (resumen_total >= 0),
  -- El cliente dijo que terminó y quedó esperando que el local confirme (para el aviso de demora).
  add column listo_at timestamptz,
  add column aviso_demora_at timestamptz,
  -- Por qué no se confirmó sola (para el cajero; no bloquea nada).
  add column motivo_manual text check (char_length(motivo_manual) <= 200);

-- negocios.config.auto con valores por defecto y acotados (el dueño escribe config libre).
create function public.config_auto(p_config jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'activa', coalesce((a ->> 'activa')::boolean, false),
    'max_total_centavos', least(greatest(coalesce((a ->> 'max_total_centavos')::int, 300000), 0), 100000000),
    'max_por_producto', least(greatest(coalesce((a ->> 'max_por_producto')::int, 6), 1), 20),
    'max_pedidos_cliente_dia', least(greatest(coalesce((a ->> 'max_pedidos_cliente_dia')::int, 3), 1), 50),
    'max_en_cocina', least(greatest(coalesce((a ->> 'max_en_cocina')::int, 15), 1), 500),
    'nuevos_a_mano', coalesce((a ->> 'nuevos_a_mano')::boolean, true),
    'espera_minutos', least(greatest(coalesce((a ->> 'espera_minutos')::int, 10), 1), 240)
  )
  from (select case when jsonb_typeof(p_config -> 'auto') = 'object' then p_config -> 'auto' else '{}'::jsonb end as a) x;
$$;

revoke all on function public.config_auto(jsonb) from public, anon, authenticated;

-- Guarda UNA sección de negocios.config (cada pantalla de Administrar tiene la suya) sin pisar las
-- otras: si dos dueños guardan secciones distintas, quedan los dos cambios (revisión). Corre con
-- los permisos de quien llama: la política "editar negocio" y el GRANT de config deciden.
create function public.guardar_config(p_negocio_id uuid, p_clave text, p_valor jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_clave is null or p_clave not in ('auto', 'cocina', 'pagos') then
    raise exception 'Sección de configuración inválida' using errcode = '22023';
  end if;
  update public.negocios
  set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(p_clave, p_valor)
  where id = p_negocio_id;
  if not found then
    raise exception 'No podés cambiar la configuración de este local' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.guardar_config(uuid, text, jsonb) from public, anon;
grant execute on function public.guardar_config(uuid, text, jsonb) to authenticated;

-- Revisa si una conversación se puede confirmar sola y, con p_probar = false, la confirma.
--   p_probar = true (cuando el cliente dice "eso es todo"): no crea nada; devuelve el total que
--     va en el resumen, o el motivo por el que tiene que confirmarla una persona.
--   p_probar = false (cuando responde "sí"): exige que el resumen sea de ESTA versión y que el total
--     no haya cambiado, revisa todo de nuevo con las filas bloqueadas y crea el pedido. Marca como
--     interpretados los mensajes que lo dispararon y anota el uso de IA (como guardar_interpretacion_wa).
-- Devuelve {ok, total_centavos} o {ok: false, motivo, detalle}. El horario lo mira el servidor.
create function public.confirmar_automatico(
  p_negocio_id uuid,
  p_conversacion_id uuid,
  p_probar boolean,
  p_version int default null,
  p_mensajes uuid[] default null,
  p_modelo text default null,
  p_tokens_entrada int default 0,
  p_tokens_salida int default 0,
  -- Solo al probar: el pedido y los pendientes como van a quedar con el mensaje que se está
  -- interpretando (todavía no se guardaron). Al confirmar se usa SIEMPRE lo guardado.
  p_borrador jsonb default null,
  p_pendientes jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_conv record;
  v_negocio record;
  v_auto jsonb;
  v_items jsonb;
  v_entrega jsonb;
  v_total int;
  v_max_item int;
  v_jornada date := public.jornada_actual(p_negocio_id);
  v_pedido jsonb;
  v_falta text;
begin
  select cv.estado, cv.version, cv.cliente_id, cv.borrador, cv.pendientes, cv.resumen_version, cv.resumen_total
  into v_conv
  from public.conversaciones cv
  where cv.id = p_conversacion_id and cv.negocio_id = p_negocio_id
  for update;
  if not found or v_conv.estado <> 'abierta' then
    return jsonb_build_object('ok', false, 'motivo', 'cerrada');
  end if;

  select n.activo, n.config into v_negocio from public.negocios n where n.id = p_negocio_id;
  v_auto := public.config_auto(v_negocio.config);
  if not v_negocio.activo or not (v_auto ->> 'activa')::boolean or v_conv.cliente_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'apagada');
  end if;

  if not p_probar and (v_conv.resumen_version is distinct from v_conv.version or v_conv.version is distinct from p_version) then
    return jsonb_build_object('ok', false, 'motivo', 'cambio');
  end if;

  if p_probar and p_borrador is not null then
    v_conv.borrador := p_borrador;
  end if;
  if p_probar and p_pendientes is not null then
    v_conv.pendientes := p_pendientes;
  end if;

  -- Nada pendiente de resolver por una persona.
  if jsonb_array_length(coalesce(v_conv.pendientes -> 'dudosos', '[]')) > 0
     or jsonb_array_length(coalesce(v_conv.pendientes -> 'preguntas', '[]')) > 0
     or jsonb_array_length(coalesce(v_conv.pendientes -> 'errores', '[]')) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'pendientes');
  end if;

  v_items := coalesce(v_conv.borrador -> 'items', '[]');
  v_entrega := v_conv.borrador -> 'entrega';
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'vacio');
  end if;
  if v_entrega is null or jsonb_typeof(v_entrega) <> 'object'
     or (v_entrega ->> 'modo' = 'delivery' and nullif(btrim(v_entrega ->> 'direccion'), '') is null)
     or (v_entrega ->> 'modo' = 'mesa' and nullif(btrim(v_entrega ->> 'mesa'), '') is null) then
    return jsonb_build_object('ok', false, 'motivo', 'entrega');
  end if;
  -- La zona de envío la elige el cajero (la IA no la sabe).
  if v_entrega ->> 'modo' = 'delivery'
     and exists (select 1 from public.zonas_envio where negocio_id = p_negocio_id and activa) then
    return jsonb_build_object('ok', false, 'motivo', 'zona');
  end if;

  -- Tope por producto (sumando líneas del mismo producto).
  select max(t) into v_max_item
  from (select sum((e ->> 'cantidad')::int) as t from jsonb_array_elements(v_items) e group by e ->> 'producto_id') x;
  if v_max_item > (v_auto ->> 'max_por_producto')::int then
    return jsonb_build_object('ok', false, 'motivo', 'tope_producto');
  end if;

  -- Total con los precios de ahora (solo productos activos de este local; si falta alguno, no).
  select sum(p.precio_centavos * (e ->> 'cantidad')::int), count(p.id) filter (where not p.activo)
  into v_total, v_max_item
  from jsonb_array_elements(v_items) e
  left join public.productos p on p.id = (e ->> 'producto_id')::uuid and p.negocio_id = p_negocio_id;
  if v_total is null or v_max_item > 0
     or (select count(*) from jsonb_array_elements(v_items) e
         where not exists (select 1 from public.productos p where p.id = (e ->> 'producto_id')::uuid and p.negocio_id = p_negocio_id)) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'agotado');
  end if;
  if v_total > (v_auto ->> 'max_total_centavos')::int then
    return jsonb_build_object('ok', false, 'motivo', 'tope_total', 'total_centavos', v_total);
  end if;

  -- Los topes que cuentan pedidos (por cliente, cocina llena) se miran de a una confirmación
  -- automática por local: dos al mismo tiempo no pasan las dos el último lugar (revisión). Cada
  -- consulta de abajo ve lo que confirmó la anterior (read committed).
  if not p_probar then
    perform pg_advisory_xact_lock(hashtextextended('confirmar-automatico:' || p_negocio_id, 0));
  end if;

  -- Cliente nuevo: el primer pedido lo confirma una persona.
  if (v_auto ->> 'nuevos_a_mano')::boolean and not exists (
    select 1 from public.pedidos p
    where p.negocio_id = p_negocio_id and p.cliente_id = v_conv.cliente_id and p.estado <> 'cancelado'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_nuevo');
  end if;

  -- Pedidos automáticos de este cliente hoy.
  if (select count(*) from public.pedidos p
      where p.negocio_id = p_negocio_id and p.cliente_id = v_conv.cliente_id and p.automatico
        and p.jornada = v_jornada and p.estado <> 'cancelado') >= (v_auto ->> 'max_pedidos_cliente_dia')::int then
    return jsonb_build_object('ok', false, 'motivo', 'tope_cliente');
  end if;

  -- Cocina con demasiados pedidos esperando.
  if (select count(*) from public.pedidos p
      where p.negocio_id = p_negocio_id and p.estado in ('pendiente', 'en_cocina')) >= (v_auto ->> 'max_en_cocina')::int then
    return jsonb_build_object('ok', false, 'motivo', 'cocina_llena');
  end if;

  -- Stock (sin descontar todavía): para avisar en el resumen si ya no alcanza.
  select case when public.stock_disponible(p) = 0 then 'Se terminó ' || p.nombre
              else 'De ' || p.nombre || ' quedan ' || public.stock_disponible(p) end
  into v_falta
  from (select (e ->> 'producto_id')::uuid as id, sum((e ->> 'cantidad')::int) as total
        from jsonb_array_elements(v_items) e group by 1) c
  join public.productos p on p.id = c.id
  where public.stock_disponible(p) < c.total
  limit 1;
  if v_falta is not null then
    return jsonb_build_object('ok', false, 'motivo', 'stock', 'detalle', v_falta);
  end if;

  if p_probar then
    return jsonb_build_object('ok', true, 'total_centavos', v_total);
  end if;

  -- Lo que se le mostró al cliente tiene que ser lo que se cobra.
  if v_total is distinct from v_conv.resumen_total then
    return jsonb_build_object('ok', false, 'motivo', 'precio', 'total_centavos', v_total);
  end if;

  -- En la demo, el mismo cupo de pedidos del local que cuando confirma una persona.
  if public.es_demo(p_negocio_id) and not public.consumir_cupo_demo('pedidos:' || p_negocio_id, 500) then
    return jsonb_build_object('ok', false, 'motivo', 'tope_demo');
  end if;

  -- Los mensajes que dispararon la confirmación quedan interpretados, y el uso de IA anotado.
  if coalesce(cardinality(p_mensajes), 0) > 0 then
    update public.mensajes m set interpretado = true
    where m.id = any (p_mensajes) and m.conversacion_id = p_conversacion_id and m.negocio_id = p_negocio_id
      and m.rol = 'cliente' and m.tipo = 'texto';
  end if;
  if p_modelo is not null then
    insert into public.uso_ia (negocio_id, conversacion_id, modelo, tokens_entrada, tokens_salida)
    values (p_negocio_id, p_conversacion_id, left(p_modelo, 100), greatest(p_tokens_entrada, 0), greatest(p_tokens_salida, 0));
  end if;

  begin
    v_pedido := public.crear_pedido_interno(
      p_negocio_id, 'whatsapp', v_items, v_entrega, null, p_conversacion_id, null, true);
  exception
    when sqlstate 'AN001' then
      return jsonb_build_object('ok', false, 'motivo', 'stock', 'detalle', sqlerrm);
    when sqlstate '22023' then
      return jsonb_build_object('ok', false, 'motivo', 'invalido', 'detalle', sqlerrm);
  end;
  return jsonb_build_object('ok', true) || v_pedido;
end;
$$;

revoke all on function public.confirmar_automatico(uuid, uuid, boolean, int, uuid[], text, int, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirmar_automatico(uuid, uuid, boolean, int, uuid[], text, int, int, jsonb, jsonb)
  to service_role;

-- guardar_interpretacion_wa, más el resumen pedido y "el cliente terminó". Igual que antes en todo
-- lo demás (ver 20261009000001_bot_y_demo.sql).
drop function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int, text);

create function public.guardar_interpretacion_wa(
  p_negocio_id uuid,
  p_conversacion_id uuid,
  p_version int,
  p_mensajes uuid[],
  p_borrador jsonb,
  p_pendientes jsonb,
  p_modelo text,
  p_tokens_entrada int,
  p_tokens_salida int,
  p_respuesta text default null,
  -- El bot le pregunta "¿Lo confirmo?" con este total (confirmación automática).
  p_resumen_total int default null,
  -- El cliente dijo que terminó: queda esperando al local.
  p_listo boolean default false,
  -- Por qué no se confirmó sola (se muestra al cajero).
  p_motivo_manual text default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_estado text;
  v_version int;
  v_respuesta text := nullif(btrim(p_respuesta), '');
begin
  perform public.exigir_borrador_valido(p_negocio_id, p_borrador, true);
  perform public.exigir_pendientes_validos(p_pendientes);
  if coalesce(cardinality(p_mensajes), 0) = 0 then
    raise exception 'Faltan los mensajes interpretados' using errcode = '22023';
  end if;
  if char_length(v_respuesta) > 1000 then
    raise exception 'Respuesta demasiado larga' using errcode = '22023';
  end if;
  if p_resumen_total < 0 then
    raise exception 'Total inválido' using errcode = '22023';
  end if;

  select cv.estado, cv.version into v_estado, v_version
  from public.conversaciones cv
  where cv.id = p_conversacion_id and cv.negocio_id = p_negocio_id
  for update;
  if not found or v_estado <> 'abierta' then
    raise exception 'La conversación no existe o ya está cerrada' using errcode = '22023';
  end if;
  if v_version is distinct from p_version then
    raise exception 'La conversación cambió mientras se interpretaba' using errcode = '40001';
  end if;

  -- Todos los ids tienen que ser mensajes de texto del cliente, de ESTA conversación y todavía
  -- sin interpretar. Con la fila de la conversación bloqueada, nadie más los marca en el medio.
  if (
    select count(*) from public.mensajes m
    where m.id = any (p_mensajes)
      and m.conversacion_id = p_conversacion_id and m.negocio_id = p_negocio_id
      and m.rol = 'cliente' and m.tipo = 'texto' and not m.interpretado
  ) <> (select count(distinct x) from unnest(p_mensajes) x) then
    raise exception 'Mensajes interpretados inválidos' using errcode = '22023';
  end if;

  update public.mensajes m set interpretado = true
  where m.id = any (p_mensajes) and m.conversacion_id = p_conversacion_id and m.negocio_id = p_negocio_id;

  update public.conversaciones cv
  set borrador = p_borrador,
      pendientes = p_pendientes,
      version = cv.version + 1,
      -- Un mensaje que no cambió el pedido ("gracias") no invalida el resumen ni el "terminó":
      -- el "sí" que llega después sigue valiendo y el aviso de demora sigue en pie. El total se
      -- vuelve a comparar al confirmar.
      resumen_version = case
        when p_resumen_total is not null then cv.version + 1
        when p_borrador = cv.borrador and cv.resumen_version = cv.version then cv.version + 1
      end,
      resumen_total = case
        when p_resumen_total is not null then p_resumen_total
        when p_borrador = cv.borrador and cv.resumen_version = cv.version then cv.resumen_total
      end,
      listo_at = case
        when p_listo then coalesce(cv.listo_at, now())
        when p_borrador = cv.borrador then cv.listo_at
      end,
      aviso_demora_at = case when p_listo or p_borrador = cv.borrador then cv.aviso_demora_at end,
      motivo_manual = coalesce(
        left(nullif(btrim(p_motivo_manual), ''), 200),
        case when p_borrador = cv.borrador then cv.motivo_manual end)
  where cv.id = p_conversacion_id
  returning cv.version into v_version;

  insert into public.uso_ia (negocio_id, conversacion_id, modelo, tokens_entrada, tokens_salida)
  values (p_negocio_id, p_conversacion_id, left(p_modelo, 100), greatest(p_tokens_entrada, 0), greatest(p_tokens_salida, 0));

  if v_respuesta is not null then
    perform public.mensaje_bot(p_conversacion_id, v_respuesta);
  end if;

  return v_version;
end;
$$;

revoke all on function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int, text, int, boolean, text)
  from public, anon, authenticated;
grant execute on function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int, text, int, boolean, text)
  to service_role;

-- 4. Aviso de demora -----------------------------------------------------------------------------

-- El cliente terminó y nadie confirmó en espera_minutos: el bot le avisa, una sola vez.
create function public.avisar_demoras() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_conv record;
  v_n int := 0;
begin
  for v_conv in
    select cv.id
    from public.conversaciones cv
    join public.negocios n on n.id = cv.negocio_id
    where cv.estado = 'abierta' and cv.cliente_id is not null
      and cv.listo_at is not null and cv.aviso_demora_at is null
      and cv.listo_at < now() - make_interval(mins => (public.config_auto(n.config) ->> 'espera_minutos')::int)
    for update of cv skip locked
  loop
    perform public.mensaje_bot(v_conv.id,
      'Perdón la demora: el local todavía no confirmó tu pedido. Apenas lo vean, te avisamos por acá.',
      'demora:' || v_conv.id || ':' || extract(epoch from now())::bigint);
    update public.conversaciones set aviso_demora_at = now() where id = v_conv.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.avisar_demoras() from public, anon, authenticated;

select cron.schedule('reponer-stock', '*/10 * * * *', 'select public.reponer_stock_diario()');
select cron.schedule('avisar-demoras', '* * * * *', 'select public.avisar_demoras()');

-- 5. La demo: confirmación automática prendida (sin el primer pedido a mano, para que se vea) y
-- stock del día en dos productos, para ver cómo se agota. -----------------------------------------

update public.negocios
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('auto', jsonb_build_object(
  'activa', true, 'nuevos_a_mano', false, 'max_total_centavos', 300000, 'max_por_producto', 6,
  'max_pedidos_cliente_dia', 5, 'max_en_cocina', 40, 'espera_minutos', 5))
where es_demo;

update public.productos p set stock_dia = 12
from public.negocios n
where n.id = p.negocio_id and n.es_demo and p.nombre in ('Pascualina (porción)', 'Fainá (porción)');
