-- Cocina: lectura acotada (pedidos_cocina), cambios de estado por rol y avisos en tiempo real.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

delete from pedidos;
delete from contadores_pedidos;

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set cocina_a '\'00000000-0000-4000-a000-0000000000a3\''
\set dueno_b '\'00000000-0000-4000-a000-0000000000b1\''
\set topic_a '\'negocio:a0000000-0000-4000-8000-000000000001:pedidos\''
\set topic_b '\'negocio:b0000000-0000-4000-8000-000000000001:pedidos\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Lo que hace Realtime al autorizar una suscripción: fija el topic y lee realtime.messages.
create function pg_temp.mensajes_visibles(p_topic text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform set_config('realtime.topic', p_topic, true);
  select count(*) into v from realtime.messages where topic = p_topic;
  return v;
end;
$$;
grant execute on function pg_temp.mensajes_visibles(text) to authenticated;

-- Pedidos de A: delivery (el más viejo), mesa, uno entregado, uno de hace dos días. Uno de B.
insert into pedidos (id, negocio_id, origen, entrega, notas, total_centavos, mensaje_original, created_at) values
  ('a4000000-0000-4000-8000-000000000001', :A, 'whatsapp',
   '{"modo":"delivery","direccion":"Blandengues 450"}', 'bien cocida', 28000,
   'hola soy Ana, mandame una completa a Blandengues 450', now() - interval '15 minutes'),
  ('a4000000-0000-4000-8000-000000000002', :A, 'mesa', '{"modo":"mesa","mesa":"4"}', null, 15000,
   null, now() - interval '5 minutes'),
  ('a4000000-0000-4000-8000-000000000003', :A, 'mostrador', '{"modo":"retiro"}', null, 15000,
   null, now() - interval '1 minute'),
  ('a4000000-0000-4000-8000-000000000004', :A, 'mostrador', '{"modo":"retiro"}', null, 15000,
   null, now() - interval '2 days'),
  ('b4000000-0000-4000-8000-000000000001', :B, 'mostrador', '{"modo":"retiro"}', null, 45000,
   null, now());
update pedidos set estado = 'entregado' where id = 'a4000000-0000-4000-8000-000000000003';
insert into pedido_items (negocio_id, pedido_id, nombre_snapshot, precio_unitario_centavos, cantidad, notas) values
  (:A, 'a4000000-0000-4000-8000-000000000001', 'Hamburguesa completa', 28000, 1, 'sin tomate'),
  (:A, 'a4000000-0000-4000-8000-000000000002', 'Coca-Cola 1,5 L', 15000, 1, null);

-- Avisos -------------------------------------------------------------------------------------
select ok(exists (
  select 1 from realtime.messages
  where topic = :topic_a and event = 'pedido' and private
    and payload ->> 'pedido_id' = 'a4000000-0000-4000-8000-000000000001'
    and payload ->> 'estado' = 'pendiente'
), 'crear un pedido avisa al canal privado de su negocio');
select is((
  select array_agg(k order by k) from realtime.messages m, jsonb_object_keys(m.payload) k
  where m.topic = :topic_a and m.payload ->> 'pedido_id' = 'a4000000-0000-4000-8000-000000000001'
), array['estado', 'id', 'pedido_id'], 'el aviso lleva solo el id y el estado (sin dirección ni datos del cliente)');
select ok(exists (
  select 1 from realtime.messages
  where topic = :topic_a and payload ->> 'pedido_id' = 'a4000000-0000-4000-8000-000000000003'
    and payload ->> 'estado' = 'entregado'
), 'cambiar el estado avisa');
select is((select count(*) from realtime.messages where topic = :topic_b), 1::bigint,
  'los pedidos de B avisan solo a B');

select is(negocio_de_topic(:topic_a), :A::uuid, 'topic válido → negocio');
select is(negocio_de_topic('negocio:no-es-uuid:pedidos'), null, 'topic mal formado → null, sin error');
select is(negocio_de_topic('negocio:a0000000-0000-4000-8000-000000000001:otra-cosa'), null,
  'topic con otro sufijo → null');

-- Cocina de A: lectura ----------------------------------------------------------------------
select pg_temp.como(:cocina_a);

create temp table r as select pedidos_cocina(:A) as res;

select is((select jsonb_array_length(res -> 'pedidos') from r), 2,
  'cocina ve los activos de las últimas 24 h (ni entregados ni viejos)');
select is((select res -> 'pedidos' -> 0 ->> 'id' from r), 'a4000000-0000-4000-8000-000000000001',
  'el más viejo primero');
select is((select array_agg(k order by k) from r, jsonb_object_keys(res -> 'pedidos' -> 0) k),
  array['created_at', 'estado', 'id', 'items', 'mesa', 'modo_entrega', 'notas', 'numero', 'origen'],
  'solo los campos de cocina');
select ok((select res::text !~ 'Blandengues|Ana|28000' from r),
  'sin dirección, mensaje original ni precios');
select is((select res -> 'pedidos' -> 0 ->> 'modo_entrega' from r), 'delivery', 'modo de entrega sí');
select is((select res -> 'pedidos' -> 0 ->> 'notas' from r), 'bien cocida', 'notas del pedido sí');
select is((select res -> 'pedidos' -> 1 ->> 'mesa' from r), '4', 'número de mesa sí');
select is((select res -> 'pedidos' -> 0 -> 'items' from r),
  '[{"nombre":"Hamburguesa completa","cantidad":1,"notas":"sin tomate"}]'::jsonb,
  'items con nombre, cantidad y notas');
select ok((select (res ->> 'ahora')::timestamptz is not null from r), 'devuelve la hora del servidor');

select throws_ok($$select pedidos_cocina('b0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'cocina A no lee pedidos de B');
select is((select count(*) from pedidos), 0::bigint, 'cocina no lee pedidos directo');
select is((select count(*) from pedido_items), 0::bigint, 'cocina no lee items directo');

-- Cocina: suscripción a Realtime
select ok(pg_temp.mensajes_visibles(:topic_a) > 0, 'cocina A escucha el canal de A');
select is(pg_temp.mensajes_visibles(:topic_b), 0::bigint, 'cocina A no escucha el canal de B');
select is(pg_temp.mensajes_visibles('negocio:basura:pedidos'), 0::bigint, 'topic inválido: nada');
select throws_ok(
  $$insert into realtime.messages (topic, extension, event, payload, private)
    values ('negocio:a0000000-0000-4000-8000-000000000001:pedidos', 'broadcast', 'pedido', '{}', true)$$,
  '42501', null, 'nadie manda avisos desde el navegador');

-- Cocina: estados
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'pendiente') ->> 'estado'),
  'en_cocina', 'cocina: pendiente → en cocina');
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'pendiente')),
  '{"id":"a4000000-0000-4000-8000-000000000001","estado":"en_cocina","cambiado":false}'::jsonb,
  'doble toque: no saltea un paso, devuelve el estado actual');
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'en_cocina') ->> 'estado'),
  'listo', 'cocina: en cocina → listo');
