-- Alta de negocios: códigos del operador, registro_permitido y crear_negocio.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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
  '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$', 'código legible, sin 0/O ni 1/I');
select is((select count(*) from codigos_alta where nota = 'Local de prueba'), 1::bigint, 'guarda la nota');
select is((select count(*) from codigos_alta a
           join codigos c on a.codigo_hash = extensions.digest(replace(c.codigo, '-', ''), 'sha256')),
  4::bigint, 'se guarda solo el hash del código');
select throws_ok($$select crear_codigo_alta('x', 0)$$, '22023', null, 'validez de 1 a 90 días');

-- Nadie más genera ni lee códigos -------------------------------------------------------------
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select throws_ok($$select crear_codigo_alta()$$, '42501', null, 'un dueño no genera códigos');
select throws_ok($$select count(*) from codigos_alta$$, '42501', null, 'authenticated no lee códigos');
select throws_ok($$select registro_permitido((select codigo from codigos where nombre = 'bueno'))$$,
  '42501', null, 'authenticated no llama a registro_permitido');

reset role;
set local role anon;
select throws_ok($$select crear_negocio('x', 'y')$$, '42501', null, 'anónimo no crea negocios');

-- registro_permitido (Edge Function registro, con service_role) -----------------------------
reset role;
set local role service_role;
select ok(registro_permitido((select codigo from codigos where nombre = 'registro')), 'código válido: 1ª cuenta');
select ok(registro_permitido((select codigo from codigos where nombre = 'registro')), '2ª cuenta');
select ok(registro_permitido((select codigo from codigos where nombre = 'registro')), '3ª cuenta');
select ok(not registro_permitido((select codigo from codigos where nombre = 'registro')), 'la 4ª no');
-- Una cuenta que no se pudo crear devuelve el cupo, pero no el intento.
select lives_ok($$select liberar_registro((select codigo from codigos where nombre = 'registro'))$$,
  'la función devuelve el cupo');
select ok(registro_permitido((select codigo from codigos where nombre = 'registro')),
  'con el cupo devuelto, se puede de nuevo');
reset role;
select is((select array[registros, intentos] from codigos_alta
           where codigo_hash = hash_codigo((select codigo from codigos where nombre = 'registro'))),
  array[3, 4], 'cuenta cuentas e intentos por separado');
update codigos_alta set registros = 0, intentos = 9
where codigo_hash = hash_codigo((select codigo from codigos where nombre = 'registro'));
set local role service_role;
select ok(registro_permitido((select codigo from codigos where nombre = 'registro')), 'el intento 10 pasa');
select liberar_registro((select codigo from codigos where nombre = 'registro'));
select ok(not registro_permitido((select codigo from codigos where nombre = 'registro')),
  'el 11 no, aunque sobren cupos de cuenta');
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select throws_ok($$select liberar_registro((select codigo from codigos where nombre = 'registro'))$$,
  '42501', null, 'authenticated no devuelve cupos');
reset role;
set local role service_role;
select ok(not registro_permitido('AAAA-BBBB-CCCC'), 'código inexistente');
select ok(not registro_permitido((select codigo from codigos where nombre = 'vencido')), 'código vencido');
select throws_ok($$select registro_permitido()$$, '22023', null, 'hace falta código o invitación');

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
select ok(not registro_permitido((select codigo from codigos where nombre = 'bueno')),
  'con un código ya usado no se crean más cuentas');

reset role;
select is(slug_desde_nombre('Pizzería Ñandú & Cía.'), 'pizzeria-nandu-cia', 'slug sin tildes ni símbolos');
select is(slug_desde_nombre('¡¡!!'), 'local', 'slug por defecto');

select * from finish();
rollback;
