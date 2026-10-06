-- Panel del operador: solo operadores con el segundo factor, sin ver contenido de los locales,
-- y la suspensión corta el acceso de todo el local.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set B '\'b0000000-0000-4000-8000-000000000001\''
\set op '\'00000000-0000-4000-a000-0000000000f1\''

-- Sesión como la arma Supabase Auth: aal1 = solo contraseña; aal2 = contraseña + TOTP (amr).
-- p_amr permite simular un aal2 con otro método (no TOTP).
create function pg_temp.como(p_user uuid, p_aal text default 'aal1', p_amr text[] default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', p_aal,
    'amr', (select json_agg(json_build_object('method', m))
            from unnest(coalesce(p_amr, case when p_aal = 'aal2' then '{totp,password}'::text[] else '{password}' end)) m)
  )::text, true);
  set local role authenticated;
end;
$$;

delete from operadores;
delete from registro_operador;
-- Estado conocido: solo los usuarios del seed (seed.local.sql puede sumar dueños en local).
delete from miembros where user_id::text not like '00000000-0000-4000-a000-%';
insert into auth.users (id, email) values (:op, 'operador@anotado.test');
insert into operadores (user_id) values (:op);


-- Permisos efectivos -----------------------------------------------------------------------
select ok(not exists (
  select 1 from unnest('{operadores,registro_operador}'::text[]) t, unnest('{public,anon,authenticated}'::text[]) r
  where has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
), 'operadores y registro_operador: ningún permiso para public, anon ni authenticated');
select ok(not has_function_privilege('anon', 'public.crear_negocio(text,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.crear_negocio(text,text)', 'EXECUTE'),
  'crear_negocio: solo authenticated (el reemplazo conserva los permisos)');
select ok(not exists (
  select 1 from unnest(array['es_operador()', 'sesion_con_totp()', 'exigir_operador()', 'anotar_operador(text,uuid,jsonb)']) f,
               unnest('{public,anon,authenticated}'::text[]) r
  where has_function_privilege(r, 'public.' || f, 'EXECUTE')
), 'las funciones internas del operador no se llaman desde la API');

-- Invitación del local A, creada antes de suspenderlo.
create temp table inv (token text);
grant all on inv to authenticated, service_role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
insert into inv select crear_invitacion(:A, 'cajero') ->> 'token';
reset role;
reset role;
-- Nadie escribe ni lee las tablas del operador desde la web --------------------------------
select pg_temp.como(:op, 'aal2');
select throws_ok($$insert into operadores values ('00000000-0000-4000-a000-0000000000a1')$$,
  '42501', null, 'nadie se nombra operador desde la web (ni un operador)');
select throws_ok($$select count(*) from registro_operador$$, '42501', null, 'el registro no se lee desde la web');

-- Segundo factor ------------------------------------------------------------------------------
reset role;
select pg_temp.como(:op, 'aal1');
select is(mi_estado_operador(), '{"operador": true, "segundo_factor": false}'::jsonb,
  'sabe que es operador y que le falta el código');
select throws_ok($$select * from operador_locales()$$, '42501', null, 'sin el código del celular no ve nada');
select throws_ok($$select operador_crear_codigo('x')$$, '42501', null, 'ni genera códigos');
reset role;
select pg_temp.como(:op, 'aal2', '{sms,password}');
select is(mi_estado_operador() ->> 'segundo_factor', 'false', 'aal2 con otro método (no TOTP): no cuenta');
select throws_ok($$select * from operador_locales()$$, '42501', null, 'y no entra al panel');

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a1', 'aal2');
select is(mi_estado_operador() ->> 'operador', 'false', 'un dueño no es operador');
select throws_ok($$select * from operador_locales()$$, '42501', null, 'un dueño con 2FA tampoco entra al panel');
select throws_ok(
  $$select operador_cambiar_ia('b0000000-0000-4000-8000-000000000001', true)$$,
  '42501', null, 'ni se habilita la IA');

reset role;
set local role anon;
select throws_ok($$select * from operador_locales()$$, '42501', null, 'anónimo no');

