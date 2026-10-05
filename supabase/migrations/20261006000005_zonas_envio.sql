-- Zonas de envío con costo (Fase 4).
--
-- El dueño carga zonas (nombre y costo). En un delivery, el cajero elige la zona y
-- confirmar_pedido suma el costo, tomado de la base: igual que los precios, el costo nunca
-- viene del navegador ni de la IA. La IA no elige zonas (no hay geocodificación: "Barrio
-- Cerro" o "por la terminal" lo resuelve una persona).
--
--   * Si el local tiene zonas activas, todo delivery necesita zona: así no se olvida cobrar
--     el envío. Un local sin zonas sigue funcionando como antes (envío 0).
--   * El pedido guarda zona_id, envio_centavos y el nombre de la zona en entrega.zona
--     (snapshot, como los items): cambiar o borrar la zona no altera pedidos viejos.
--   * total_centavos = items + envío. Es lo que paga el cliente.

create table public.zonas_envio (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 60),
  -- Hasta $ 100.000: un tope para errores de tipeo, no una regla de negocio.
  costo_centavos int not null check (costo_centavos between 0 and 10000000),
  activa boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  unique (negocio_id, nombre),
  unique (id, negocio_id)
);

alter table public.zonas_envio enable row level security;

-- Dueño y cajero las ven (el cajero las elige). Cocina no las necesita. Solo el dueño edita.
create policy "ver zonas" on public.zonas_envio for select to authenticated
  using (public.tiene_rol(negocio_id, '{dueno,cajero}'));
create policy "editar zonas" on public.zonas_envio for all to authenticated
  using (public.tiene_rol(negocio_id, '{dueno}'))
  with check (public.tiene_rol(negocio_id, '{dueno}'));

grant select, insert, update, delete on public.zonas_envio to authenticated;

alter table public.pedidos
  add column zona_id uuid,
  add column envio_centavos int not null default 0 check (envio_centavos >= 0),
  add foreign key (zona_id, negocio_id) references public.zonas_envio (id, negocio_id)
    on delete set null (zona_id);

-- confirmar_pedido: misma firma, se agrega la zona. Lo demás queda igual.
create or replace function public.confirmar_pedido(
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
  v_zona_texto text;
  v_zona_id uuid;
  v_zona_nombre text;
  v_envio int := 0;
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

  -- 4. Crear pedido e items. numero y jornada los pone el trigger.
  insert into public.pedidos
    (negocio_id, origen, entrega, notas, total_centavos, creado_por, conversacion_id, cliente_id,
     mensaje_original, zona_id, envio_centavos)
  values
    (p_negocio_id, p_origen, v_entrega, v_notas, v_total, auth.uid(), p_conversacion_id, v_cliente_id,
     v_mensaje_original, v_zona_id, v_envio)
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

  return jsonb_build_object(
    'id', v_pedido_id, 'numero', v_numero, 'total_centavos', v_total, 'envio_centavos', v_envio);
end;
$$;

-- create or replace conserva los GRANT de la función (execute solo para authenticated).
