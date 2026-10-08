-- Fase 6 y demo pública: respuestas del bot, avisos del pedido, entrar a la demo, cuentas de
-- demo, demo cerrada, cupos diarios, limpieza y slugs reservados.
begin;
create extension if not exists pgtap with schema extensions;
select plan(88);

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set D '\'d0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set visita1 '\'00000000-0000-4000-a000-0000000000e1\''
\set visita2 '\'00000000-0000-4000-a000-0000000000e2\''
\set viejo '\'00000000-0000-4000-a000-0000000000e3\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal1',
    'amr', '[{"method":"password"}]'::json
  )::text, true);
  set local role authenticated;
end;
$$;
grant execute on function pg_temp.como(uuid) to authenticated;

-- Los claims de como() duran toda la transacción: después de reset role, auth.uid() seguiría
-- siendo el último usuario, y la demo cerrada depende de auth.uid(). Esto los borra.
create function pg_temp.nadie() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Las tablas temporales del test las leen también authenticated y service_role.
create function pg_temp.compartir() returns void language plpgsql as $$
begin
  execute format('grant select on all tables in schema %I to authenticated, service_role', pg_my_temp_schema()::regnamespace);
end;
$$;

delete from limites_ia;
update negocios set wa_phone_number_id = '1111111111', ia_permitida = true, ia_activa = true where id = :A;
-- Cuentas de demo como las crea demo-entrar: app_metadata.demo = true.
insert into auth.users (id, email, raw_app_meta_data, created_at) values
  (:visita1, 'visitante-1@demo.anotado.invalid', '{"demo":true}', now()),
  (:visita2, 'visitante-2@demo.anotado.invalid', '{"demo":true}', now()),
  (:viejo, 'visitante-3@demo.anotado.invalid', '{"demo":true}', now() - interval '2 days');

-- Plata ----------------------------------------------------------------------------------------
select is(formatear_pesos(125000), '$ 1.250', 'pesos con separador de miles');
select is(formatear_pesos(12550), '$ 125,50', 'con centavos');
select is(formatear_pesos(0), '$ 0', 'cero');
select is(formatear_pesos(100000000), '$ 1.000.000', 'millones');

-- Permisos ------------------------------------------------------------------------------------
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'funciones internas: ni anon ni authenticated')
from unnest(array['public.mensaje_bot(uuid, text, text)', 'public.limpiar_demo()', 'public.es_demo(uuid)',
                  'public.formatear_pesos(int)', 'public.es_cuenta_demo(uuid)', 'public.consumir_cupo_demo(text, int)',
                  'public.consumir_ia_demo(uuid, text)', 'public.exigir_producto_demo()', 'public.exigir_demo_sin_cambios()',
                  'public.exigir_cupo_demo()', 'public.anotar_producto_demo()', 'public.consumir_mensaje_demo(uuid, uuid)',
                  'public.consumir_limite_demo(text)', 'public.sumar_visitante_demo(uuid)', 'public.reponer_agotados_demo()']::regprocedure[]) f,
     unnest(array['anon', 'authenticated']) r;
select ok(has_function_privilege('service_role', 'public.sumar_visitante_demo(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.consumir_limite_demo(text)', 'execute'),
  'las cuentas de demo las crea solo el servidor');
select ok(has_function_privilege('service_role', 'public.consumir_mensaje_demo(uuid, uuid)', 'execute'),
  'el simulador consume su cupo desde el servidor');

-- Respuesta del bot al interpretar ------------------------------------------------------------
select pg_temp.compartir();
set local role service_role;
create temp table r1 as select recibir_mensaje_wa('1111111111', 'wamid.bot1', '59899000010', 'Ana', 'texto', 'hola, 2 completas') as r;
reset role;
select pg_temp.nadie();
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
select pg_temp.nadie();

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
select pg_temp.nadie();
create temp table pedido1 as select id, numero, total_centavos from pedidos where conversacion_id = :conv;
select is((select contenido from mensajes where clave = 'confirmado:' || (select id from pedido1)),
  '¡Listo! Tu pedido #' || (select numero from pedido1) || ' quedó confirmado. Total: '
    || formatear_pesos((select total_centavos from pedido1)) || '. Te avisamos cuando esté para retirar.',
  'al confirmar, el bot manda número y total');