select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'listo')$$,
  '42501', null, 'cocina no marca entregado');
select is((select retroceder_estado('a4000000-0000-4000-8000-000000000001', 'listo') ->> 'estado'),
  'en_cocina', 'cocina deshace listo → en cocina');
select is((select retroceder_estado('a4000000-0000-4000-8000-000000000001', 'en_cocina') ->> 'estado'),
  'pendiente', 'cocina deshace en cocina → pendiente');
select throws_ok($$select retroceder_estado('a4000000-0000-4000-8000-000000000001', 'pendiente')$$,
  '22023', null, 'no hay nada antes de pendiente');
select throws_ok($$select avanzar_estado('b4000000-0000-4000-8000-000000000001', 'pendiente')$$,
  'P0002', null, 'pedido de otro negocio: no encontrado');
select throws_ok($$select avanzar_estado(gen_random_uuid(), 'pendiente')$$,
  'P0002', null, 'pedido inexistente: mismo error');
select throws_ok($$select mover_estado('a4000000-0000-4000-8000-000000000001', 'pendiente', 'entregado')$$,
  '42501', null, 'mover_estado no se llama directo');
select throws_ok($$select puede_mover_estado('a0000000-0000-4000-8000-000000000001', 'pendiente', 'en_cocina')$$,
  '42501', null, 'puede_mover_estado no se llama directo');

