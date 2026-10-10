-- Fase 7: stock del día, confirmación automática y aviso de demora.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

delete from pedidos;
delete from contadores_pedidos;
-- Lo que se haya prendido a mano en la base local no cuenta para el test.
update negocios set config = config - 'auto' where id = 'a0000000-0000-4000-8000-000000000001';

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set C1 '\'c7000000-0000-4000-8000-000000000001\''
\set C2 '\'c7000000-0000-4000-8000-000000000002\''
\set V1 '\'c8000000-0000-4000-8000-000000000001\''
\set V2 '\'c8000000-0000-4000-8000-000000000002\''
\set C3 '\'c7000000-0000-4000-8000-000000000003\''
\set V3 '\'c8000000-0000-4000-8000-000000000003\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
create function pg_temp.nadie() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create temp table prod as
  select (select id from productos where negocio_id = :A and nombre = 'Agua sin gas 600 ml') as agua,
         (select id from productos where negocio_id = :A and nombre = 'Cerveza Pilsen 1 L') as birra;
grant select on prod to authenticated;
\set agua '(select agua from prod)'
\set birra '(select birra from prod)'

-- 1. Stock --------------------------------------------------------------------------------------

update productos set stock_dia = 3 where id = :agua;
select is((select stock from productos where id = :agua), 3, 'al poner el stock del día, hoy arranca con ese número');
select is((select stock_jornada from productos where id = :agua), jornada_actual(:A), 'y es de la jornada de hoy');

select pg_temp.como(:cajero_a);
select is((confirmar_pedido(:A, 'mostrador', jsonb_build_array(jsonb_build_object('producto_id', :agua, 'cantidad', 2)), '{"modo":"retiro"}') ->> 'numero')::int, 1,
  'el mostrador confirma con stock');
reset role;
select is((select stock from productos where id = :agua), 1, 'y descuenta');
select ok((select descontado from pedido_items where producto_id = :agua limit 1), 'el ítem queda marcado como descontado');

select pg_temp.como(:cajero_a);
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador',
    jsonb_build_array(jsonb_build_object('producto_id', (select agua from prod), 'cantidad', 2)), '{"modo":"retiro"}')$$,
  'AN001', 'De Agua sin gas 600 ml quedan 1', 'no alcanza: no se crea y dice cuántos quedan');
-- Dos líneas del mismo producto suman.
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador',
    jsonb_build_array(jsonb_build_object('producto_id', (select agua from prod), 'cantidad', 1),
                      jsonb_build_object('producto_id', (select agua from prod), 'cantidad', 1, 'notas', 'fría')), '{"modo":"retiro"}')$$,
  'AN001', null, 'dos líneas del mismo producto se suman para el stock');
select is((confirmar_pedido(:A, 'mostrador', jsonb_build_array(jsonb_build_object('producto_id', :agua, 'cantidad', 1)), '{"modo":"retiro"}') ->> 'numero')::int, 2,
  'la última unidad sí');
reset role;
select is((select stock from productos where id = :agua), 0, 'quedan 0');
select ok((select not activo and agotado_por_stock from productos where id = :agua), 'en 0 queda agotado solo');

select pg_temp.como(:cajero_a);
select throws_ok(
  $$select confirmar_pedido('a0000000-0000-4000-8000-000000000001', 'mostrador',
    jsonb_build_array(jsonb_build_object('producto_id', (select agua from prod), 'cantidad', 1)), '{"modo":"retiro"}')$$,
  'AN001', 'Se terminó Agua sin gas 600 ml', 'agotado por stock: no se confirma y dice que se terminó');
-- Cancelar devuelve lo descontado y vuelve a ofrecerlo.
select is(cancelar_pedido((select id from pedidos where numero = 2 and negocio_id = :A)) ->> 'cambiado', 'true', 'se cancela el pedido de la última');
reset role;
select is((select stock from productos where id = :agua), 1, 'cancelar devuelve el stock');
select ok((select activo and not agotado_por_stock from productos where id = :agua), 'y lo vuelve a ofrecer');

-- Si el dueño cambió el stock del día después de la venta, cancelar no pasa del número nuevo.
select pg_temp.como(:cajero_a);
select ok(confirmar_pedido(:A, 'mostrador', jsonb_build_array(jsonb_build_object('producto_id', :agua, 'cantidad', 1)), '{"modo":"retiro"}') ? 'numero',
  'se vende la que quedaba');
reset role;
update productos set stock_dia = 2 where id = :agua;
select pg_temp.como(:cajero_a);
select cancelar_pedido((select id from pedidos where negocio_id = :A and estado = 'pendiente' order by numero desc limit 1));
reset role;
select is((select stock from productos where id = :agua), 2, 'cancelar no deja más que el stock del día nuevo');
update productos set stock_dia = 3 where id = :agua;