select pg_temp.compartir();
set local role service_role;
create temp table r2 as select recibir_mensaje_wa('1111111111', 'wamid.bot2', '59899000011', 'Beto', 'texto', 'una coca') as r;
reset role;
select pg_temp.nadie();
\set conv2 '(select (r ->> \'conversacion_id\')::uuid from r2)'
create temp table visto2 as
  select (select id from mensajes where wa_message_id = 'wamid.bot2') as ultimo,
         (select version from conversaciones where id = :conv2) as version;
select pg_temp.compartir();
set local role service_role;
select recibir_mensaje_wa('1111111111', 'wamid.bot3', '59899000011', 'Beto', 'texto', 'y unas papas');
reset role;
select pg_temp.nadie();
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
select throws_ok(
  format($$select confirmar_conversacion(%L, %L, %s, %L, (select b -> 'items' from item), '{"modo":"retiro"}')$$,
    :A, :conv2, (select version from visto2), (select ultimo from visto2)),
  '40001', null, 'un mensaje nuevo del cliente sí frena la confirmación');
reset role;
select pg_temp.nadie();

-- Tarjetas pegadas a mano (sin cliente): el bot no tiene a quién contestarle.
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
create temp table pegado as
  select confirmar_pedido(:A, 'mostrador', (select b -> 'items' from item), '{"modo":"retiro"}') as r;
reset role;
select pg_temp.nadie();
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
select pg_temp.nadie();
select is((select contenido from mensajes where clave = 'listo:' || (select id from pedido1)),
  'Tu pedido #' || (select numero from pedido1) || ' está listo. Podés pasar a retirarlo.',
  'retiro: avisa cuando está listo');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select retroceder_estado((select id from pedido1), 'listo');
select avanzar_estado((select id from pedido1), 'en_cocina');
reset role;
select pg_temp.nadie();
select is((select count(*) from mensajes where conversacion_id = :conv and clave like 'listo:%'), 1::bigint,
  'deshacer y volver a avanzar no repite el aviso');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select id from pedido1), 'listo');
reset role;
select pg_temp.nadie();
select is((select count(*) from mensajes where clave = 'salio:' || (select id from pedido1)), 0::bigint,
  'retiro: entregar no manda "salió"');

-- Delivery: confirma, sale y avisa.
select pg_temp.compartir();
set local role service_role;
create temp table r3 as select recibir_mensaje_wa('1111111111', 'wamid.bot4', '59899000012', 'Caro', 'texto', 'una pizza') as r;
reset role;
select pg_temp.nadie();
\set conv3 '(select (r ->> \'conversacion_id\')::uuid from r3)'
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
create temp table conf3 as select confirmar_conversacion(:A, :conv3, (select version from conversaciones where id = :conv3),
  (select id from mensajes where wa_message_id = 'wamid.bot4'), (select b -> 'items' from item),
  '{"modo":"delivery","direccion":"Blandengues 450"}') as r;
reset role;
select pg_temp.nadie();
select matches((select contenido from mensajes where clave = 'confirmado:' || (select r ->> 'id' from conf3)),
  'Te avisamos cuando salga\.$', 'delivery: avisa que va a avisar cuando salga');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select (r ->> 'id')::uuid from conf3), 'pendiente');
select avanzar_estado((select (r ->> 'id')::uuid from conf3), 'en_cocina');
reset role;
select pg_temp.nadie();
select is((select count(*) from mensajes where clave = 'listo:' || (select r ->> 'id' from conf3)), 0::bigint,
  'delivery: estar listo no se avisa');
select pg_temp.compartir();
select pg_temp.como(:dueno_a);
select avanzar_estado((select (r ->> 'id')::uuid from conf3), 'listo');
reset role;
select pg_temp.nadie();
select is((select contenido from mensajes where clave = 'salio:' || (select r ->> 'id' from conf3)),
  'Tu pedido #' || (select r ->> 'numero' from conf3) || ' salió. ¡Ya va en camino!', 'delivery: avisa cuando sale');