-- Operador con el código -------------------------------------------------------------------
reset role;
select pg_temp.como(:op, 'aal2');
select is(mi_estado_operador(), '{"operador": true, "segundo_factor": true}'::jsonb, 'operador con 2FA');
select ok((select count(*) from operador_locales()) >= 2, 've todos los locales');
select results_eq(
  $$select nombre, duenos, ia_permitida from operador_locales() where slug in ('el-ceibo', 'la-esquina') order by slug$$,
  $$values ('Rotisería El Ceibo', array['dueno@elceibo.test'], true),
           ('Pizzería La Esquina', array['dueno@laesquina.test'], false)$$,
  'con dueños e IA');
select is((select count(*) from pedidos), 0::bigint, 'pero no lee pedidos de nadie');
select is((select count(*) from productos), 0::bigint, 'ni productos');

select lives_ok($$select operador_cambiar_ia('b0000000-0000-4000-8000-000000000001', true)$$, 'habilita la IA de B');
select throws_ok($$select operador_cambiar_ia(gen_random_uuid(), true)$$, 'P0002', null, 'local inexistente');

-- Códigos
select matches(operador_crear_codigo('Bar Nuevo', 7),
  '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$', 'genera un código de 16');
select is((select estado from operador_codigos() where nota = 'Bar Nuevo'), 'vigente', 'y lo lista vigente');
select lives_ok(
  format('select operador_anular_codigo(%L)', (select id from operador_codigos() where nota = 'Bar Nuevo')),
  'lo anula');
select is((select estado from operador_codigos() where nota = 'Bar Nuevo'), 'vencido', 'queda vencido');
select throws_ok(
  format('select operador_anular_codigo(%L)', (select id from operador_codigos() where nota = 'Bar Nuevo')),
  'P0002', null, 'no se anula dos veces');

-- Suspender el local A ------------------------------------------------------------------------
select throws_ok(format('select operador_cambiar_activo(%L, false, %L)', :A, repeat('x', 201)),
  '22023', null, 'motivo acotado');
select lives_ok(format('select operador_cambiar_activo(%L, false, %L)', :A, 'no pagó'), 'suspende A');
reset role;
select pg_temp.como(:op);
select throws_ok($$select ver_invitacion((select token from inv))$$, 'P0002', null,
  'la invitación de un local suspendido no se ve');
select throws_ok($$select aceptar_invitacion((select token from inv))$$, 'P0002', null, 'ni se acepta');
reset role;
set local role service_role;
select ok(reservar_registro('nuevo@test.test', p_token => (select token from inv)) is null,
  'ni sirve para crear una cuenta');

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select is((select count(*) from negocios), 0::bigint, 'el dueño de A ya no ve su local');
select is((select count(*) from productos), 0::bigint, 'ni su menú');
select ok(not tiene_rol(:A, '{dueno}'), 'ni tiene rol para las RPC');
select throws_ok(
  format('select confirmar_pedido(%L, %L, %L)', :A, 'mostrador',
         (select jsonb_build_array(jsonb_build_object('producto_id', id, 'cantidad', 1)) from productos limit 1)),
  '42501', null, 'ni puede confirmar pedidos');
select results_eq($$select nombre from mis_locales_suspendidos()$$, $$values ('Rotisería El Ceibo')$$,
  'pero sabe que está suspendido');

reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000b1');
select is((select count(*) from negocios), 1::bigint, 'otros locales siguen andando');

reset role;
select pg_temp.como(:op, 'aal2');
select lives_ok(format('select operador_cambiar_activo(%L, true)', :A), 'reactiva A');

reset role;
select results_eq(
  $$select accion, detalle from registro_operador order by id$$,
  $$values ('ia_permitida', '{}'::jsonb),
           ('codigo_creado', '{"dias": 7, "nota": "Bar Nuevo"}'::jsonb),
           ('codigo_anulado', jsonb_build_object('codigo_id', (select id from codigos_alta where nota = 'Bar Nuevo'))),
           ('suspendido', '{"motivo": "no pagó"}'::jsonb),
           ('reactivado', '{}'::jsonb)$$,
  'cada acción queda registrada');

select * from finish();
rollback;
