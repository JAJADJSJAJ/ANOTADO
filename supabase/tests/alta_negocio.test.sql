-- Alta de negocios: códigos del operador, reservas de registro, límite de solicitudes y crear_negocio.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

\set nuevo '\'00000000-0000-4000-a000-0000000000c1\''
\set otro '\'00000000-0000-4000-a000-0000000000c2\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Usuarios sin local (como los que crea la Edge Function registro).
insert into auth.users (id, email) values
  (:nuevo, 'nuevo@test.test'),
  (:otro, 'otro@test.test');

-- Operador ----------------------------------------------------------------------------------
create temp table codigos (nombre text primary key, codigo text);
grant all on codigos to authenticated, service_role;
insert into codigos values
  ('bueno', crear_codigo_alta('Local de prueba')),
  ('segundo', crear_codigo_alta()),
  ('vencido', crear_codigo_alta()),
  ('registro', crear_codigo_alta());
update codigos_alta set vence_at = now() - interval '1 minute'
where codigo_hash = hash_codigo((select codigo from codigos where nombre = 'vencido'));

select matches((select codigo from codigos where nombre = 'bueno'),
  '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$', 'código de 16 caracteres legibles, sin 0/O ni 1/I');
select is((select count(*) from codigos_alta where nota = 'Local de prueba'), 1::bigint, 'guarda la nota');
select is((select count(*) from codigos_alta a
           join codigos c on a.codigo_hash = extensions.digest(replace(c.codigo, '-', ''), 'sha256')),
  4::bigint, 'se guarda solo el hash del código');
select throws_ok($$select crear_codigo_alta('x', 0)$$, '22023', null, 'validez de 1 a 90 días');

-- Nadie más genera ni lee códigos -------------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select throws_ok($$select crear_codigo_alta()$$, '42501', null, 'un dueño no genera códigos');
select throws_ok($$select reservar_registro('a@test.test', (select codigo from codigos where nombre = 'bueno'))$$,
  '42501', null, 'authenticated no reserva cupos');
select throws_ok($$select resolver_reserva(gen_random_uuid())$$,
  '42501', null, 'authenticated no resuelve reservas');
select throws_ok($$select consumir_limite_registro(repeat('a', 64), 5, 60)$$,
  '42501', null, 'authenticated no toca el límite de solicitudes');

reset role;
set local role anon;
select throws_ok($$select crear_negocio('x', 'y')$$, '42501', null, 'anónimo no crea negocios');

-- Reservas de registro (Edge Function registro, con service_role) ----------------------------
reset role;
set local role service_role;
create function pg_temp.reservar(p_email text) returns uuid language sql as $$
  select reservar_registro(p_email, (select codigo from codigos where nombre = 'registro'));
$$;
create temp table reservas (n int primary key, id uuid);
insert into reservas select g, pg_temp.reservar('nueva' || g || '@test.test') from generate_series(1, 4) g;
select is((select count(id)::int from reservas), 3, 'hasta 3 cuentas por código: la 4ª reserva no sale');

-- La 1ª no creó cuenta; la 2ª sí (aparece un usuario con ese mail después de reservar).
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-a000-0000000000c9', 'NUEVA2@test.test');
set local role service_role;
select is(resolver_reserva((select id from reservas where n = 1)), 'liberada',
  'sin cuenta nueva con ese mail: se libera el cupo');
select is(resolver_reserva((select id from reservas where n = 2)), 'creada',
  'con cuenta nueva (aunque Auth haya devuelto error): queda gastado');
select is(resolver_reserva((select id from reservas where n = 1)), 'liberada',
  'idempotente: una reserva resuelta no cambia');
-- Cuenta que ya existía al reservar (reenvío o "ya tenés cuenta"): no gasta cupo.
insert into reservas values (5, pg_temp.reservar('nueva2@test.test'));
select ok((select id from reservas where n = 5) is not null, 'con un cupo liberado, se puede de nuevo');
select is(resolver_reserva((select id from reservas where n = 5)), 'liberada',
  'el mail ya tenía cuenta al reservar: no cuenta como nueva');
select throws_ok($$select resolver_reserva(gen_random_uuid())$$, 'P0002', null, 'reserva inexistente');

