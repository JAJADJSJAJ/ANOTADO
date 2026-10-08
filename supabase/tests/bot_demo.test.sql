-- Fase 6 y demo pública: respuestas del bot, avisos del pedido, entrar a la demo, cuentas
-- anónimas, topes diarios, limpieza y slugs reservados.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set D '\'d0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set anon1 '\'00000000-0000-4000-a000-0000000000e1\''
\set anon2 '\'00000000-0000-4000-a000-0000000000e2\''
\set viejo '\'00000000-0000-4000-a000-0000000000e3\''

create function pg_temp.como(p_user uuid, p_anonimo boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal1', 'is_anonymous', p_anonimo,
    'amr', '[{"method":"password"}]'::json
  )::text, true);
  set local role authenticated;
end;
$$;
grant execute on function pg_temp.como(uuid, boolean) to authenticated;

-- Las tablas temporales del test las leen también authenticated y service_role.
create function pg_temp.compartir() returns void language plpgsql as $$
begin
  execute format('grant select on all tables in schema %I to authenticated, service_role', pg_my_temp_schema()::regnamespace);
end;
$$;

delete from limites_ia;
update negocios set wa_phone_number_id = '1111111111', ia_permitida = true, ia_activa = true where id = :A;
insert into auth.users (id, is_anonymous, created_at) values
  (:anon1, true, now()),
  (:anon2, true, now()),
  (:viejo, true, now() - interval '2 days');

-- Plata ----------------------------------------------------------------------------------------
select is(formatear_pesos(125000), '$ 1.250', 'pesos con separador de miles');
select is(formatear_pesos(12550), '$ 125,50', 'con centavos');
select is(formatear_pesos(0), '$ 0', 'cero');
select is(formatear_pesos(100000000), '$ 1.000.000', 'millones');

-- Permisos ------------------------------------------------------------------------------------
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'funciones internas: ni anon ni authenticated')
from unnest(array['public.mensaje_bot(uuid, text, text)', 'public.limpiar_demo()', 'public.es_demo(uuid)',
                  'public.demo_sin_cupo_ia(uuid)', 'public.formatear_pesos(int)']::regprocedure[]) f,
     unnest(array['anon', 'authenticated']) r;
select ok(has_function_privilege('authenticated', 'public.unirse_demo()', 'execute')
          and not has_function_privilege('anon', 'public.unirse_demo()', 'execute'),
  'unirse_demo: authenticated sí, anon no');
select ok(has_function_privilege('service_role', 'public.demo_puede_recibir(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.demo_puede_recibir(uuid)', 'execute'),
  'demo_puede_recibir: solo service_role');

-- Respuesta del bot al interpretar ------------------------------------------------------------
select pg_temp.compartir();
set local role service_role;
create temp table r1 as select recibir_mensaje_wa('1111111111', 'wamid.bot1', '59899000010', 'Ana', 'texto', 'hola, 2 completas') as r;
reset role;
\set conv '(select (r ->> \'conversacion_id\')::uuid from r1)'
create temp table item as
  select jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 2)), 'entrega', null) as b
  from productos where negocio_id = :A and activo order by nombre limit 1;
create temp table v0 as select version from conversaciones where id = :conv;
select pg_temp.compartir();
set local role service_role;
select throws_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.bot1')],
    (select b from item), '{}', 'x', 1, 1, repeat('a', 1001))$$, :A, :conv, (select version from v0)),
  '22023', null, 'una respuesta de más de 1000 caracteres no se guarda');
select throws_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.bot1')],
    (select b from item), '{}', 'x', 1, 1, 'Anoté: 2 completas.')$$, :A, :conv, (select version from v0) + 1),
  '40001', null, 'con versión vieja no se guarda nada');
select is((select count(*) from mensajes where conversacion_id = :conv and rol = 'asistente'), 0::bigint,
  'y la respuesta tampoco (un reintento no contesta dos veces)');
select lives_ok(
  format($$select guardar_interpretacion_wa(%L, %L, %s, array[(select id from mensajes where wa_message_id = 'wamid.bot1')],
    (select b from item), '{}', 'x', 1, 1, '  Anoté: 2 completas.  ')$$, :A, :conv, (select version from v0)),
  'guarda la interpretación con respuesta');
