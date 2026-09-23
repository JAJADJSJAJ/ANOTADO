-- confirmar_pedido: única forma de crear un pedido desde la web.
--
-- Recibe lo que cargó el cajero (productos, cantidades, notas, entrega) y NUNCA precios ni
-- totales: los precios salen de public.productos y el total se calcula acá. Todo en una
-- transacción: si un item falla, no se crea nada.
--
-- Límites espejados en packages/shared/src/reglas.ts.

create function public.confirmar_pedido(
  p_negocio_id uuid,
  p_origen public.origen_pedido,
  p_items jsonb,
  p_entrega jsonb default null,
  p_notas text default null
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

  -- 2. Items.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
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
  insert into public.pedidos (negocio_id, origen, entrega, notas, total_centavos, creado_por)
  values (p_negocio_id, p_origen, v_entrega, v_notas, v_total, auth.uid())
  returning id, numero into v_pedido_id, v_numero;

  insert into public.pedido_items
    (negocio_id, pedido_id, producto_id, nombre_snapshot, precio_unitario_centavos, cantidad, notas)
  select p_negocio_id, v_pedido_id, i.producto_id, i.nombre, i.precio, i.cantidad, i.notas
  from unnest(a_producto, a_nombre, a_precio, a_cantidad, a_notas)
    as i (producto_id, nombre, precio, cantidad, notas);

  return jsonb_build_object('id', v_pedido_id, 'numero', v_numero, 'total_centavos', v_total);
end;
$$;

revoke all on function public.confirmar_pedido(uuid, public.origen_pedido, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.confirmar_pedido(uuid, public.origen_pedido, jsonb, jsonb, text)
  to authenticated;
