-- Un usuario del negocio A no puede leer ni escribir nada del negocio B, y cada rol
-- solo hace lo que le corresponde. Corre con: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- Negocios y usuarios del seed.
\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set cocina_a '\'00000000-0000-4000-a000-0000000000a3\''
\set dueno_b '\'00000000-0000-4000-a000-0000000000b1\''

-- Actuar como un usuario logueado (lo mismo que hace PostgREST con el JWT).
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Datos de B que A no debería ver (y un pedido de A para cocina).
insert into clientes (id, negocio_id, telefono, nombre)
values ('b2000000-0000-4000-8000-000000000001', :B, '099111222', 'Cliente de B');
insert into conversaciones (id, negocio_id, cliente_id)
values ('b3000000-0000-4000-8000-000000000001', :B, 'b2000000-0000-4000-8000-000000000001');
insert into mensajes (negocio_id, conversacion_id, rol, contenido)
values (:B, 'b3000000-0000-4000-8000-000000000001', 'cliente', 'una muzza');
insert into pedidos (id, negocio_id, origen, total_centavos)
values ('b4000000-0000-4000-8000-000000000001', :B, 'mostrador', 45000);
insert into pedido_items (negocio_id, pedido_id, producto_id, nombre_snapshot, precio_unitario_centavos, cantidad)
select :B, 'b4000000-0000-4000-8000-000000000001', id, nombre, precio_centavos, 1
from productos where negocio_id = :B limit 1;
insert into pedidos (id, negocio_id, origen, total_centavos)
values ('a4000000-0000-4000-8000-000000000001', :A, 'mostrador', 28000);
insert into uso_ia (negocio_id, modelo, tokens_entrada, tokens_salida) values (:B, 'x', 1, 1);

-- Cajero de A: lectura --------------------------------------------------------------------
select pg_temp.como(:cajero_a);

select results_eq('select slug from negocios', $$values ('el-ceibo')$$, 'cajero A solo ve su negocio');
select ok((select count(*) from productos) > 0, 'cajero A ve el menú de A');
select is((select count(*) from productos where negocio_id = :B), 0::bigint, 'cajero A no ve productos de B');
select is((select count(*) from categorias where negocio_id = :B), 0::bigint, 'cajero A no ve categorías de B');
select is((select count(*) from miembros where negocio_id = :B), 0::bigint, 'cajero A no ve miembros de B');
select is((select count(*) from clientes where negocio_id = :B), 0::bigint, 'cajero A no ve clientes de B');
select is((select count(*) from conversaciones where negocio_id = :B), 0::bigint, 'cajero A no ve conversaciones de B');
select is((select count(*) from mensajes where negocio_id = :B), 0::bigint, 'cajero A no ve mensajes de B');
select is((select count(*) from pedidos where negocio_id = :B), 0::bigint, 'cajero A no ve pedidos de B');
select is((select count(*) from pedido_items where negocio_id = :B), 0::bigint, 'cajero A no ve items de B');
select is((select count(*) from uso_ia), 0::bigint, 'cajero no ve uso de IA');

-- Cajero de A: escritura ------------------------------------------------------------------
select throws_ok(
  $$insert into productos (negocio_id, nombre, precio_centavos) values ('b0000000-0000-4000-8000-000000000001', 'x', 1)$$,
  '42501', null, 'cajero A no crea productos en B');
