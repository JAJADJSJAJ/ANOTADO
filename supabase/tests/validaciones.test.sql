-- Validaciones de negocio y menú: hora de corte, zona horaria y largos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

\set A '\'a0000000-0000-4000-8000-000000000001\''

-- Como el dueño, que es quien puede editar estos datos desde la web.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-a000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$update negocios set hora_corte_jornada = '24:00' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'hora de corte 24:00 rechazada');
select lives_ok(
  $$update negocios set hora_corte_jornada = '23:59' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'hora de corte 23:59 válida');
select throws_ok(
  $$update negocios set zona_horaria = 'Marte/Olympus' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '22023', null, 'zona horaria inexistente rechazada');
select lives_ok(
  $$update negocios set zona_horaria = 'America/Argentina/Buenos_Aires' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'zona horaria real válida');

select throws_ok(
  $$insert into productos (negocio_id, nombre, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', repeat('x', 121), 100)$$,
  '23514', null, 'nombre de producto de más de 120 caracteres');
select throws_ok(
  $$insert into productos (negocio_id, nombre, alias, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', 'x', array[repeat('a', 61)], 100)$$,
  '23514', null, 'alias de más de 60 caracteres');
select throws_ok(
  $$insert into productos (negocio_id, nombre, alias, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', 'x', (select array_agg('a' || g) from generate_series(1, 21) g), 100)$$,
  '23514', null, 'más de 20 alias');
select throws_ok(
  $$insert into productos (negocio_id, nombre, alias, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', 'x', array[''], 100)$$,
  '23514', null, 'alias vacío');
select lives_ok(
  $$insert into productos (negocio_id, nombre, alias, precio_centavos) values ('a0000000-0000-4000-8000-000000000001', 'Chorizo al pan', array['choripan', 'chori'], 25000)$$,
  'producto con alias válidos');
select throws_ok(
  $$insert into categorias (negocio_id, nombre) values ('a0000000-0000-4000-8000-000000000001', repeat('x', 61))$$,
  '23514', null, 'nombre de categoría de más de 60 caracteres');

select * from finish();
rollback;
