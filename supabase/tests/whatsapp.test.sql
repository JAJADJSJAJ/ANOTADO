-- WhatsApp (Fase 5): mensajes del webhook, turno de la IA, autoguardado del cajero, confirmar
-- con la última versión, avisos en tiempo real y conexión del número por el operador.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set cocina_a '\'00000000-0000-4000-a000-0000000000a3\''
\set cajero_b '\'00000000-0000-4000-a000-0000000000b2\''
\set op '\'00000000-0000-4000-a000-0000000000f1\''
\set topic_a '\'negocio:a0000000-0000-4000-8000-000000000001:conversaciones\''

create function pg_temp.como(p_user uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
    'amr', case when p_aal = 'aal2' then '[{"method":"totp"},{"method":"password"}]'::json else '[{"method":"password"}]'::json end
  )::text, true);
  set local role authenticated;
end;
$$;

create function pg_temp.mensajes_visibles(p_topic text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform set_config('realtime.topic', p_topic, true);
  select count(*) into v from realtime.messages where topic = p_topic;
  return v;
end;
$$;
grant execute on function pg_temp.mensajes_visibles(text) to authenticated;
grant execute on function pg_temp.como(uuid, text) to authenticated;

-- Estado conocido.
delete from limites_ia;
delete from operadores;
delete from miembros where user_id::text not like '00000000-0000-4000-a000-%';
update negocios set wa_phone_number_id = '1111111111', ia_permitida = true, ia_activa = true where id = :A;
update negocios set wa_phone_number_id = '2222222222' where id = :B;

-- Desde el navegador no se llaman las funciones del webhook ------------------------------------
select pg_temp.como(:dueno_a);
select throws_ok($$select recibir_mensaje_wa('1111111111', 'wamid.x', '59899000001', null, 'texto', 'hola')$$,
  '42501', null, 'authenticated no puede llamar recibir_mensaje_wa');
select throws_ok($$select tomar_conversacion_wa('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 30)$$,
  '42501', null, 'authenticated no puede tomar el turno de la IA');
select throws_ok($$select soltar_conversacion_wa('a0000000-0000-4000-8000-000000000001', gen_random_uuid())$$,
  '42501', null, 'authenticated no puede soltar el turno');
select throws_ok($$select consumir_limite_ia_cliente('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 9, 9)$$,
  '42501', null, 'authenticated no puede consumir el límite');
select throws_ok($$select guardar_interpretacion_wa('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 0,
  array[gen_random_uuid()], '{"items":[],"entrega":null}', '{}', 'x', 1, 1)$$,
  '42501', null, 'authenticated no puede guardar interpretaciones');
reset role;

-- Webhook (service_role) ----------------------------------------------------------------------
set local role service_role;

select is(recibir_mensaje_wa('9999999999', 'wamid.0', '59899000001', 'Ana', 'texto', 'hola'), null,
  'un número que no es de ningún local se descarta');

create temp table m1 as select recibir_mensaje_wa('1111111111', 'wamid.1', '59899000001', ' Ana ', 'texto', 'hola, 2 completas') as r;
select is((select (r ->> 'negocio_id')::uuid from m1), :A, 'el local sale del número que recibió el mensaje');
select is((select (r ->> 'interpretar')::boolean from m1), true, 'texto con la IA prendida: hay que interpretar');
\set conv '(select (r ->> \'conversacion_id\')::uuid from m1)'
select is((select nombre from clientes where negocio_id = :A and telefono = '59899000001'), 'Ana',
  'cliente creado con el nombre del perfil, recortado');
select is((select cliente_id from conversaciones where id = :conv),
  (select id from clientes where negocio_id = :A and telefono = '59899000001'), 'la conversación es del cliente');
select is((select interpretado from mensajes where wa_message_id = 'wamid.1'), false, 'el texto entra sin interpretar');

select is(recibir_mensaje_wa('1111111111', 'wamid.1', '59899000001', 'Ana', 'texto', 'hola, 2 completas'), null,
  'reintento de Meta: no se guarda dos veces');
select is((select count(*) from mensajes where wa_message_id = 'wamid.1'), 1::bigint, 'un solo mensaje');

create temp table m2 as select recibir_mensaje_wa('1111111111', 'wamid.2', '59899000001', 'Otro nombre', 'audio', '[Audio]') as r;
select is((select (r ->> 'conversacion_id')::uuid from m2), :conv, 'el segundo mensaje va a la misma conversación');
select is((select (r ->> 'interpretar')::boolean from m2), false, 'un audio no se manda a la IA');
select is((select interpretado from mensajes where wa_message_id = 'wamid.2'), true, 'el audio no queda pendiente de IA');
select is((select nombre from clientes where negocio_id = :A and telefono = '59899000001'), 'Ana',
  'el nombre del perfil no pisa el que ya estaba');

-- Mismo teléfono escribiéndole a otro local: otro cliente, otra conversación.
create temp table mb as select recibir_mensaje_wa('2222222222', 'wamid.b1', '59899000001', 'Ana', 'texto', 'una muzza') as r;
select is((select negocio_id from conversaciones where id = (select (r ->> 'conversacion_id')::uuid from mb)), :B,
  'el mismo cliente en otro local abre una conversación de ese local');
select is((select (r ->> 'interpretar')::boolean from mb), false, 'La Esquina no tiene IA: no se interpreta');

select throws_ok($$select recibir_mensaje_wa('1111111111', 'wamid.3', '+598 99', null, 'texto', 'hola')$$,
  '22023', null, 'teléfono con formato inválido');
select throws_ok($$select recibir_mensaje_wa('1111111111', 'wamid.3', '59899000001', null, 'texto', '')$$,
  '22023', null, 'mensaje vacío');

-- Turno de la IA.
select is(tomar_conversacion_wa(:A, :conv, 60), true, 'el primero toma el turno');
select is(tomar_conversacion_wa(:A, :conv, 60), false, 'otro proceso no lo toma mientras está vigente');
select is(tomar_conversacion_wa(:B, :conv, 60), false, 'con otro negocio no se toma');
select is(soltar_conversacion_wa(:A, :conv), true, 'al soltar avisa que quedan mensajes sin interpretar');
update conversaciones set interpretando_hasta = now() - interval '1 second' where id = :conv;
select is(tomar_conversacion_wa(:A, :conv, 60), true, 'un turno vencido se puede tomar (proceso caído)');

-- Guardar lo interpretado.
create temp table v0 as select version from conversaciones where id = :conv;
create temp table nuevo_item as
  select jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 2)), 'entrega', null) as b
  from productos where negocio_id = :A and activo limit 1;