-- Cancelado.
select pg_temp.compartir();
set local role service_role;
create temp table r4 as select recibir_mensaje_wa('1111111111', 'wamid.bot5', '59899000013', 'Dani', 'texto', 'dos empanadas') as r;
reset role;
select pg_temp.nadie();
\set conv4 '(select (r ->> \'conversacion_id\')::uuid from r4)'
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
create temp table conf4 as select confirmar_conversacion(:A, :conv4, (select version from conversaciones where id = :conv4),
  (select id from mensajes where wa_message_id = 'wamid.bot5'), (select b -> 'items' from item), '{"modo":"retiro"}') as r;
select cancelar_pedido((select (r ->> 'id')::uuid from conf4), 'sin stock');
reset role;
select pg_temp.nadie();
select matches((select contenido from mensajes where clave = 'cancelado:' || (select r ->> 'id' from conf4)),
  'se canceló', 'cancelado: le avisa al cliente');
select unalike((select contenido from mensajes where clave = 'cancelado:' || (select r ->> 'id' from conf4)),
  '%sin stock%', 'sin el motivo interno');

-- Entrar a la demo -----------------------------------------------------------------------------
select pg_temp.compartir();
set local role service_role;
select throws_ok(format($$select sumar_visitante_demo(%L)$$, :cajero_a), '42501', null, 'una cuenta normal no se suma a la demo');
select is(sumar_visitante_demo(:visita1) ->> 'slug', 'el-ceibo-demo', 'una cuenta de demo se suma a la demo');
select lives_ok(format($$select sumar_visitante_demo(%L)$$, :visita1), 'sumarla dos veces no falla');
select sumar_visitante_demo(:visita2);
reset role;
select pg_temp.nadie();
select is((select rol::text from miembros where user_id = :visita1 and negocio_id = :D), 'dueno', 'queda como dueña (prueba también el menú)');
select is((select count(*) from miembros where user_id = :visita1), 1::bigint, 'de un solo local');
select is((select array[email_change_sent_at, reauthentication_sent_at] from auth.users where id = :visita1),
  array['2999-01-01'::timestamptz, '2999-01-01'::timestamptz],
  'Auth no le manda mails: el último cambio de mail y reautenticación queda en 2999');
select throws_ok(format($$insert into miembros (negocio_id, user_id, rol) values (%L, %L, 'cajero')$$, :A, :visita1),
  '42501', null, 'una cuenta de demo no se suma a un local que no es de demo');
select throws_ok(format($$update miembros set negocio_id = %L where user_id = %L$$, :A, :visita1),
  '42501', null, 'ni moviendo su membresía');
select throws_ok(format($$update auth.users set email_change = 'alguien@ejemplo.com' where id = %L$$, :visita1),
  '42501', null, 'una cuenta de demo no completa un cambio de mail');
select throws_ok(format($$update auth.users set email = 'alguien@ejemplo.com' where id = %L$$, :visita1),
  '42501', null, 'ni cambia el mail directo');
insert into auth.users (id, is_anonymous) values ('00000000-0000-4000-a000-0000000000e5', true);
select throws_ok($$update auth.users set email_change = 'alguien@ejemplo.com' where id = '00000000-0000-4000-a000-0000000000e5'$$,
  '42501', null, 'una cuenta anónima tampoco (revisión)');
select lives_ok($$update auth.users set email_change = 'otra@ejemplo.com' where id = '00000000-0000-4000-a000-0000000000a1'$$,
  'una cuenta normal sí puede pedir el cambio');
select lives_ok(format($$update auth.users set last_sign_in_at = now() where id = %L$$, :visita1),
  'el resto de la cuenta se actualiza normal (entrar)');