select is((select contenido from mensajes where conversacion_id = :conv and rol = 'asistente'), 'Anoté: 2 completas.',
  'la respuesta queda como mensaje del asistente, sin espacios de más');
select is((select interpretado from mensajes where conversacion_id = :conv and rol = 'asistente'), true,
  'la respuesta no queda pendiente de interpretar');
reset role;

-- Confirmar: la respuesta del bot no frena, un mensaje del cliente sí ---------------------------
create temp table visto as
  select (select id from mensajes where wa_message_id = 'wamid.bot1') as ultimo,
         (select version from conversaciones where id = :conv) as version;
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
select lives_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, (select b -> 'items' from item), '{"modo":"retiro"}')$$,
    :A, :conv, (select version from visto), (select ultimo from visto)),
  'una respuesta del bot después del último mensaje visto no frena la confirmación');
reset role;
create temp table pedido1 as select id, numero, total_centavos from pedidos where conversacion_id = :conv;
select is((select contenido from mensajes where clave = 'confirmado:' || (select id from pedido1)),
  '¡Listo! Tu pedido #' || (select numero from pedido1) || ' quedó confirmado. Total: '
    || formatear_pesos((select total_centavos from pedido1)) || '. Te avisamos cuando esté para retirar.',
  'al confirmar, el bot manda número y total');

select pg_temp.compartir();
set local role service_role;
create temp table r2 as select recibir_mensaje_wa('1111111111', 'wamid.bot2', '59899000011', 'Beto', 'texto', 'una coca') as r;
reset role;
\set conv2 '(select (r ->> \'conversacion_id\')::uuid from r2)'
create temp table visto2 as
  select (select id from mensajes where wa_message_id = 'wamid.bot2') as ultimo,
         (select version from conversaciones where id = :conv2) as version;
select pg_temp.compartir();
set local role service_role;
select recibir_mensaje_wa('1111111111', 'wamid.bot3', '59899000011', 'Beto', 'texto', 'y unas papas');
reset role;
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, (select b -> 'items' from item), '{"modo":"retiro"}')$$,
    :A, :conv2, (select version from visto2), (select ultimo from visto2)),
  '40001', null, 'un mensaje nuevo del cliente sí frena la confirmación');
reset role;

-- Tarjetas pegadas a mano (sin cliente): el bot no tiene a quién contestarle.
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
create temp table pegado as
  select confirmar_pedido(:A, 'mostrador', (select b -> 'items' from item), '{"modo":"retiro"}') as r;
reset role;
select is((select count(*) from mensajes where clave = 'confirmado:' || (select r ->> 'id' from pegado)), 0::bigint,
  'un pedido sin conversación no genera mensajes');
insert into conversaciones (negocio_id) values (:A);
select mensaje_bot((select id from conversaciones where negocio_id = :A and cliente_id is null order by created_at desc limit 1), 'hola');
select is((select count(*) from mensajes m join conversaciones c on c.id = m.conversacion_id
           where c.cliente_id is null and m.rol = 'asistente'), 0::bigint,
  'una conversación sin cliente no recibe mensajes del bot');

-- Avisos de estado -----------------------------------------------------------------------------
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select id from pedido1), 'pendiente');
select avanzar_estado((select id from pedido1), 'en_cocina');
reset role;
select is((select contenido from mensajes where clave = 'listo:' || (select id from pedido1)),
  'Tu pedido #' || (select numero from pedido1) || ' está listo. Podés pasar a retirarlo.',
  'retiro: avisa cuando está listo');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select retroceder_estado((select id from pedido1), 'listo');
select avanzar_estado((select id from pedido1), 'en_cocina');
reset role;
select is((select count(*) from mensajes where conversacion_id = :conv and clave like 'listo:%'), 1::bigint,
  'deshacer y volver a avanzar no repite el aviso');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select id from pedido1), 'listo');
reset role;
select is((select count(*) from mensajes where clave = 'salio:' || (select id from pedido1)), 0::bigint,
  'retiro: entregar no manda "salió"');