select throws_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.1')],
    '{"items":[],"entrega":null}', '{}', 'x', 1, 1)$$, :B, :conv, (select version from v0)),
  '22023', null, 'no se guarda en una conversación de otro negocio');
select throws_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.1')],
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', %L, 'cantidad', 1)), 'entrega', null),
    '{}', 'x', 1, 1)$$, :A, :conv, (select version from v0),
    (select id from productos where negocio_id = :B limit 1)),
  '23514', null, 'la base rechaza productos de otro negocio');
select throws_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.1')],
    '{"items":[{"producto_id":"x","cantidad":1}],"entrega":null}', '{}', 'x', 1, 1)$$, :A, :conv, (select version from v0)),
  '22023', null, 'item con forma inválida');
select is(
  guardar_interpretacion_wa(:A, :conv, (select version from v0), array[(select id from mensajes where wa_message_id = 'wamid.1')],
    (select b from nuevo_item), '{"dudosos":["la de siempre"],"preguntas":[],"errores":[]}', 'modelo-x', 10, 5),
  (select version from v0) + 1, 'guardar sube la versión');
select is((select interpretado from mensajes where wa_message_id = 'wamid.1'), true, 'marca el mensaje que leyó la IA');
select is((select count(*) from uso_ia where conversacion_id = :conv), 1::bigint, 'registra el uso de IA');
select throws_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.1')],
    '{"items":[],"entrega":null}', '{}', 'x', 1, 1)$$, :A, :conv, (select version from v0)),
  '40001', null, 'con una versión vieja se rechaza (el cajero editó en el medio)');

-- Un mensaje que llega mientras la IA interpreta otro queda pendiente.
select recibir_mensaje_wa('1111111111', 'wamid.4', '59899000001', null, 'texto', 'y una coca');
select is(soltar_conversacion_wa(:A, :conv), true, 'el que llegó en el medio sigue pendiente al soltar');
select is((select interpretado from mensajes where wa_message_id = 'wamid.4'), false, 'no se marcó por error');