-- Límite para crear cuentas de demo.
insert into demo_cupos (clave, dia, cuenta) values ('cuentas:' || repeat('c', 64), (now() at time zone 'America/Montevideo')::date, 10) on conflict (clave, dia) do update set cuenta = excluded.cuenta;
select pg_temp.compartir();
set local role service_role;
select is(array_agg(c order by n), array[true, true, true, false], 'hasta 3 cuentas por minuto por IP')
from (select n, consumir_limite_demo(repeat('a', 64)) as c from generate_series(1, 4) n) x;
select is(consumir_limite_demo(repeat('b', 64)), true, 'otra IP tiene su cupo');
select is(consumir_limite_demo(repeat('c', 64)), false, 'hasta 10 cuentas por día por IP');
select throws_ok($$select consumir_limite_demo('no-es-un-hash')$$, '22023', null, 'el hash de la IP se valida');
reset role;
select pg_temp.nadie();

-- En la demo el visitante también cocina; en un local normal, el cajero no.
select pg_temp.compartir();
set local role service_role;
create temp table rd as select recibir_mensaje_wa('000000000001', 'demo:1', '0012345678', 'Visitante', 'texto', 'una muzza') as r;
reset role;
select pg_temp.nadie();
\set convd '(select (r ->> \'conversacion_id\')::uuid from rd)'
create temp table item_d as
  select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 1)) as items
  from productos where negocio_id = :D and nombre = 'Pizza muzzarella';
select pg_temp.compartir();
select pg_temp.como(:visita1);
create temp table confd as select confirmar_conversacion(:D, :convd, (select version from conversaciones where id = :convd),
  (select id from mensajes where wa_message_id = 'demo:1'), (select items from item_d), '{"modo":"retiro"}') as r;
select is(avanzar_estado((select (r ->> 'id')::uuid from confd), 'pendiente') ->> 'estado', 'en_cocina',
  'en la demo, el visitante pasa el pedido a la cocina');
select is(avanzar_estado((select (r ->> 'id')::uuid from confd), 'en_cocina') ->> 'estado', 'listo',
  'y lo marca listo');
select is(jsonb_array_length(pedidos_cocina(:D) -> 'pedidos'), 1, 'y ve la pantalla de la cocina');
reset role;
select pg_temp.nadie();
select pg_temp.compartir();
select pg_temp.como(:cajero_a);
select throws_ok(format($$select avanzar_estado(%L, 'pendiente')$$, (select (r ->> 'id') from conf4)),
  null, null, 'en un local normal, el cajero no mueve lo de la cocina');
reset role;
select pg_temp.nadie();

-- Demo cerrada: lo que el visitante no puede tocar ----------------------------------------------
create temp table base as select id from productos where negocio_id = :D and nombre = 'Pizza muzzarella';
select pg_temp.compartir();
select pg_temp.como(:visita1);
select throws_ok($$update negocios set ia_activa = false where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'no apaga la IA');
select throws_ok($$update negocios set nombre = 'Otro nombre' where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'ni cambia los ajustes del local');
select throws_ok($$insert into categorias (negocio_id, nombre) values ('d0000000-0000-4000-8000-000000000001', 'Nueva')$$,
  '42501', null, 'ni crea categorías');
select throws_ok($$insert into zonas_envio (negocio_id, nombre, costo_centavos) values ('d0000000-0000-4000-8000-000000000001', 'Carrasco', 100)$$,
  '42501', null, 'ni zonas de envío');
select throws_ok($$select crear_invitacion('d0000000-0000-4000-8000-000000000001', 'cajero')$$,
  '42501', null, 'ni invita gente (el registro manda mails)');
select throws_ok(format($$select quitar_miembro('d0000000-0000-4000-8000-000000000001', %L)$$, :visita2),
  '42501', null, 'ni saca a otro visitante');
select throws_ok(format($$select cambiar_rol('d0000000-0000-4000-8000-000000000001', %L, 'cocina')$$, :visita2),
  '42501', null, 'ni le cambia el rol');
select throws_ok(format($$update productos set precio_centavos = 1 where id = %L$$, (select id from base)),
  '42501', null, 'el menú base no se edita');