-- Delivery: confirma, sale y avisa.
select pg_temp.compartir();
set local role service_role;
create temp table r3 as select recibir_mensaje_wa('1111111111', 'wamid.bot4', '59899000012', 'Caro', 'texto', 'una pizza') as r;
reset role;
\set conv3 '(select (r ->> \'conversacion_id\')::uuid from r3)'
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
create temp table conf3 as select confirmar_conversacion(:A, :conv3, (select version from conversaciones where id = :conv3),
  (select id from mensajes where wa_message_id = 'wamid.bot4'), (select b -> 'items' from item),
  '{"modo":"delivery","direccion":"Blandengues 450"}') as r;
reset role;
select matches((select contenido from mensajes where clave = 'confirmado:' || (select r ->> 'id' from conf3)),
  'Te avisamos cuando salga\.$', 'delivery: avisa que va a avisar cuando salga');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select (r ->> 'id')::uuid from conf3), 'pendiente');
select avanzar_estado((select (r ->> 'id')::uuid from conf3), 'en_cocina');
reset role;
select is((select count(*) from mensajes where clave = 'listo:' || (select r ->> 'id' from conf3)), 0::bigint,
  'delivery: estar listo no se avisa');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select (r ->> 'id')::uuid from conf3), 'listo');
reset role;
select is((select contenido from mensajes where clave = 'salio:' || (select r ->> 'id' from conf3)),
  'Tu pedido #' || (select r ->> 'numero' from conf3) || ' salió. ¡Ya va en camino!', 'delivery: avisa cuando sale');

-- Cancelado.
select pg_temp.compartir();
set local role service_role;
create temp table r4 as select recibir_mensaje_wa('1111111111', 'wamid.bot5', '59899000013', 'Dani', 'texto', 'dos empanadas') as r;
reset role;
\set conv4 '(select (r ->> \'conversacion_id\')::uuid from r4)'
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
create temp table conf4 as select confirmar_conversacion(:A, :conv4, (select version from conversaciones where id = :conv4),
  (select id from mensajes where wa_message_id = 'wamid.bot5'), (select b -> 'items' from item), '{"modo":"retiro"}') as r;
select cancelar_pedido((select (r ->> 'id')::uuid from conf4), 'sin stock');
reset role;
select matches((select contenido from mensajes where clave = 'cancelado:' || (select r ->> 'id' from conf4)),
  'se canceló', 'cancelado: le avisa al cliente');
select unalike((select contenido from mensajes where clave = 'cancelado:' || (select r ->> 'id' from conf4)),
  '%sin stock%', 'sin el motivo interno');

-- Entrar a la demo -----------------------------------------------------------------------------
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
select throws_ok($$select unirse_demo()$$, '42501', null, 'una cuenta con mail no entra a la demo');
reset role;
select pg_temp.compartir();
select pg_temp.como(:anon1, true);
select is(unirse_demo() ->> 'slug', 'el-ceibo-demo', 'un visitante anónimo entra a la demo');
select lives_ok($$select unirse_demo()$$, 'entrar dos veces no falla');
reset role;
select is((select rol::text from miembros where user_id = :anon1 and negocio_id = :D), 'cajero', 'queda como cajero');
select is((select count(*) from miembros where user_id = :anon1), 1::bigint, 'de un solo local');
select throws_ok(format($$insert into miembros (negocio_id, user_id, rol) values (%L, %L, 'cajero')$$, :A, :anon1),
  '42501', null, 'una cuenta anónima no se suma a un local que no es de demo');
select throws_ok(format($$update miembros set negocio_id = %L where user_id = %L$$, :A, :anon1),
  '42501', null, 'ni moviendo su membresía');

-- En la demo el cajero también cocina; en un local normal, no.
select pg_temp.compartir();
set local role service_role;
create temp table rd as select recibir_mensaje_wa('000000000001', 'demo:1', '0012345678', 'Visitante', 'texto', 'una muzza') as r;
reset role;
\set convd '(select (r ->> \'conversacion_id\')::uuid from rd)'
create temp table item_d as
  select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 1)) as items
  from productos where negocio_id = :D and nombre = 'Pizza muzzarella';
