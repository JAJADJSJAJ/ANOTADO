-- confirmar_pedido: permisos, recálculo del total en el servidor y validaciones.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Estado conocido: sin pedidos previos (p. ej. de pruebas manuales). El rollback final lo deshace.
delete from pedidos;
delete from contadores_pedidos;

\set A '\'a0000000-0000-4000-8000-000000000001\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- IDs de productos del seed, en una tabla temporal legible por authenticated.
create temp table p as
select
  (select id from productos where negocio_id = :A and nombre = 'Hamburguesa completa') as completa,  -- $ 280
  (select id from productos where negocio_id = :A and nombre = 'Coca-Cola 1,5 L') as coca,           -- $ 150
  (select id from productos where negocio_id = :A and nombre = 'Pascualina (porción)') as agotado,
  (select id from productos where negocio_id = 'b0000000-0000-4000-8000-000000000001' limit 1) as de_b;
grant select on p to authenticated;

-- Cajero de A crea un pedido ------------------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');

create temp table r as
select confirmar_pedido(
  'a0000000-0000-4000-8000-000000000001', 'telefono',
  jsonb_build_array(
    -- precio_centavos y total_centavos del cliente se ignoran
    jsonb_build_object('producto_id', (select completa from p), 'cantidad', 2, 'notas', '  sin tomate  ',
                       'precio_centavos', 1),
    jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)
  ),
  '{"modo":"delivery","direccion":" Blandengues 450 ","total_centavos":0,"hack":true}',
  'tocar timbre'
) as res;

select is((select (res ->> 'total_centavos')::int from r), 71000, 'total recalculado desde productos: 2×280 + 150');
select is((select (res ->> 'numero')::int from r), 1, 'primer pedido de la jornada es #1');

reset role;
select is((select total_centavos from pedidos where id = (select (res ->> 'id')::uuid from r)), 71000, 'total guardado');
select results_eq(
  $$select nombre_snapshot, precio_unitario_centavos, cantidad, notas from pedido_items
    where pedido_id = (select (res ->> 'id')::uuid from r) order by nombre_snapshot$$,
  $$values ('Coca-Cola 1,5 L', 15000, 1, null::text), ('Hamburguesa completa', 28000, 2, 'sin tomate')$$,
  'items con nombre y precio de la base, notas limpias');
select is((select entrega from pedidos where id = (select (res ->> 'id')::uuid from r)),
  '{"modo":"delivery","direccion":"Blandengues 450"}'::jsonb, 'entrega sin campos extra');
select is((select creado_por from pedidos where id = (select (res ->> 'id')::uuid from r)),
  '00000000-0000-4000-a000-0000000000a2'::uuid, 'creado_por es quien llamó');
select is((select origen::text from pedidos where id = (select (res ->> 'id')::uuid from r)), 'telefono', 'origen guardado');
select is((select notas from pedidos where id = (select (res ->> 'id')::uuid from r)), 'tocar timbre', 'notas generales');

-- Permisos --------------------------------------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a3');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador',
    jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)))$$,
  '42501', null, 'cocina no crea pedidos');

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000b2');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador',
    jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)))$$,
  '42501', null, 'cajero de B no crea pedidos en A');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador', '[]')$$,
  '42501', null, 'anónimo no puede ejecutar la RPC');

-- Validaciones (como dueño de A) ----------------------------------------------------------------
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');

create function pg_temp.pedir(p_items jsonb, p_entrega jsonb default null, p_notas text default null)
returns jsonb language sql as $$
  select public.confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador', p_items, p_entrega, p_notas);
$$;

select lives_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 20)), '{"modo":"retiro"}')$$,
  'dueño crea pedido con cantidad 20 y retiro');
select throws_ok($$select pg_temp.pedir('[]')$$, '22023', null, 'sin items');
select throws_ok($$select pg_temp.pedir(null)$$, '22023', null, 'items null');
select throws_ok($$select pg_temp.pedir('{"producto_id":"x"}')$$, '22023', null, 'items como objeto en vez de lista');
select throws_ok($$select pg_temp.pedir('"hola"')$$, '22023', null, 'items como texto');
select throws_ok($$select pg_temp.pedir('[1]')$$, '22023', null, 'item que no es objeto');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select de_b from p), 'cantidad', 1)))$$,
  '22023', null, 'producto de otro negocio');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select agotado from p), 'cantidad', 1)))$$,
  '22023', null, 'producto agotado');
select throws_ok(
  $$select pg_temp.pedir('[{"producto_id":"no-es-uuid","cantidad":1}]')$$,
  '22023', null, 'producto_id inválido');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 0)))$$,
  '22023', null, 'cantidad 0');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 21)))$$,
  '22023', null, 'cantidad 21');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1.5)))$$,
  '22023', null, 'cantidad con decimales');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', '2')))$$,
  '22023', null, 'cantidad como texto');
select throws_ok(
  $$select pg_temp.pedir((select jsonb_agg(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)) from generate_series(1, 31)))$$,
  '22023', null, 'más de 30 items');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)), '{"modo":"delivery","direccion":"   "}')$$,
  '22023', null, 'delivery sin dirección');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)), '{"modo":"mesa"}')$$,
  '22023', null, 'mesa sin número');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)), '{"modo":"avion"}')$$,
  '22023', null, 'modo de entrega inválido');

-- Máximos de texto: el límite exacto pasa, uno más falla.
select lives_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1, 'notas', repeat('x', 200))),
    jsonb_build_object('modo', 'delivery', 'direccion', repeat('d', 200)), repeat('n', 500))$$,
  'notas de item 200, dirección 200 y notas 500 caracteres pasan');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1, 'notas', repeat('x', 201))))$$,
  '22023', null, 'notas de item de 201 caracteres');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)), null, repeat('n', 501))$$,
  '22023', null, 'notas del pedido de 501 caracteres');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)),
    jsonb_build_object('modo', 'delivery', 'direccion', repeat('d', 201)))$$,
  '22023', null, 'dirección de 201 caracteres');
select lives_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)),
    jsonb_build_object('modo', 'mesa', 'mesa', repeat('9', 20)))$$,
  'mesa de 20 caracteres pasa');
select throws_ok(
  $$select pg_temp.pedir(jsonb_build_array(jsonb_build_object('producto_id', (select coca from p), 'cantidad', 1)),
    jsonb_build_object('modo', 'mesa', 'mesa', repeat('9', 21)))$$,
  '22023', null, 'mesa de 21 caracteres');

-- Atomicidad: si un item falla, no queda nada creado ------------------------------------------
reset role;
select is((select count(*) from pedidos where negocio_id = :A), 4::bigint, 'solo los 4 pedidos válidos existen');
select is(
  (select count(*) from pedidos pe where negocio_id = :A and not exists (select 1 from pedido_items i where i.pedido_id = pe.id)),
  0::bigint, 'ningún pedido quedó sin items');

select * from finish();
rollback;