-- Límite por cliente y por negocio.
select is(consumir_limite_ia_cliente(:A, gen_random_uuid(), 3, 1), true, 'cliente 1: primera');
select is(consumir_limite_ia_cliente(:A, (select cliente_id from conversaciones where id = :conv), 3, 1), true, 'cliente 2: primera');
select is(consumir_limite_ia_cliente(:A, (select cliente_id from conversaciones where id = :conv), 3, 1), false,
  'cliente 2: segunda pasa su límite');
reset role;

-- Mostrador: autoguardado -------------------------------------------------------------------
create temp table v1 as select version from conversaciones where id = :conv;
grant select on v1, v0, m1, nuevo_item to authenticated;
select pg_temp.como(:cajero_a);
select is(
  guardar_borrador(:conv, (select version from v1), (select b from nuevo_item), '{"dudosos":[],"preguntas":[],"errores":[]}'),
  (select version from v1) + 1, 'el cajero guarda lo que editó');
select throws_ok(
  format($$select guardar_borrador(%L, %s, '{"items":[],"entrega":null}', '{}')$$, :conv, (select version from v1)),
  '40001', null, 'con una versión vieja se rechaza y la pantalla recarga');
select throws_ok(
  format($$select guardar_borrador(%L, %s, '{"items":[],"entrega":{"modo":"avion"}}', '{}')$$, :conv, (select version from v1) + 1),
  '22023', null, 'entrega inválida');
select throws_ok(
  format($$select guardar_borrador(%L, %s, '{"items":[],"entrega":null}', '{"dudosos":[1]}')$$, :conv, (select version from v1) + 1),
  '22023', null, 'pendientes inválidos');
select pg_temp.como(:cocina_a);
select throws_ok(format($$select guardar_borrador(%L, 0, '{"items":[],"entrega":null}', '{}')$$, :conv),
  '42501', null, 'cocina no edita conversaciones');
select pg_temp.como(:cajero_b);
select throws_ok(format($$select guardar_borrador(%L, 0, '{"items":[],"entrega":null}', '{}')$$, :conv),
  '42501', null, 'el cajero de otro local tampoco');
select is((select count(*) from mensajes where conversacion_id = :conv), 0::bigint, 'ni ve sus mensajes');
reset role;

-- Confirmar con la última versión -------------------------------------------------------------
-- En una transacción todos los now() son iguales: se escalonan las horas como en la realidad.
update mensajes m set created_at = now() - make_interval(mins => (10 - o.n)::int)
from (select id, row_number() over (order by wa_message_id) as n from mensajes where conversacion_id = :conv) o
where m.id = o.id;
create temp table actual as
  select version,
    (select id from mensajes where conversacion_id = :conv order by created_at desc limit 1) as ultimo,
    (select id from mensajes where conversacion_id = :conv order by created_at desc offset 1 limit 1) as anterior
  from conversaciones where id = :conv;
grant select on actual to authenticated;
select pg_temp.como(:cajero_a);
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, (select b -> 'items' from nuevo_item), '{"modo":"retiro"}')$$,
    :A, :conv, (select version from actual), (select anterior from actual)),
  '40001', null, 'si llegó un mensaje que la pantalla no vio, no confirma');
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, null, (select b -> 'items' from nuevo_item), '{"modo":"retiro"}')$$,
    :A, :conv, (select version from actual)),
  '40001', null, 'sin haber visto ningún mensaje, tampoco');
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, (select b -> 'items' from nuevo_item), '{"modo":"retiro"}')$$,
    :A, :conv, (select version from actual), (select id from mensajes where wa_message_id = 'wamid.b1')),
  '40001', null, 'un mensaje de otra conversación no cuenta como visto');
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, (select b -> 'items' from nuevo_item), '{"modo":"retiro"}')$$,
    :A, :conv, (select version from actual) - 1, (select ultimo from actual)),
  '40001', null, 'con una versión vieja no confirma');
select pg_temp.como(:cocina_a);
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, '[]', null)$$, :A, :conv, (select version from actual), (select ultimo from actual)),
  '42501', null, 'cocina no confirma');
select pg_temp.como(:cajero_a);
create temp table confirmado as select confirmar_conversacion(:A, :conv, (select version from actual), (select ultimo from actual),
  (select b -> 'items' from nuevo_item), '{"modo":"retiro"}') as r;
reset role;
select is((select origen::text from pedidos where id = (select (r ->> 'id')::uuid from confirmado)), 'whatsapp', 'pedido creado');
select is((select cliente_id from pedidos where id = (select (r ->> 'id')::uuid from confirmado)),
  (select cliente_id from conversaciones where id = :conv), 'el pedido queda con el cliente');