select throws_ok(format($$delete from productos where id = %L$$, (select id from base)),
  '42501', null, 'ni se borra');
select lives_ok(format($$select marcar_agotado(%L, true)$$, (select id from base)), 'pero sí se marca agotado');
select lives_ok($$insert into productos (negocio_id, categoria_id, nombre, precio_centavos) values
  ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006', 'Prueba 1', 10000),
  ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006', 'Prueba 2', 10000),
  ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006', 'Prueba 3', 10000)$$,
  'agrega hasta 3 productos suyos');
select throws_ok($$insert into productos (negocio_id, categoria_id, nombre, precio_centavos) values
  ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006', 'Prueba 4', 10000)$$,
  '42501', null, 'el cuarto no');
select lives_ok($$update productos set precio_centavos = 12000 where nombre = 'Prueba 1' and negocio_id = 'd0000000-0000-4000-8000-000000000001'$$,
  'edita los suyos');
select lives_ok($$delete from productos where nombre = 'Prueba 3' and negocio_id = 'd0000000-0000-4000-8000-000000000001'$$,
  'y los borra');
reset role;
select pg_temp.nadie();
select pg_temp.compartir();
select pg_temp.como(:visita2);
select throws_ok($$update productos set precio_centavos = 1 where nombre = 'Prueba 1' and negocio_id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'otro visitante no edita los productos de él');
select throws_ok($$delete from productos where nombre = 'Prueba 1' and negocio_id = 'd0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'ni los borra');
reset role;
select pg_temp.nadie();
select is((select count(*) from demo_productos_agregados where user_id = :visita1), 2::bigint, 'quedan anotados como suyos');

-- Cupos de pedidos y clientes.
create temp table item_e as
  select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 1)) as items
  from productos where negocio_id = :D and nombre = 'Empanada de carne';
insert into demo_cupos (clave, dia, cuenta) values
  ('pedidos:' || :visita1, (now() at time zone 'America/Montevideo')::date, 20),
  ('clientes:' || :visita1, (now() at time zone 'America/Montevideo')::date, 10) on conflict (clave, dia) do update set cuenta = excluded.cuenta;
select pg_temp.compartir();
select pg_temp.como(:visita1);
select throws_ok(format($$select confirmar_pedido(%L, 'mostrador', %L, '{"modo":"retiro"}')$$, :D, (select items from item_e)),
  '42501', null, 'hasta 20 pedidos por visitante por día');
select throws_ok($$insert into clientes (negocio_id, telefono) values ('d0000000-0000-4000-8000-000000000001', '0099999999')$$,
  '42501', null, 'hasta 10 clientes cargados a mano por día');
reset role;
select pg_temp.nadie();
select pg_temp.compartir();
select pg_temp.como(:visita2);
select lives_ok(format($$select confirmar_pedido(%L, 'mostrador', %L, '{"modo":"retiro"}')$$, :D, (select items from item_e)),
  'otro visitante sigue pudiendo');
reset role;
select pg_temp.nadie();

-- Topes de mensajes y de IA de la demo --------------------------------------------------------------
insert into demo_cupos (clave, dia, cuenta) values ('mensajes:' || :visita2, (now() at time zone 'America/Montevideo')::date, 60) on conflict (clave, dia) do update set cuenta = excluded.cuenta;
select pg_temp.compartir();
set local role service_role;
select is(consumir_mensaje_demo(:D, :visita1), true, 'el simulador recibe');
select is(consumir_mensaje_demo(:A, :visita1), false, 'un local normal no recibe por el simulador');
select is(consumir_mensaje_demo(:D, :visita2), false, 'hasta 60 mensajes por visitante por día');
select is(array_agg(c order by n), array_fill(true, array[20]) || false, 'en la demo, hasta 20 interpretaciones por minuto')
from (select n, consumir_limite_ia_cliente(:D, gen_random_uuid(), 60, 10) as c from generate_series(1, 21) n) x;
reset role;
select pg_temp.nadie();
select is((select cuenta from demo_cupos where clave = 'ia:' || :D), 20,
  'el intento rechazado por minuto no gasta el cupo del día (revisión)');
