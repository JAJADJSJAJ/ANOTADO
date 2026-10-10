-- cancelar_pedido_cliente: el cliente cancela por WhatsApp solo si la cocina no empezó, solo su
-- último pedido, y solo lo llama el servidor.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

delete from pedidos;
delete from contadores_pedidos;

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set C1 '\'c1000000-0000-4000-8000-000000000001\''
\set C2 '\'c1000000-0000-4000-8000-000000000002\''

insert into clientes (id, negocio_id, telefono) values
  (:C1, :A, '59899000001'),
  (:C2, :A, '59899000002');

-- Uno viejo del cliente 1 (ayer) y uno de hoy, pendiente. El cliente 2 tiene uno en cocina.
insert into pedidos (id, negocio_id, cliente_id, origen, total_centavos, entrega, created_at) values
  ('a5000000-0000-4000-8000-000000000001', :A, :C1, 'whatsapp', 28000, '{"modo":"retiro"}', now() - interval '1 day'),
  ('a5000000-0000-4000-8000-000000000002', :A, :C1, 'whatsapp', 32000, '{"modo":"retiro"}', now()),
  ('a5000000-0000-4000-8000-000000000003', :A, :C2, 'whatsapp', 45000, '{"modo":"delivery","direccion":"x"}', now());
update pedidos set estado = 'en_cocina' where id = 'a5000000-0000-4000-8000-000000000003';

-- Solo el servidor.
select ok(not has_function_privilege('authenticated', 'cancelar_pedido_cliente(uuid, uuid)', 'execute'),
  'authenticated no la puede llamar');
select ok(not has_function_privilege('anon', 'cancelar_pedido_cliente(uuid, uuid)', 'execute'),
  'anon no la puede llamar');
select ok(has_function_privilege('service_role', 'cancelar_pedido_cliente(uuid, uuid)', 'execute'),
  'service_role sí');

-- Pendiente: se cancela el último del cliente (no el de ayer) y queda el motivo.
select is(cancelar_pedido_cliente(:A, :C1) ->> 'cancelado', 'true', 'un pendiente se cancela');
select is((select estado::text from pedidos where id = 'a5000000-0000-4000-8000-000000000002'), 'cancelado',
  'el de hoy quedó cancelado');
select is((select cancelado_motivo from pedidos where id = 'a5000000-0000-4000-8000-000000000002'),
  'Lo canceló el cliente por WhatsApp', 'con motivo');
select is((select estado::text from pedidos where id = 'a5000000-0000-4000-8000-000000000001'), 'pendiente',
  'el de ayer no se toca');
select is(cancelar_pedido_cliente(:A, :C1) ->> 'cancelado', 'false', 'pedirlo dos veces no hace nada');

-- En cocina: no se toca; devuelve el estado para que el bot le avise al local.
select is(cancelar_pedido_cliente(:A, :C2),
  jsonb_build_object('numero', (select numero from pedidos where id = 'a5000000-0000-4000-8000-000000000003'),
    'estado', 'en_cocina', 'modo', 'delivery', 'cancelado', false),
  'en cocina no se cancela');
select is((select estado::text from pedidos where id = 'a5000000-0000-4000-8000-000000000003'), 'en_cocina',
  'sigue en cocina');

-- Sin pedidos de las últimas 12 horas: null.
select is(cancelar_pedido_cliente(:A, gen_random_uuid()), null, 'cliente sin pedidos: null');

select * from finish();
rollback;