select pg_temp.compartir();
select pg_temp.como(:anon1, true);
create temp table confd as select confirmar_conversacion(:D, :convd, (select version from conversaciones where id = :convd),
  (select id from mensajes where wa_message_id = 'demo:1'), (select items from item_d), '{"modo":"retiro"}') as r;
select is(avanzar_estado((select (r ->> 'id')::uuid from confd), 'pendiente') ->> 'estado', 'en_cocina',
  'en la demo, el cajero pasa el pedido a la cocina');
select is(avanzar_estado((select (r ->> 'id')::uuid from confd), 'en_cocina') ->> 'estado', 'listo',
  'y lo marca listo');
select is(jsonb_array_length(pedidos_cocina(:D) -> 'pedidos'), 1, 'y ve la pantalla de la cocina');
reset role;
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
select throws_ok(format($$select avanzar_estado(%L, 'pendiente')$$, (select (r ->> 'id') from conf4)),
  null, null, 'en un local normal, el cajero no mueve lo de la cocina');
reset role;

-- Topes diarios de la demo -----------------------------------------------------------------------
select is(demo_puede_recibir(:D), true, 'la demo recibe mensajes');
select is(demo_puede_recibir(:A), false, 'un local normal no recibe por el simulador');
insert into uso_ia (negocio_id, modelo, tokens_entrada, tokens_salida)
select :D, 'x', 1, 1 from generate_series(1, 300);
insert into uso_ia (negocio_id, modelo, tokens_entrada, tokens_salida)
select :A, 'x', 1, 1 from generate_series(1, 300);
select pg_temp.compartir();
set local role service_role;
select is(consumir_limite_ia_cliente(:D, gen_random_uuid(), 60, 10), false, 'demo: con 300 usos en el día, no hay más IA');
select is(consumir_limite_ia(:D, gen_random_uuid(), 60, 10), false, 'tampoco para el botón de pegar mensajes');
select is(consumir_limite_ia_cliente(:A, gen_random_uuid(), 60, 10), true, 'un local normal no tiene tope diario');
reset role;
insert into mensajes (negocio_id, conversacion_id, rol, contenido)
select :D, :convd, 'cliente', 'x' from generate_series(1, 3000);
select is(demo_puede_recibir(:D), false, 'con 3000 mensajes en el día, la demo deja de recibir');

-- Limpieza -----------------------------------------------------------------------------------
update productos set activo = false where negocio_id = :D and nombre = 'Papas fritas';
select pg_temp.compartir();
select pg_temp.como(:anon2, true);
select unirse_demo();
reset role;
insert into miembros (negocio_id, user_id, rol) values (:D, :viejo, 'cajero');
create temp table pedidos_a as select count(*) as n from pedidos where negocio_id = :A;
select is(limpiar_demo(), 1, 'borra solo el usuario anónimo de más de un día');
select is((select count(*) from auth.users where id in (:anon1, :anon2)), 2::bigint, 'los de hoy siguen');
select is((select count(*) from miembros where user_id = :viejo), 0::bigint, 'su membresía se va con él');
select is((select count(*) from pedidos where negocio_id = :D)
        + (select count(*) from conversaciones where negocio_id = :D)
        + (select count(*) from clientes where negocio_id = :D)
        + (select count(*) from uso_ia where negocio_id = :D), 0::bigint, 'la demo queda sin pedidos, chats, clientes ni uso');
select is((select count(*) from productos where negocio_id = :D and not activo), 0::bigint, 'nada agotado');
select is((select count(*) from productos where negocio_id = :D), 17::bigint, 'el menú queda entero');
select is((select count(*) from pedidos where negocio_id = :A), (select n from pedidos_a), 'los otros locales no se tocan');

-- Slugs reservados -------------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-a000-0000000000e4', 'demo@test.test');
insert into codigos_alta (codigo_hash, vence_at) values (hash_codigo('DEMO-DEMO-DEMO-DEMO'), now() + interval '1 day');
select pg_temp.compartir();
select pg_temp.como('00000000-0000-4000-a000-0000000000e4');
select is(crear_negocio('DEMO-DEMO-DEMO-DEMO', 'Demo') ->> 'slug', 'demo-local', 'un local llamado "Demo" no tapa /demo');
reset role;

select * from finish();
rollback;