delete from limites_ia where negocio_id = :D;
insert into demo_cupos (clave, dia, cuenta) values
  ('ia:cliente:00000000-0000-4000-a000-00000000c11e', (now() at time zone 'America/Montevideo')::date, 25),
  ('ia:' || :visita1, (now() at time zone 'America/Montevideo')::date, 25) on conflict (clave, dia) do update set cuenta = excluded.cuenta;
select pg_temp.compartir();
set local role service_role;
select is(consumir_limite_ia_cliente(:D, '00000000-0000-4000-a000-00000000c11e', 60, 10), false, 'hasta 25 por cliente del simulador por día');
select is(consumir_limite_ia(:D, :visita1, 60, 10), false, 'y 25 por visitante con el botón de pegar mensajes');
select is(consumir_limite_ia(:D, :visita2, 60, 10), true, 'otro visitante sigue pudiendo');
reset role;
select pg_temp.nadie();
update demo_cupos set cuenta = 200 where clave = 'ia:' || :D;
select pg_temp.compartir();
set local role service_role;
select is(consumir_limite_ia(:D, gen_random_uuid(), 60, 10), false, 'y 200 en total por día');
select is(consumir_limite_ia_cliente(:A, gen_random_uuid(), 60, 10), true, 'un local normal no tiene topes diarios');
reset role;
select pg_temp.nadie();

-- Limpieza -----------------------------------------------------------------------------------
update productos set activo = false where negocio_id = :D and nombre in ('Papas fritas', 'Fainá (porción)');
update productos set activo = false where negocio_id = :A and nombre = 'Papas fritas';
select is(reponer_agotados_demo(), 3, 'cada hora vuelve a ofrecer lo agotado de la demo');
select is((select activo from productos where negocio_id = :A and nombre = 'Papas fritas'), false,
  'y no toca los agotados de un local real');
update productos set activo = false where negocio_id = :D and nombre = 'Papas fritas';
insert into miembros (negocio_id, user_id, rol) values (:D, :viejo, 'cajero');
insert into demo_cupos (clave, dia, cuenta) values ('viejo', current_date - 5, 1) on conflict (clave, dia) do update set cuenta = excluded.cuenta;
create temp table pedidos_a as select count(*) as n from pedidos where negocio_id = :A;
select is(limpiar_demo(), 1, 'borra solo la cuenta de demo de más de un día');
select is((select count(*) from auth.users where id in (:visita1, :visita2)), 2::bigint, 'las de hoy siguen');
select is((select count(*) from miembros where user_id = :viejo), 0::bigint, 'su membresía se va con él');
select is((select count(*) from pedidos where negocio_id = :D)
        + (select count(*) from conversaciones where negocio_id = :D)
        + (select count(*) from clientes where negocio_id = :D)
        + (select count(*) from uso_ia where negocio_id = :D), 0::bigint, 'la demo queda sin pedidos, chats, clientes ni uso');
select is((select count(*) from productos where negocio_id = :D and not activo), 0::bigint, 'nada agotado');
select is((select count(*) from productos where negocio_id = :D), 17::bigint, 'queda solo el menú base, entero');
select is((select count(*) from demo_cupos where clave = 'viejo'), 0::bigint, 'los cupos de días viejos se borran');
select is((select count(*) from pedidos where negocio_id = :A), (select n from pedidos_a), 'los otros locales no se tocan');

-- Slugs reservados -------------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-a000-0000000000e4', 'demo@test.test');
insert into codigos_alta (codigo_hash, vence_at) values (hash_codigo('DEMO-DEMO-DEMO-DEMO'), now() + interval '1 day');
select pg_temp.compartir();
select pg_temp.como('00000000-0000-4000-a000-0000000000e4');
select is(crear_negocio('DEMO-DEMO-DEMO-DEMO', 'Demo') ->> 'slug', 'demo-local', 'un local llamado "Demo" no tapa /demo');
reset role;
select pg_temp.nadie();

select * from finish();
rollback;