-- Nueva jornada: vuelve al número del día. Un agotado a mano no lo prende la reposición.
update productos set stock = 0, stock_jornada = jornada_actual(:A) - 1, activo = false, agotado_por_stock = true where id = :agua;
update productos set stock_dia = 5 where id = :birra;
update productos set stock_jornada = jornada_actual(:A) - 1, activo = false where id = :birra;
select ok(reponer_stock_diario() >= 2, 'la reposición diaria encuentra los de la jornada pasada');
select ok((select stock = 3 and activo from productos where id = :agua), 'vuelve al número del día y se ofrece');
select ok((select stock = 5 and not activo from productos where id = :birra), 'lo agotado a mano sigue agotado');
update productos set activo = true where id = :birra;

-- La función interna no la llama nadie de afuera.
select ok(not has_function_privilege('authenticated', 'crear_pedido_interno(uuid, origen_pedido, jsonb, jsonb, text, uuid, uuid, boolean)', 'execute'),
  'crear_pedido_interno: authenticated no');
select ok(not has_function_privilege('authenticated', 'confirmar_automatico(uuid, uuid, boolean, int, uuid[], text, int, int, jsonb, jsonb)', 'execute')
  and has_function_privilege('service_role', 'confirmar_automatico(uuid, uuid, boolean, int, uuid[], text, int, int, jsonb, jsonb)', 'execute'),
  'confirmar_automatico: solo service_role');

-- 2. Confirmación automática ----------------------------------------------------------------------

insert into clientes (id, negocio_id, telefono) values (:C1, :A, '59899100001'), (:C2, :A, '59899100002');
insert into conversaciones (id, negocio_id, cliente_id, borrador) values
  (:V1, :A, :C1, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', :birra, 'cantidad', 2)), 'entrega', '{"modo":"retiro"}'::jsonb)),
  (:V2, :A, :C2, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', :birra, 'cantidad', 2)), 'entrega', '{"modo":"retiro"}'::jsonb));

select is(confirmar_automatico(:A, :V1, true) ->> 'motivo', 'apagada', 'apagada por defecto');
update negocios set config = config || '{"auto": {"activa": true}}' where id = :A;
select is(confirmar_automatico(:A, :V1, true) ->> 'motivo', 'cliente_nuevo', 'el primer pedido de un cliente nuevo va a mano');
update negocios set config = config || '{"auto": {"activa": true, "nuevos_a_mano": false}}' where id = :A;
select is(confirmar_automatico(:A, :V1, true), '{"ok": true, "total_centavos": 44000}'::jsonb, 'la prueba devuelve el total del resumen');

-- Sin resumen de esta versión no confirma.
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'motivo', 'cambio', 'sin resumen pedido no confirma');
update conversaciones set resumen_version = version, resumen_total = 44000 where id = :V1;
select is(confirmar_automatico(:A, :V1, false, 99) ->> 'motivo', 'cambio', 'con otra versión no confirma');
update conversaciones set resumen_total = 40000 where id = :V1;
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'motivo', 'precio', 'si el total cambió desde el resumen, no confirma');
update conversaciones set resumen_total = 44000 where id = :V1;

-- Algo pendiente o los topes del local lo mandan a mano.
update conversaciones set pendientes = '{"dudosos":["lo de siempre"],"preguntas":[],"errores":[]}' where id = :V1;
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'motivo', 'pendientes', 'con algo dudoso va a mano');
update conversaciones set pendientes = '{"dudosos":[],"preguntas":[],"errores":[]}' where id = :V1;
update negocios set config = config || '{"auto": {"activa": true, "nuevos_a_mano": false, "max_total_centavos": 40000}}' where id = :A;
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'motivo', 'tope_total', 'más caro que el tope va a mano');
update negocios set config = config || '{"auto": {"activa": true, "nuevos_a_mano": false, "max_por_producto": 1}}' where id = :A;
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'motivo', 'tope_producto', 'más unidades que el tope por producto va a mano');
update negocios set config = config || '{"auto": {"activa": true, "nuevos_a_mano": false}}' where id = :A;

-- Todo bien: se confirma solo, queda marcado y cierra la conversación.
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'ok', 'true', 'con el sí y todo en regla, se confirma solo');
select ok((select automatico and creado_por is null from pedidos where conversacion_id = :V1), 'el pedido queda como automático');
select is((select estado from conversaciones where id = :V1), 'cerrada', 'y la conversación se cierra');
select is((select stock from productos where id = :birra), 3, 'descuenta el stock como el mostrador');
select is(confirmar_automatico(:A, :V1, false, 0) ->> 'motivo', 'cerrada', 'un segundo sí no confirma dos veces');

