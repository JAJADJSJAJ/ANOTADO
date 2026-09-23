-- Conversaciones: confirmar desde una conversación, cerrarla y permisos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

delete from pedidos;
delete from contadores_pedidos;

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Conversaciones como las crea parse-order (service_role).
insert into conversaciones (id, negocio_id, etiqueta) values
  ('c0000000-0000-4000-8000-000000000001', :A, 'Ana'),
  ('c0000000-0000-4000-8000-000000000002', :A, 'Pedro'),
  ('c0000000-0000-4000-8000-000000000003', :A, 'Cerrada'),
  ('c0000000-0000-4000-8000-00000000000b', :B, 'De B');
update conversaciones set estado = 'cerrada' where id = 'c0000000-0000-4000-8000-000000000003';
insert into mensajes (negocio_id, conversacion_id, rol, contenido, created_at) values
  (:A, 'c0000000-0000-4000-8000-000000000001', 'cliente', 'hola, 2 completas', now() - interval '2 minutes'),
  (:A, 'c0000000-0000-4000-8000-000000000001', 'asistente', 'respuesta interna', now() - interval '1 minute'),
  (:A, 'c0000000-0000-4000-8000-000000000001', 'cliente', 'y una coca grande', now());

create temp table p as
select (select id from productos where negocio_id = :A and nombre = 'Hamburguesa completa') as completa;
grant select on p to authenticated;

select throws_ok(
  $$insert into conversaciones (negocio_id, etiqueta) values ('a0000000-0000-4000-8000-000000000001', repeat('x', 41))$$,
  '23514', null, 'etiqueta de más de 40 caracteres');
select is(
  (select pendientes from conversaciones where id = 'c0000000-0000-4000-8000-000000000001'),
  '{"dudosos":[],"preguntas":[],"errores":[]}'::jsonb, 'pendientes arranca vacío');

-- Confirmar desde la conversación de Ana --------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');

create temp table r as
select confirmar_pedido(
  'a0000000-0000-4000-8000-000000000001', 'whatsapp',
  jsonb_build_array(jsonb_build_object('producto_id', (select completa from p), 'cantidad', 2)),
  '{"modo":"retiro"}', null, 'c0000000-0000-4000-8000-000000000001'
) as res;

reset role;
select is(
  (select conversacion_id from pedidos where id = (select (res ->> 'id')::uuid from r)),
  'c0000000-0000-4000-8000-000000000001'::uuid, 'el pedido queda vinculado a la conversación');
select is(
  (select mensaje_original from pedidos where id = (select (res ->> 'id')::uuid from r)),
  E'hola, 2 completas\ny una coca grande', 'mensaje_original: solo mensajes del cliente, en orden');
select is((select origen::text from pedidos where id = (select (res ->> 'id')::uuid from r)), 'whatsapp', 'origen whatsapp');
select is(
  (select estado from conversaciones where id = 'c0000000-0000-4000-8000-000000000001'),
  'cerrada', 'la conversación se cierra al confirmar');

-- Casos inválidos ------------------------------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');

select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'whatsapp',
    jsonb_build_array(jsonb_build_object('producto_id', (select completa from p), 'cantidad', 1)),
    null, null, 'c0000000-0000-4000-8000-000000000001')$$,
  '22023', null, 'no se confirma dos veces la misma conversación');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'whatsapp',
    jsonb_build_array(jsonb_build_object('producto_id', (select completa from p), 'cantidad', 1)),
    null, null, 'c0000000-0000-4000-8000-000000000003')$$,
  '22023', null, 'conversación cerrada');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'whatsapp',
    jsonb_build_array(jsonb_build_object('producto_id', (select completa from p), 'cantidad', 1)),
    null, null, 'c0000000-0000-4000-8000-00000000000b')$$,
  '22023', null, 'conversación de otro negocio');
select lives_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador',
    jsonb_build_array(jsonb_build_object('producto_id', (select completa from p), 'cantidad', 1)))$$,
  'sin conversación sigue funcionando como antes');

-- cerrar_conversacion ---------------------------------------------------------------------------
select lives_ok($$select cerrar_conversacion('c0000000-0000-4000-8000-000000000002')$$, 'cajero descarta una tarjeta');
select throws_ok($$select cerrar_conversacion('c0000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'no puede cerrar conversaciones de otro negocio');
select throws_ok($$select cerrar_conversacion('c0000000-0000-4000-8000-0000000000ff')$$,
  '42501', null, 'conversación inexistente: mismo error (no revela ids)');

reset role;
select is((select estado from conversaciones where id = 'c0000000-0000-4000-8000-000000000002'), 'cerrada', 'quedó cerrada');
select is((select estado from conversaciones where id = 'c0000000-0000-4000-8000-00000000000b'), 'abierta', 'la de B sigue abierta');

select pg_temp.como('00000000-0000-4000-a000-0000000000a3');
select throws_ok($$select cerrar_conversacion('c0000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'cocina no cierra conversaciones');

select * from finish();
rollback;
