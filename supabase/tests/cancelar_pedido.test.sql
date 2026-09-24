-- cancelar_pedido: solo el mostrador, nunca un entregado, idempotente y con aviso a cocina.
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

insert into pedidos (id, negocio_id, origen, total_centavos) values
  ('a4000000-0000-4000-8000-000000000001', :A, 'mostrador', 28000),
  ('a4000000-0000-4000-8000-000000000002', :A, 'mostrador', 28000),
  ('a4000000-0000-4000-8000-000000000003', :A, 'mostrador', 28000),
  ('b4000000-0000-4000-8000-000000000001', :B, 'mostrador', 45000);
update pedidos set estado = 'listo' where id = 'a4000000-0000-4000-8000-000000000002';
update pedidos set estado = 'entregado' where id = 'a4000000-0000-4000-8000-000000000003';

-- Cocina no cancela
select pg_temp.como('00000000-0000-4000-a000-0000000000a3');
select throws_ok($$select cancelar_pedido('a4000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'cocina no cancela');

-- Cajero de A
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');
select is((select cancelar_pedido('a4000000-0000-4000-8000-000000000001', '  el cliente se arrepintió ')),
  '{"id":"a4000000-0000-4000-8000-000000000001","estado":"cancelado","cambiado":true}'::jsonb,
  'cajero cancela un pendiente');
select is((select cancelar_pedido('a4000000-0000-4000-8000-000000000001') ->> 'cambiado'), 'false',
  'cancelar dos veces no hace nada');
select throws_ok($$select cancelar_pedido('a4000000-0000-4000-8000-000000000003')$$,
  '22023', null, 'un entregado no se cancela');
select throws_ok($$select cancelar_pedido('a4000000-0000-4000-8000-000000000002', repeat('x', 201))$$,
  '22023', null, 'motivo acotado');
select throws_ok($$select cancelar_pedido('b4000000-0000-4000-8000-000000000001')$$,
  'P0002', null, 'pedido de otro negocio: no encontrado');
select throws_ok($$select cancelar_pedido(gen_random_uuid())$$,
  'P0002', null, 'pedido inexistente: mismo error');
select throws_ok($$select avanzar_estado('a4000000-0000-4000-8000-000000000001', 'cancelado')$$,
  '22023', null, 'un cancelado no se revive con avanzar');

-- Dueño de A cancela un listo, sin motivo
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select is((select cancelar_pedido('a4000000-0000-4000-8000-000000000002') ->> 'estado'), 'cancelado',
  'dueño cancela un listo');

reset role;
select results_eq(
  $$select id::text, cancelado_motivo, cancelado_por::text from pedidos
    where estado = 'cancelado' order by id$$,
  $$values ('a4000000-0000-4000-8000-000000000001', 'el cliente se arrepintió', '00000000-0000-4000-a000-0000000000a2'),
           ('a4000000-0000-4000-8000-000000000002', null, '00000000-0000-4000-a000-0000000000a1')$$,
  'guarda motivo limpio y quién canceló');
select is((select total_centavos from pedidos where id = 'a4000000-0000-4000-8000-000000000001'), 28000,
  'no toca el total');
select ok(exists (
  select 1 from realtime.messages
  where topic = 'negocio:a0000000-0000-4000-8000-000000000001:pedidos'
    and payload ->> 'pedido_id' = 'a4000000-0000-4000-8000-000000000001'
    and payload ->> 'estado' = 'cancelado'
), 'cocina se entera');
select pg_temp.como('00000000-0000-4000-a000-0000000000a3');
select is((select jsonb_array_length(pedidos_cocina(:A) -> 'pedidos')), 0, 'ya no aparece en cocina');
reset role;

select throws_ok(
  $$update pedidos set cancelado_motivo = 'x' where id = 'b4000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'motivo solo en cancelados');

set local role anon;
select throws_ok($$select cancelar_pedido('a4000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'anon no cancela');
reset role;
select is((select estado::text from pedidos where id = 'b4000000-0000-4000-8000-000000000001'), 'pendiente',
  'pedido de B intacto');

select * from finish();
rollback;