-- Máximo 10 intentos por código, aunque sobren cupos de cuenta. Cada reserva se libera
-- enseguida (como un mail que no creó cuenta).
do $$
declare r uuid;
begin
  for g in 1..7 loop
    r := pg_temp.reservar('nadie@test.test');
    insert into reservas values (10 + g, r);
    if r is not null then perform resolver_reserva(r); end if;
  end loop;
end $$;
select is((select count(id)::int from reservas where n > 10), 6,
  'van 4 intentos + 6 más = 10; el resto no sale');
select is((select email_hash from reservas_registro where id = (select id from reservas where n = 1)),
  extensions.digest('nueva1@test.test', 'sha256'),
  'del mail se guarda solo el hash (en minúsculas)');

select ok(reservar_registro('a@test.test', 'AAAA-BBBB-CCCC-DDDD') is null, 'código inexistente');
select ok(reservar_registro('a@test.test', (select codigo from codigos where nombre = 'vencido')) is null, 'código vencido');
select throws_ok($$select reservar_registro('a@test.test')$$, '22023', null, 'hace falta código o invitación');
select throws_ok($$select reservar_registro(' ', (select codigo from codigos where nombre = 'registro'))$$,
  '22023', null, 'hace falta el mail');

-- Límite de solicitudes: por IP y total.
select ok((select bool_and(consumir_limite_registro(repeat('a', 64), 3, 100)) from generate_series(1, 3)),
  '3 solicitudes de la misma IP pasan');
select ok(not consumir_limite_registro(repeat('a', 64), 3, 100), 'la 4ª no');
select ok(consumir_limite_registro(repeat('b', 64), 3, 100), 'otra IP sí');
select ok(not consumir_limite_registro(repeat('c', 64), 3, 5), 'el total corta aunque la IP sea nueva');
select throws_ok($$select consumir_limite_registro('1.2.3.4', 3, 100)$$, '22023', null,
  'solo hashes, nunca la IP en claro');

-- crear_negocio -------------------------------------------------------------------------------
reset role;
select pg_temp.como(:nuevo);
-- Se escribe como sea: minúsculas, espacios, sin guiones.
select is(
  (select crear_negocio(lower(replace((select codigo from codigos where nombre = 'bueno'), '-', ' ')),
                        '  El Ceibo  ') ->> 'slug'),
  'el-ceibo-2', 'crea el negocio; si el slug existe, le agrega un número');

reset role;
select results_eq(
  $$select n.nombre, m.rol::text, n.ia_permitida from negocios n join miembros m on m.negocio_id = n.id
    where n.slug = 'el-ceibo-2'$$,
  $$values ('El Ceibo', 'dueno', false)$$,
  'quien lo crea es el único dueño y el local arranca sin IA');
select ok((select usado_por = '00000000-0000-4000-a000-0000000000c1' and negocio_id is not null
           from codigos_alta where nota = 'Local de prueba'), 'el código queda usado y vinculado');

select pg_temp.como(:otro);
select throws_ok($$select crear_negocio((select codigo from codigos where nombre = 'bueno'), 'Otro')$$,
  '22023', null, 'un código usado no sirve de nuevo');
select throws_ok($$select crear_negocio((select codigo from codigos where nombre = 'vencido'), 'Otro')$$,
  '22023', null, 'código vencido');
select throws_ok($$select crear_negocio((select codigo from codigos where nombre = 'segundo'), '   ')$$,
  '22023', null, 'nombre vacío');
select is((select crear_negocio((select codigo from codigos where nombre = 'segundo'), 'Login') ->> 'slug'),
  'login-local', 'un slug no tapa rutas de la web');
reset role;
select is(slug_desde_nombre(repeat('pizzería ', 20)), rtrim(left(repeat('pizzeria-', 20), 40), '-'),
  'el slug base tiene hasta 40 caracteres');

reset role;
set local role service_role;
select ok(reservar_registro('a@test.test', (select codigo from codigos where nombre = 'bueno')) is null,
  'con un código ya usado no se crean más cuentas');

reset role;
select is(slug_desde_nombre('Pizzería Ñandú & Cía.'), 'pizzeria-nandu-cia', 'slug sin tildes ni símbolos');
select is(slug_desde_nombre('¡¡!!'), 'local', 'slug por defecto');

select * from finish();
rollback;
