-- Zonas de envío: quién las ve y edita, y el costo que suma confirmar_pedido.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- Ítems de prueba: 2 hamburguesas completas de A = 56000.
create temp table datos as
select (select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 2))
        from productos where negocio_id = :A and nombre = 'Hamburguesa completa') as items_a,
       (select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 1))
        from productos where negocio_id = :B and nombre = 'Pizza muzzarella') as items_b;
grant select on datos to authenticated;

insert into zonas_envio (id, negocio_id, nombre, costo_centavos, activa) values
  ('a5000000-0000-4000-8000-000000000002', :A, 'Barrio Cerro', 12000, false),
  ('b5000000-0000-4000-8000-000000000001', :B, 'Centro B', 5000, true);

-- Quién ve y edita ----------------------------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select lives_ok($$insert into zonas_envio (id, negocio_id, nombre, costo_centavos)
                  values ('a5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Centro', 8000)$$,
  'el dueño crea una zona');
select throws_ok($$insert into zonas_envio (negocio_id, nombre, costo_centavos)
                   values ('b0000000-0000-4000-8000-000000000001', 'Trucho', 0)$$,
  '42501', null, 'el dueño de A no crea zonas en B');
select throws_ok($$insert into zonas_envio (negocio_id, nombre, costo_centavos)
                   values ('a0000000-0000-4000-8000-000000000001', 'Caro', 10000001)$$,
  '23514', null, 'costo con tope');
select is((select count(*) from zonas_envio), 2::bigint, 'el dueño ve solo sus zonas');

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');
select is((select count(*) from zonas_envio), 2::bigint, 'el cajero ve las zonas para elegir');
select throws_ok($$insert into zonas_envio (negocio_id, nombre, costo_centavos)
                   values ('a0000000-0000-4000-8000-000000000001', 'Gratis', 0)$$,
  '42501', null, 'el cajero no crea zonas');
update zonas_envio set costo_centavos = 0;

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a3');
select is((select count(*) from zonas_envio), 0::bigint, 'cocina no ve zonas');

-- confirmar_pedido ----------------------------------------------------------------------------
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'telefono', (select items_a from datos),
      '{"modo":"delivery","direccion":"Uruguay 123"}')$$,
  '22023', 'Elegí la zona de envío', 'con zonas activas, delivery sin zona no va');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'telefono', (select items_a from datos),
      '{"modo":"delivery","direccion":"Uruguay 123","zona_id":"b5000000-0000-4000-8000-000000000001"}')$$,
  '22023', null, 'zona de otro negocio');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'telefono', (select items_a from datos),
      '{"modo":"delivery","direccion":"Uruguay 123","zona_id":"a5000000-0000-4000-8000-000000000002"}')$$,
  '22023', null, 'zona inactiva');
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'telefono', (select items_a from datos),
      '{"modo":"delivery","direccion":"Uruguay 123","zona_id":"centro"}')$$,
  '22023', null, 'zona que no es un uuid');

select is(
  (select confirmar_pedido(:A, 'telefono', (select items_a from datos),
     '{"modo":"delivery","direccion":"Uruguay 123","zona_id":"a5000000-0000-4000-8000-000000000001",
       "costo_centavos":0,"zona":"Gratis"}') - 'id' - 'numero'),
  '{"total_centavos":64000,"envio_centavos":8000}'::jsonb,
  'suma el costo de la base e ignora costo y nombre que vengan de afuera');
select is(
  (select confirmar_pedido(:A, 'mostrador', (select items_a from datos),
     '{"modo":"retiro","zona_id":"a5000000-0000-4000-8000-000000000001"}') ->> 'total_centavos'),
  '56000', 'retiro: sin envío aunque venga una zona');

reset role;
select results_eq(
  $$select entrega, zona_id::text, envio_centavos, total_centavos from pedidos
    where negocio_id = 'a0000000-0000-4000-8000-000000000001' order by numero$$,
  $$values ('{"modo":"delivery","direccion":"Uruguay 123","zona":"Centro"}'::jsonb,
            'a5000000-0000-4000-8000-000000000001', 8000, 64000),
           ('{"modo":"retiro"}'::jsonb, null, 0, 56000)$$,
  'el pedido guarda zona, envío y el nombre de la zona');
select is((select costo_centavos from zonas_envio where id = 'a5000000-0000-4000-8000-000000000001'), 8000,
  'el cajero no cambió costos por la tabla');

-- Borrar la zona no toca el pedido.
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select lives_ok($$delete from zonas_envio where id = 'a5000000-0000-4000-8000-000000000001'$$,
  'el dueño borra una zona usada');
reset role;
select results_eq(
  $$select entrega ->> 'zona', zona_id, envio_centavos from pedidos
    where negocio_id = 'a0000000-0000-4000-8000-000000000001' and envio_centavos > 0$$,
  $$values ('Centro', null::uuid, 8000)$$,
  'el pedido conserva el nombre y el costo');

-- Sin zonas activas: delivery como antes.
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');
select is(
  (select confirmar_pedido(:A, 'telefono', (select items_a from datos),
     '{"modo":"delivery","direccion":"Uruguay 123"}') ->> 'envio_centavos'),
  '0', 'un local sin zonas activas no exige zona');

-- FK compuesta: un pedido de A no puede apuntar a una zona de B.
reset role;
select throws_ok(
  $$insert into pedidos (negocio_id, origen, zona_id)
    values ('a0000000-0000-4000-8000-000000000001', 'mostrador', 'b5000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'pedido de A no puede usar una zona de B (ni con permisos de servidor)');
select is((select count(*) from pedidos where negocio_id = :A), 3::bigint, 'solo los 3 pedidos confirmados');

select * from finish();
rollback;