select throws_ok(
  $$insert into productos (negocio_id, nombre, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', 'x', 1)$$,
  '42501', null, 'cajero no edita el menú (solo dueño)');
select throws_ok(
  $$insert into clientes (negocio_id, telefono) values ('b0000000-0000-4000-8000-000000000001', '099')$$,
  '42501', null, 'cajero A no crea clientes en B');
select lives_ok(
  $$insert into clientes (negocio_id, telefono) values ('a0000000-0000-4000-8000-000000000001', '099333444')$$,
  'cajero A sí crea clientes en A');
select throws_ok(
  $$insert into pedidos (negocio_id, origen, total_centavos) values ('a0000000-0000-4000-8000-000000000001', 'mostrador', 0)$$,
  '42501', null, 'nadie inserta pedidos directo: solo por RPC con total recalculado');
select throws_ok('truncate pedidos', '42501', null, 'TRUNCATE (que saltea RLS) no está permitido');
-- update/delete sobre filas invisibles no fallan: no afectan nada. Se verifica al final.
update productos set precio_centavos = 1 where negocio_id = :B;
select throws_ok(
  $$delete from pedidos where negocio_id = 'b0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'cajero no borra pedidos directo');

-- Dueño de A --------------------------------------------------------------------------------
reset role;
select pg_temp.como(:dueno_a);

select throws_ok(
  $$insert into miembros (negocio_id, user_id, rol) values ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000a1', 'dueno')$$,
  '42501', null, 'dueño A no se puede agregar como dueño de B');
select throws_ok(
  $$insert into productos (negocio_id, categoria_id, nombre, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'x', 1)$$,
  '23503', null, 'FK compuesta: un producto de A no puede usar una categoría de B');
select is(es_miembro(:B), false, 'es_miembro(B) es false para dueño A');
select throws_ok(
  $$insert into miembros (negocio_id, user_id, rol) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000b1', 'dueno')$$,
  '42501', null, 'roles solo por RPC: dueño A no agrega miembros ni en su negocio');
select throws_ok(
  $$delete from miembros where user_id = '00000000-0000-4000-a000-0000000000a3'$$,
  '42501', null, 'dueño A no borra miembros desde la web');
select throws_ok(
  $$update negocios set wa_phone_number_id = '123' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'dueño no toca wa_phone_number_id (solo servidor)');
select lives_ok(
  $$update negocios set nombre = 'El Ceibo' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'dueño sí edita datos operativos de su negocio');
update negocios set nombre = 'hackeado' where id = :B;
delete from productos where negocio_id = :B;

-- Cocina de A -------------------------------------------------------------------------------
reset role;
select pg_temp.como(:cocina_a);

select is((select count(*) from pedidos), 1::bigint, 'cocina A ve los pedidos de A');
select is((select count(*) from clientes), 0::bigint, 'cocina no ve clientes (teléfonos)');
select is((select count(*) from conversaciones), 0::bigint, 'cocina no ve conversaciones');
select throws_ok(
  $$update pedidos set total_centavos = 0, estado = 'entregado'$$,
  '42501', null, 'cocina no edita pedidos directo (solo avanzar_estado, Fase 3)');

-- Dueño de B (simetría) ---------------------------------------------------------------------
reset role;
select pg_temp.como(:dueno_b);

select is((select count(*) from productos where negocio_id = :A), 0::bigint, 'dueño B no ve productos de A');
select is((select count(*) from pedidos where negocio_id = :A), 0::bigint, 'dueño B no ve pedidos de A');
select is((select count(*) from uso_ia), 1::bigint, 'dueño B ve el uso de IA de B');

-- Anónimo -----------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok('select count(*) from productos', '42501', null, 'anónimo no tiene permiso de lectura');

-- Escrituras privilegiadas con negocio_id incoherente --------------------------------------
reset role;

select throws_ok(
  $$insert into pedido_items (negocio_id, pedido_id, nombre_snapshot, precio_unitario_centavos, cantidad)
    values ('a0000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'x', 1, 1)$$,
  '23503', null, 'item de A no puede colgar de un pedido de B (ni con permisos de servidor)');
select throws_ok(
  $$insert into mensajes (negocio_id, conversacion_id, rol, contenido)
    values ('a0000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'cliente', 'x')$$,
  '23503', null, 'mensaje de A no puede colgar de una conversación de B');
select throws_ok(
  $$insert into pedido_items (negocio_id, pedido_id, producto_id, nombre_snapshot, precio_unitario_centavos, cantidad)
    values ('a0000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
            (select id from productos where negocio_id = 'b0000000-0000-4000-8000-000000000001' limit 1), 'x', 1, 1)$$,
  '23503', null, 'item de A no puede usar un producto de B');
select throws_ok(
  $$insert into conversaciones (negocio_id, cliente_id)
    values ('a0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'conversación de A no puede ser de un cliente de B');
select throws_ok(
  $$insert into pedidos (negocio_id, origen, cliente_id)
    values ('a0000000-0000-4000-8000-000000000001', 'mostrador', 'b2000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'pedido de A no puede ser de un cliente de B');
select throws_ok(
  $$insert into pedidos (negocio_id, origen, conversacion_id)
    values ('a0000000-0000-4000-8000-000000000001', 'whatsapp', 'b3000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'pedido de A no puede salir de una conversación de B');
select throws_ok(
  $$insert into uso_ia (negocio_id, conversacion_id, modelo, tokens_entrada, tokens_salida)
    values ('a0000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'x', 1, 1)$$,
  '23503', null, 'uso de IA de A no puede apuntar a una conversación de B');

-- Verificación: las escrituras de arriba no cambiaron nada ----------------------------------

select is((select min(precio_centavos) from productos where negocio_id = :B), 16000, 'precios de B intactos');
select is((select count(*) from productos where negocio_id = :B), 3::bigint, 'productos de B intactos');
select is((select count(*) from pedidos where negocio_id = :B), 1::bigint, 'pedido de B intacto');
select is((select nombre from negocios where id = :B), 'Pizzería La Esquina', 'nombre de B intacto');
select results_eq(
  $$select estado::text, total_centavos from pedidos where negocio_id = 'a0000000-0000-4000-8000-000000000001'$$,
  $$values ('pendiente', 28000)$$, 'cocina no edita pedidos directo');

select * from finish();
rollback;
