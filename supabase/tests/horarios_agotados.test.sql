-- Horarios validados en la base y agotados desde cualquier rol del local.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

\set A '\'a0000000-0000-4000-8000-000000000001\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Horarios ------------------------------------------------------------------------------------
select ok(horarios_validos('{}'), 'sin horarios cargados');
select ok(horarios_validos('{"lun":[],"vie":[["19:00","01:30"]],"dom":[["11:30","14:30"],["20:00","00:00"]]}'),
  'turnos normales, que cruzan medianoche y que cierran a las 00:00');
select ok(not horarios_validos('[]'), 'tiene que ser un objeto');
select ok(not horarios_validos('{"lunes":[]}'), 'día desconocido');
select ok(not horarios_validos('{"lun":"19:00"}'), 'el día es una lista');
select ok(not horarios_validos('{"lun":[["19:00"]]}'), 'turno con apertura y cierre');
select ok(not horarios_validos('{"lun":[["19:00","24:00"]]}'), '24:00 no existe');
select ok(not horarios_validos('{"lun":[["9:00","13:00"]]}'), 'formato HH:MM');
select ok(not horarios_validos('{"lun":[[19,23]]}'), 'horas como texto');
select ok(not horarios_validos('{"lun":[["19:00","19:00"]]}'), 'apertura igual a cierre');
select ok(not horarios_validos('{"lun":[["08:00","09:00"],["10:00","11:00"],["12:00","13:00"],["14:00","15:00"],["16:00","17:00"]]}'),
  'hasta 4 turnos por día');

select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select lives_ok($$update negocios set horarios = '{"lun":[["12:00","15:00"]]}'
                  where id = 'a0000000-0000-4000-8000-000000000001'$$, 'el dueño guarda horarios');
select throws_ok($$update negocios set horarios = '{"lun":[["25:00","15:00"]]}'
                   where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'la base rechaza horarios mal formados');

-- Agotados ------------------------------------------------------------------------------------
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a3');
select is(marcar_agotado((select id from productos where negocio_id = :A and nombre = 'Hamburguesa completa'), true) ->> 'activo',
  'false', 'cocina marca agotado');
-- Cocina no edita el producto por la tabla: la policy no le deja ver filas para actualizar.
update productos set precio_centavos = 1 where negocio_id = :A;

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');
select is(marcar_agotado((select id from productos where negocio_id = :A and nombre = 'Pascualina (porción)'), false) ->> 'activo',
  'true', 'el cajero vuelve a habilitar');
select throws_ok(
  $$select marcar_agotado((select id from productos where negocio_id = 'a0000000-0000-4000-8000-000000000001' limit 1), null)$$,
  '22023', null, 'hace falta decir si está agotado');

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000b1');
select throws_ok(
  format('select marcar_agotado(%L, true)', (select id from productos where negocio_id = :A and nombre = 'Pascualina (porción)')),
  'P0002', null, 'el dueño de B no toca productos de A');
select throws_ok($$select marcar_agotado(gen_random_uuid(), true)$$, 'P0002', null, 'producto inexistente: mismo error');

reset role;
select results_eq(
  $$select nombre, activo from productos
    where negocio_id = 'a0000000-0000-4000-8000-000000000001'
      and nombre in ('Hamburguesa completa', 'Pascualina (porción)') order by nombre$$,
  $$values ('Hamburguesa completa', false), ('Pascualina (porción)', true)$$,
  'quedan los cambios de cocina y cajero');
select is((select min(precio_centavos) from productos where negocio_id = :A), 6000,
  'cocina no cambió precios por la tabla');

select * from finish();
rollback;