-- Cajero de A ---------------------------------------------------------------------------------
reset role;
select pg_temp.como(:cajero_a);

select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'pendiente')$$,
  '42501', null, 'cajero no pasa a cocina');
select is((select count(*) from pedidos), 4::bigint, 'cajero sigue leyendo pedidos directo');
select is((select jsonb_array_length(pedidos_cocina(:A) -> 'pedidos')), 2, 'cajero también usa pedidos_cocina');

reset role;
update pedidos set estado = 'listo' where id = 'a4000000-0000-4000-8000-000000000002';
select pg_temp.como(:cajero_a);

select throws_ok($$select retroceder_estado('a4000000-0000-4000-8000-000000000002', 'listo')$$,
  '42501', null, 'cajero no devuelve a cocina');
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000002', 'listo') ->> 'estado'),
  'entregado', 'cajero: listo → entregado');
select is((select retroceder_estado('a4000000-0000-4000-8000-000000000002', 'entregado') ->> 'estado'),
  'listo', 'cajero deshace entregado → listo');
select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000003', 'entregado')$$,
  '22023', null, 'no hay nada después de entregado');

-- Dueño de A: todo el recorrido ---------------------------------------------------------------
reset role;
select pg_temp.como(:dueno_a);

select is((select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'pendiente') ->> 'estado'),
  'en_cocina', 'dueño: pendiente → en cocina');
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'en_cocina') ->> 'estado'),
  'listo', 'dueño: en cocina → listo');
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'listo') ->> 'estado'),
  'entregado', 'dueño: listo → entregado');

-- Cancelado queda quieto (cancelar llega en la Fase 4).
reset role;
update pedidos set estado = 'cancelado' where id = 'a4000000-0000-4000-8000-000000000004';
select pg_temp.como(:dueno_a);
select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000004', 'cancelado')$$,
  '22023', null, 'un cancelado no avanza');
select is((select avanzar_estado('a4000000-0000-4000-8000-000000000004', 'pendiente') ->> 'cambiado'),
  'false', 'pantalla vieja sobre un cancelado: no lo revive');

-- Dueño de B ----------------------------------------------------------------------------------
reset role;
select pg_temp.como(:dueno_b);
select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000002', 'listo')$$,
  'P0002', null, 'dueño B no mueve pedidos de A');
select throws_ok($$select pedidos_cocina('a0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'dueño B no lee la cocina de A');
select is(pg_temp.mensajes_visibles(:topic_a), 0::bigint, 'dueño B no escucha el canal de A');

-- Anon ----------------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select pedidos_cocina('a0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon no lee cocina');
select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000002', 'listo')$$,
  '42501', null, 'anon no mueve estados');

-- Lo que no se toca --------------------------------------------------------------------------
reset role;
select results_eq(
  $$select total_centavos from pedidos where negocio_id = 'a0000000-0000-4000-8000-000000000001' order by created_at$$,
  $$values (15000), (28000), (15000), (15000)$$, 'mover estados no toca totales');
select is((select count(*) from pedido_items where pedido_id = 'a4000000-0000-4000-8000-000000000001'),
  1::bigint, 'ni items');
select ok(exists (
  select 1 from realtime.messages
  where topic = :topic_a and payload ->> 'pedido_id' = 'a4000000-0000-4000-8000-000000000001'
    and payload ->> 'estado' = 'entregado'
), 'cada paso avisó');

select * from finish();
rollback;
