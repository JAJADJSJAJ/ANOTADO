-- Lo que el cliente pide por WhatsApp y no son productos: cancelar, cómo va su pedido y cómo
-- pagar. La IA solo lo detecta; el servidor busca el dato y el bot contesta con plantillas
-- (shared/bot.ts). Estado y pagos son lecturas del servidor; acá solo hace falta cancelar.
--
--   1. cancelar_pedido_cliente: cancela el último pedido del cliente SOLO si en la cocina todavía
--      no lo empezaron. Si ya empezó (o se entregó), no se toca y se le avisa al local.
--   2. Formas de pago del local de demo (negocios.config.pagos), para que el bot tenga qué decir.

-- 1. Cancelar ---------------------------------------------------------------------------------

-- El último pedido del cliente de las últimas 12 horas. Si está pendiente (nadie tocó "Empezar"),
-- se cancela: los triggers de siempre avisan a la cocina (Realtime) y al cliente ("se canceló").
-- Si no, se devuelve tal cual y el bot le avisa al local. Bloquea la fila: si la cocina toca
-- "Empezar" justo al mismo tiempo, gana uno de los dos y el otro ve el estado final.
-- Null si no hay pedido. Lo llama solo el servidor (service_role), con el cliente de la
-- conversación: el cliente nunca elige qué pedido cancelar.
create function public.cancelar_pedido_cliente(p_negocio_id uuid, p_cliente_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_numero int;
  v_estado public.estado_pedido;
  v_modo text;
begin
  select p.id, p.numero, p.estado, p.entrega ->> 'modo'
  into v_id, v_numero, v_estado, v_modo
  from public.pedidos p
  where p.negocio_id = p_negocio_id
    and p.cliente_id = p_cliente_id
    and p.created_at > now() - interval '12 hours'
  order by p.created_at desc
  limit 1
  for update;

  if v_id is null then
    return null;
  end if;

  if v_estado = 'pendiente' then
    update public.pedidos
    set estado = 'cancelado', cancelado_motivo = 'Lo canceló el cliente por WhatsApp'
    where id = v_id;
    return jsonb_build_object('numero', v_numero, 'estado', 'cancelado', 'modo', v_modo, 'cancelado', true);
  end if;

  return jsonb_build_object('numero', v_numero, 'estado', v_estado, 'modo', v_modo, 'cancelado', false);
end;
$$;

revoke all on function public.cancelar_pedido_cliente(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancelar_pedido_cliente(uuid, uuid) to service_role;

-- 2. Formas de pago de la demo ----------------------------------------------------------------

-- Sin auth.uid() (migración): el trigger de la demo cerrada no lo frena.
update public.negocios
set config = coalesce(config, '{}'::jsonb) || '{"pagos": ["efectivo", "debito", "mercadopago"]}'::jsonb
where es_demo;
