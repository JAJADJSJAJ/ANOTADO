-- guardar_interpretacion y consumir_limite_ia: atomicidad, versión y permisos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

delete from limites_ia;

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''

-- Desde el navegador (authenticated) no se pueden llamar ---------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-a000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select guardar_interpretacion('a0000000-0000-4000-8000-000000000001', null, null, null, 'hola', '{}', '{}', 'x', 1, 1)$$,
  '42501', null, 'authenticated no puede llamar guardar_interpretacion');
select throws_ok(
  $$select consumir_limite_ia('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000a2', 99, 99)$$,
  '42501', null, 'authenticated no puede llamar consumir_limite_ia');
reset role;

-- Como service_role (Edge Function) ------------------------------------------------------------
set local role service_role;

create temp table r1 as
select * from guardar_interpretacion(:A, null, null, ' Ana ', 'hola, 2 completas',
  '{"items":[],"entrega":null}', '{"dudosos":["x"],"preguntas":[],"errores":[]}', 'modelo-x', 900, 40);

select is((select version from r1), 1, 'conversación nueva arranca en versión 1');
select is((select etiqueta from conversaciones where id = (select conversacion_id from r1)), 'Ana', 'etiqueta recortada');
select is((select count(*) from mensajes where conversacion_id = (select conversacion_id from r1)), 1::bigint, 'mensaje guardado');
select is((select tokens_entrada from uso_ia where conversacion_id = (select conversacion_id from r1)), 900, 'uso de IA registrado');

-- Segundo mensaje con la versión correcta.
create temp table r2 as
select * from guardar_interpretacion(:A, (select conversacion_id from r1), 1, null, 'y una coca',
  '{"items":[],"entrega":{"modo":"retiro"}}', '{"dudosos":[],"preguntas":[],"errores":[]}', 'modelo-x', 1, 1);
select is((select version from r2), 2, 'la versión sube');
select is((select etiqueta from conversaciones where id = (select conversacion_id from r1)), 'Ana', 'etiqueta null no la borra');

-- Otro mensaje que leyó la versión 1 (llegó en paralelo): se rechaza.
select throws_ok(
  format($$select guardar_interpretacion('a0000000-0000-4000-8000-000000000001', %L, 1, null, 'otro', '{}', '{}', 'x', 1, 1)$$,
    (select conversacion_id from r1)),
  '40001', null, 'versión vieja: se rechaza (dos mensajes simultáneos no se pisan)');
select is((select count(*) from mensajes where conversacion_id = (select conversacion_id from r1)), 2::bigint,
  'el rechazado no dejó mensaje (transacción)');

-- Conversación de otro negocio o cerrada.
select throws_ok(
  format($$select guardar_interpretacion('b0000000-0000-4000-8000-000000000001', %L, 2, null, 'x', '{}', '{}', 'x', 1, 1)$$,
    (select conversacion_id from r1)),
  '22023', null, 'no se escribe en una conversación de otro negocio');
update conversaciones set estado = 'cerrada' where id = (select conversacion_id from r1);
select throws_ok(
  format($$select guardar_interpretacion('a0000000-0000-4000-8000-000000000001', %L, 2, null, 'x', '{}', '{}', 'x', 1, 1)$$,
    (select conversacion_id from r1)),
  '22023', null, 'no se escribe en una conversación cerrada');
select throws_ok(
  $$select guardar_interpretacion('a0000000-0000-4000-8000-000000000001', null, null, null, '', '{}', '{}', 'x', 1, 1)$$,
  '22023', null, 'mensaje vacío');

-- Límite: 2 por usuario, 3 por negocio.
select is(consumir_limite_ia(:A, '00000000-0000-4000-a000-0000000000a1', 3, 2), true, 'usuario 1: 1ra llamada');
select is(consumir_limite_ia(:A, '00000000-0000-4000-a000-0000000000a1', 3, 2), true, 'usuario 1: 2da llamada');
select is(consumir_limite_ia(:A, '00000000-0000-4000-a000-0000000000a1', 3, 2), false, 'usuario 1: 3ra pasa su límite');
select is(consumir_limite_ia(:A, '00000000-0000-4000-a000-0000000000a2', 3, 2), false,
  'otro usuario: el negocio ya pasó su límite (4 > 3)');

select * from finish();
rollback;
