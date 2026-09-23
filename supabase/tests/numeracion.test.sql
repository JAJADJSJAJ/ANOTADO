-- Número de pedido correlativo por negocio y jornada (corte 06:00, hora de Montevideo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''

-- Turno del lunes 21/09 de noche, que termina pasada la medianoche.
insert into pedidos (negocio_id, origen, created_at) values
  (:A, 'mostrador', '2026-09-21 20:00-03'),
  (:A, 'mostrador', '2026-09-21 23:59-03'),
  (:A, 'mostrador', '2026-09-22 01:30-03');   -- madrugada: sigue siendo la jornada del lunes
-- El martes al mediodía arranca otra jornada.
insert into pedidos (negocio_id, origen, created_at) values
  (:A, 'mostrador', '2026-09-22 12:00-03');
-- Otro negocio, misma noche: su propia numeración.
insert into pedidos (negocio_id, origen, created_at) values
  (:B, 'mostrador', '2026-09-21 21:00-03');
-- numero y jornada enviados a mano se ignoran.
insert into pedidos (negocio_id, origen, created_at, numero, jornada) values
  (:A, 'mostrador', '2026-09-22 12:30-03', 999, '2000-01-01');

select results_eq(
  $$select jornada, numero from pedidos
    where negocio_id = 'a0000000-0000-4000-8000-000000000001' and created_at < '2026-09-22 06:00-03'
    order by created_at$$,
  $$values ('2026-09-21'::date, 1), ('2026-09-21'::date, 2), ('2026-09-21'::date, 3)$$,
  'correlativo dentro de la jornada, incluida la madrugada');

select is(
  (select numero from pedidos where negocio_id = :A and created_at = '2026-09-22 12:00-03'),
  1, 'nueva jornada arranca en #1');

select is(
  (select jornada from pedidos where negocio_id = :A and created_at = '2026-09-22 12:00-03'),
  '2026-09-22'::date, 'jornada del mediodía es la fecha del día');

select is(
  (select numero from pedidos where negocio_id = :B),
  1, 'cada negocio tiene su numeración');

select is(
  (select numero from pedidos where negocio_id = :A and created_at = '2026-09-22 12:30-03'),
  2, 'numero enviado a mano se ignora');

select is(
  (select jornada from pedidos where negocio_id = :A and created_at = '2026-09-22 12:30-03'),
  '2026-09-22'::date, 'jornada enviada a mano se ignora');

-- Con otro corte: si el negocio corta a las 00:00, la madrugada es del día nuevo.
update negocios set hora_corte_jornada = '00:00' where id = :A;
insert into pedidos (negocio_id, origen, created_at) values (:A, 'mostrador', '2026-09-23 01:00-03');
select is(
  (select jornada from pedidos where negocio_id = :A and created_at = '2026-09-23 01:00-03'),
  '2026-09-23'::date, 'hora de corte configurable por negocio');

select * from finish();
rollback;
