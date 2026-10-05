-- Agotados desde el mostrador y la cocina (Fase 4).
--
-- Hasta ahora solo el dueño podía marcar un producto como agotado (desde Menú). En el local,
-- quien se entera de que "se terminó la pascualina" suele ser la cocina o el cajero.
-- Esta RPC deja a los tres roles cambiar SOLO productos.activo: el resto del producto
-- (nombre, precio, alias) sigue siendo del dueño, por la policy de productos.
--
-- Se decidió no separar "agotado" de "dado de baja": los dos son activo = false. Por eso un
-- cajero puede volver a habilitar un producto que el dueño sacó del menú; se acepta.

create function public.marcar_agotado(p_producto_id uuid, p_agotado boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
begin
  if p_agotado is null then
    raise exception 'Falta indicar si está agotado' using errcode = '22023';
  end if;
  select negocio_id into v_negocio_id from public.productos where id = p_producto_id for update;
  -- Mismo error si no existe o es de otro local: no se revela qué ids existen.
  if v_negocio_id is null or not public.es_miembro(v_negocio_id) then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  update public.productos set activo = not p_agotado where id = p_producto_id;
  return jsonb_build_object('id', p_producto_id, 'activo', not p_agotado);
end;
$$;

revoke all on function public.marcar_agotado(uuid, boolean) from public, anon, authenticated;
grant execute on function public.marcar_agotado(uuid, boolean) to authenticated;
