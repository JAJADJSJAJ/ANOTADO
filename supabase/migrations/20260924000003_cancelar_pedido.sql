-- cancelar_pedido: el mostrador (cajero o dueño) cancela un pedido que todavía no se
-- entregó. Cocina no cancela. La plata (si ya se cobró) se devuelve por fuera de la app.
-- Sin deshacer: la pantalla pide confirmación antes.

alter table public.pedidos
  add column cancelado_motivo text check (char_length(cancelado_motivo) <= 200),
  add column cancelado_por uuid references auth.users on delete set null,
  -- Motivo y autor solo en pedidos cancelados.
  add constraint cancelacion_solo_si_cancelado check (
    estado = 'cancelado' or (cancelado_motivo is null and cancelado_por is null)
  );

-- Mismo criterio que avanzar_estado: si ya estaba cancelado (doble toque, reintento),
-- no hace nada y devuelve cambiado = false. El trigger pedidos_avisar avisa a cocina.
create function public.cancelar_pedido(p_pedido_id uuid, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_max_motivo constant int := 200;
  v_negocio_id uuid;
  v_estado public.estado_pedido;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  select negocio_id, estado into v_negocio_id, v_estado
  from public.pedidos where id = p_pedido_id
  for update;

  if v_negocio_id is null or not public.es_miembro(v_negocio_id) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if not public.tiene_rol(v_negocio_id, '{dueno,cajero}') then
    raise exception 'Sin permiso para cancelar pedidos' using errcode = '42501';
  end if;
  if char_length(v_motivo) > c_max_motivo then
    raise exception 'El motivo puede tener hasta % caracteres', c_max_motivo using errcode = '22023';
  end if;

  if v_estado = 'cancelado' then
    return jsonb_build_object('id', p_pedido_id, 'estado', v_estado, 'cambiado', false);
  end if;
  if v_estado = 'entregado' then
    raise exception 'Un pedido entregado no se puede cancelar' using errcode = '22023';
  end if;

  update public.pedidos
  set estado = 'cancelado', cancelado_motivo = v_motivo, cancelado_por = auth.uid()
  where id = p_pedido_id;
  return jsonb_build_object('id', p_pedido_id, 'estado', 'cancelado', 'cambiado', true);
end;
$$;

revoke all on function public.cancelar_pedido(uuid, text) from public, anon, authenticated;
grant execute on function public.cancelar_pedido(uuid, text) to authenticated;