select is((select estado from conversaciones where id = :conv), 'cerrada', 'la conversación se cierra');

-- Un mensaje después de confirmar abre otra conversación.
set local role service_role;
create temp table m5 as select recibir_mensaje_wa('1111111111', 'wamid.5', '59899000001', null, 'texto', 'me olvidé la coca') as r;
reset role;
select isnt((select (r ->> 'conversacion_id')::uuid from m5), :conv, 'después de confirmar, conversación nueva');

-- 30 min quieta y sin pedido armado: se cierra y empieza otra.
\set c5 '(select (r ->> \'conversacion_id\')::uuid from m5)'
update conversaciones set ultimo_mensaje_at = now() - interval '20 minutes' where id = :c5;
set local role service_role;
create temp table m6 as select recibir_mensaje_wa('1111111111', 'wamid.6', '59899000001', null, 'texto', 'hola?') as r;
reset role;
select is((select (r ->> 'conversacion_id')::uuid from m6), :c5, 'a los 20 min sigue la misma conversación');
update conversaciones set ultimo_mensaje_at = now() - interval '40 minutes' where id = :c5;
set local role service_role;
create temp table m7 as select recibir_mensaje_wa('1111111111', 'wamid.7', '59899000001', null, 'texto', 'hola de nuevo') as r;
reset role;
\set c7 '(select (r ->> \'conversacion_id\')::uuid from m7)'
select isnt(:c7, :c5, 'después de 30 min sin mensajes ni pedido armado, conversación nueva');
select is((select estado from conversaciones where id = :c5), 'cerrada', 'la vieja queda cerrada');

-- Con un pedido armado sin confirmar aguanta hasta 3 h (si no, desaparecería del mostrador).
update conversaciones set borrador = (select b from nuevo_item), ultimo_mensaje_at = now() - interval '2 hours' where id = :c7;
set local role service_role;
create temp table m8 as select recibir_mensaje_wa('1111111111', 'wamid.8', '59899000001', null, 'texto', 'y?') as r;
reset role;
select is((select (r ->> 'conversacion_id')::uuid from m8), :c7, 'con pedido armado, a las 2 h sigue la misma');
update conversaciones set ultimo_mensaje_at = now() - interval '4 hours' where id = :c7;
set local role service_role;
create temp table m9 as select recibir_mensaje_wa('1111111111', 'wamid.9', '59899000001', null, 'texto', 'hola') as r;
reset role;
select isnt((select (r ->> 'conversacion_id')::uuid from m9), :c7, 'con pedido armado, a las 4 h conversación nueva');

-- Local suspendido: no recibe.
update negocios set activo = false where id = :B;
set local role service_role;
select is(recibir_mensaje_wa('2222222222', 'wamid.b2', '59899000001', null, 'texto', 'hola'), null,
  'un local suspendido no recibe mensajes');
reset role;
update negocios set activo = true where id = :B;

-- Tiempo real ---------------------------------------------------------------------------------
select ok((select count(*) from realtime.messages where topic = :topic_a and event = 'conversacion') > 0,
  'los mensajes avisan al canal de conversaciones del local');
select pg_temp.como(:cajero_a);
select ok(pg_temp.mensajes_visibles(:topic_a) > 0, 'el cajero escucha las conversaciones de su local');
select pg_temp.como(:cocina_a);
select is(pg_temp.mensajes_visibles(:topic_a), 0::bigint, 'cocina no escucha conversaciones');
select pg_temp.como(:cajero_b);
select is(pg_temp.mensajes_visibles(:topic_a), 0::bigint, 'otro local tampoco');
reset role;

-- Operador: conectar el número ----------------------------------------------------------------
insert into auth.users (id, email) values (:op, 'operador@anotado.test');
insert into operadores (user_id) values (:op);
select pg_temp.como(:dueno_a);
select throws_ok(format($$select operador_conectar_whatsapp(%L, '3333333333')$$, :A), '42501', null,
  'un dueño no conecta números');
select pg_temp.como(:op, 'aal2');
select throws_ok(format($$select operador_conectar_whatsapp(%L, '2222222222')$$, :A), '23505', null,
  'un número ya conectado a otro local no se repite');
select lives_ok(format($$select operador_conectar_whatsapp(%L, ' 3333333333 ')$$, :A), 'el operador conecta el número');
reset role;

select finish();
rollback;