-- La última unidad: el que llega después ve el stock real (el bloqueo por fila se prueba aparte
-- con dos sesiones en paralelo).
update productos set stock = 1 where id = :birra;
update conversaciones set resumen_version = version, resumen_total = 44000 where id = :V2;
select is(confirmar_automatico(:A, :V2, false, 0) ->> 'motivo', 'stock', 'sin stock suficiente va a mano con el detalle');
select is((select estado from conversaciones where id = :V2), 'abierta', 'y la conversación sigue abierta');

-- 3. Aviso de demora ------------------------------------------------------------------------------

update conversaciones set listo_at = now() - interval '11 minutes' where id = :V2;
select is(avisar_demoras(), 1, 'el cliente terminó hace más de 10 minutos y nadie confirmó: se le avisa');
select is(avisar_demoras(), 0, 'una sola vez');
select ok(exists (select 1 from mensajes where conversacion_id = :V2 and rol = 'asistente' and contenido like 'Perdón la demora%'),
  'el aviso queda en la conversación');

-- 4. Un mensaje que no cambia el pedido no invalida el resumen -----------------------------------

insert into clientes (id, negocio_id, telefono) values (:C3, :A, '59899100003');
insert into conversaciones (id, negocio_id, cliente_id, borrador) values
  (:V3, :A, :C3, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', :birra, 'cantidad', 1)), 'entrega', '{"modo":"retiro"}'::jsonb));
insert into mensajes (id, negocio_id, conversacion_id, rol, contenido, interpretado) values
  ('c9000000-0000-4000-8000-000000000001', :A, :V3, 'cliente', 'eso es todo', false),
  ('c9000000-0000-4000-8000-000000000002', :A, :V3, 'cliente', 'gracias', false),
  ('c9000000-0000-4000-8000-000000000003', :A, :V3, 'cliente', 'mejor 2', false);
create temp table b3 as select borrador from conversaciones where id = :V3;
select guardar_interpretacion_wa(:A, :V3, 0, array['c9000000-0000-4000-8000-000000000001'::uuid], (select borrador from b3),
  '{"dudosos":[],"preguntas":[],"errores":[]}', 'prueba', 0, 0, null, 22000, true);
select guardar_interpretacion_wa(:A, :V3, 1, array['c9000000-0000-4000-8000-000000000002'::uuid], (select borrador from b3),
  '{"dudosos":[],"preguntas":[],"errores":[]}', 'prueba', 0, 0);
select ok((select resumen_version = version from conversaciones where id = :V3), 'un "gracias" no invalida el resumen');
select is((select resumen_total from conversaciones where id = :V3), 22000, 'y el total del resumen sigue');
select ok((select listo_at is not null from conversaciones where id = :V3), 'ni el "terminó" (el aviso de demora sigue en pie)');
select guardar_interpretacion_wa(:A, :V3, 2, array['c9000000-0000-4000-8000-000000000003'::uuid],
  jsonb_set((select borrador from b3), '{items,0,cantidad}', '2'), '{"dudosos":[],"preguntas":[],"errores":[]}', 'prueba', 0, 0);
select ok((select resumen_version is null and resumen_total is null from conversaciones where id = :V3), 'un cambio en el pedido sí lo invalida');
select ok((select listo_at is null from conversaciones where id = :V3), 'y vuelve a armando');

-- 5. Guardar una sección de la configuración ----------------------------------------------------

select pg_temp.como(:dueno_a);
select guardar_config(:A, 'pagos', '["efectivo"]');
reset role;
select is((select config -> 'pagos' from negocios where id = :A), '["efectivo"]'::jsonb, 'el dueño guarda una sección');
select is((select (config -> 'auto' ->> 'activa')::boolean from negocios where id = :A), true, 'sin pisar las otras');
select pg_temp.como(:dueno_a);
select throws_ok($$select guardar_config('a0000000-0000-4000-8000-000000000001', 'zonas', '[]')$$, '22023', null,
  'solo las secciones conocidas');
reset role;
select pg_temp.como(:cajero_a);
select throws_ok($$select guardar_config('a0000000-0000-4000-8000-000000000001', 'pagos', '[]')$$, '42501', null,
  'el cajero no la cambia');
reset role;
select pg_temp.nadie();
select ok(not has_function_privilege('anon', 'guardar_config(uuid, text, jsonb)', 'execute'), 'guardar_config: anon no');

select * from finish();
rollback;
