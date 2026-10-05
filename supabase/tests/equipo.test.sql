-- Equipo: invitaciones por link, roles y la regla de que el local nunca queda sin dueño.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

\set A '\'a0000000-0000-4000-8000-000000000001\''
\set dueno_a '\'00000000-0000-4000-a000-0000000000a1\''
\set cajero_a '\'00000000-0000-4000-a000-0000000000a2\''
\set cocina_a '\'00000000-0000-4000-a000-0000000000a3\''
\set dueno_b '\'00000000-0000-4000-a000-0000000000b1\''
\set nuevo '\'00000000-0000-4000-a000-0000000000c1\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Estado conocido: solo el equipo del seed (seed.local.sql puede sumar dueños en local).
delete from miembros where negocio_id = :A and user_id not in (:dueno_a, :cajero_a, :cocina_a);
insert into auth.users (id, email) values (:nuevo, 'nuevo@test.test');
create temp table tokens (nombre text primary key, token text, id uuid);
grant all on tokens to authenticated, service_role;

-- Crear invitaciones --------------------------------------------------------------------------
select pg_temp.como(:cajero_a);
select throws_ok($$select crear_invitacion('a0000000-0000-4000-8000-000000000001', 'cocina')$$,
  '42501', null, 'un cajero no invita');

reset role;
select pg_temp.como(:dueno_b);
select throws_ok($$select crear_invitacion('a0000000-0000-4000-8000-000000000001', 'cocina')$$,
  '42501', null, 'el dueño de B no invita a A');

reset role;
select pg_temp.como(:dueno_a);
insert into tokens select 'cocina', r ->> 'token', (r ->> 'id')::uuid
  from (select crear_invitacion(:A, 'cocina') as r) x;
insert into tokens select 'cajero', r ->> 'token', (r ->> 'id')::uuid
  from (select crear_invitacion(:A, 'cajero') as r) x;
insert into tokens select 'revocar', r ->> 'token', (r ->> 'id')::uuid
  from (select crear_invitacion(:A, 'cajero') as r) x;
insert into tokens select 'vencida', r ->> 'token', (r ->> 'id')::uuid
  from (select crear_invitacion(:A, 'cocina') as r) x;

select matches((select token from tokens where nombre = 'cocina'), '^[A-Za-z0-9_-]{43}$',
  'token de 32 bytes en base64url');
select is((select count(*) from invitaciones where negocio_id = :A), 4::bigint, 'el dueño ve sus invitaciones');
select throws_ok($$select token_hash from invitaciones$$, '42501', null, 'el hash no se lee desde la web');
select throws_ok($$insert into invitaciones (negocio_id, rol, token_hash, vence_at)
                   values ('a0000000-0000-4000-8000-000000000001', 'dueno', '\x00', now() + interval '1 day')$$,
  '42501', null, 'nadie inserta invitaciones directo');

reset role;
select is((select count(*) from invitaciones i join tokens t on i.token_hash = extensions.digest(t.token, 'sha256')),
  4::bigint, 'se guarda solo el hash del token');
update invitaciones set vence_at = now() - interval '1 minute'
where id = (select id from tokens where nombre = 'vencida');

select pg_temp.como(:cajero_a);
select is((select count(*) from invitaciones), 0::bigint, 'el cajero no ve invitaciones');

-- Revocar -------------------------------------------------------------------------------------
reset role;
select pg_temp.como(:dueno_b);
select throws_ok(format('select revocar_invitacion(%L)', (select id from tokens where nombre = 'revocar')),
  'P0002', null, 'el dueño de B no revoca invitaciones de A');
reset role;
select pg_temp.como(:dueno_a);
select lives_ok(format('select revocar_invitacion(%L)', (select id from tokens where nombre = 'revocar')),
  'el dueño revoca');

-- registro_permitido con invitación -----------------------------------------------------------
reset role;
set local role service_role;
select ok(registro_permitido(p_token => (select token from tokens where nombre = 'cocina')),
  'una invitación vigente permite crear la cuenta');
select ok(not registro_permitido(p_token => (select token from tokens where nombre = 'revocar')),
  'una revocada no');
select ok(not registro_permitido(p_token => (select token from tokens where nombre = 'vencida')),
  'una vencida no');

-- Ver y aceptar -------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select ver_invitacion('x')$$, '42501', null, 'anónimo no ve invitaciones');

reset role;
select pg_temp.como(:nuevo);
select is(ver_invitacion((select token from tokens where nombre = 'cocina')),
  '{"negocio":"Rotisería El Ceibo","rol":"cocina","ya_es_miembro":false}'::jsonb,
  'quien abre el link ve el local y el rol');
select throws_ok($$select ver_invitacion('no-existe')$$, 'P0002', null, 'token inválido');
select throws_ok($$select aceptar_invitacion((select token from tokens where nombre = 'revocar'))$$,
  'P0002', null, 'no se acepta una revocada');
select throws_ok($$select aceptar_invitacion((select token from tokens where nombre = 'vencida'))$$,
  'P0002', null, 'ni una vencida');
select is(aceptar_invitacion((select token from tokens where nombre = 'cocina')),
  '{"slug":"el-ceibo","rol":"cocina"}'::jsonb, 'acepta y entra con el rol de la invitación');
select ok(tiene_rol(:A, '{cocina}'), 'ya es cocina de A');
select throws_ok($$select aceptar_invitacion((select token from tokens where nombre = 'cocina'))$$,
  'P0002', null, 'el link es de un solo uso');

reset role;
select pg_temp.como(:cajero_a);
select throws_ok($$select aceptar_invitacion((select token from tokens where nombre = 'cajero'))$$,
  '23505', null, 'un miembro no cambia su rol con un link');
select throws_ok($$insert into miembros values ('a0000000-0000-4000-8000-000000000001',
                   '00000000-0000-4000-a000-0000000000b1', 'cocina')$$,
  '42501', null, 'miembros sigue sin escritura directa');

-- Equipo con mails ----------------------------------------------------------------------------
select throws_ok($$select * from miembros_negocio('a0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'el cajero no ve los mails del equipo');
reset role;
select pg_temp.como(:dueno_a);
select results_eq(
  $$select email, rol::text from miembros_negocio('a0000000-0000-4000-8000-000000000001')$$,
  $$values ('dueno@elceibo.test', 'dueno'), ('cajero@elceibo.test', 'cajero'),
           ('cocina@elceibo.test', 'cocina'), ('nuevo@test.test', 'cocina')$$,
  'el dueño ve su equipo con mails, ordenado por rol');

-- Roles ---------------------------------------------------------------------------------------
select lives_ok(format('select cambiar_rol(%L, %L, %L)', :A, :nuevo, 'cajero'), 'el dueño cambia un rol');
select throws_ok(format('select cambiar_rol(%L, %L, %L)', :A, :dueno_a, 'cajero'),
  '22023', null, 'el único dueño no se baja de dueño');
select throws_ok(format('select quitar_miembro(%L, %L)', :A, :dueno_a),
  '22023', null, 'ni se va');
select throws_ok(format('select quitar_miembro(%L, %L)', :A, :dueno_b),
  'P0002', null, 'quitar a alguien que no es del local');
select lives_ok(format('select cambiar_rol(%L, %L, %L)', :A, :cajero_a, 'dueno'), 'nombra otro dueño');
select lives_ok(format('select cambiar_rol(%L, %L, %L)', :A, :dueno_a, 'cocina'),
  'con otro dueño, ya puede bajarse');

reset role;
select pg_temp.como(:dueno_b);
select throws_ok(format('select quitar_miembro(%L, %L)', :A, :nuevo), '42501', null, 'el dueño de B no toca A');

reset role;
select pg_temp.como(:dueno_a);
select throws_ok(format('select cambiar_rol(%L, %L, %L)', :A, :nuevo, 'dueno'),
  '42501', null, 'quien dejó de ser dueño ya no cambia roles');

reset role;
select pg_temp.como(:cajero_a);
select lives_ok(format('select quitar_miembro(%L, %L)', :A, :nuevo), 'el nuevo dueño saca a alguien');
select ok(not exists (select 1 from miembros where negocio_id = :A and user_id = :nuevo), 'ya no es miembro');
select results_eq($$select rol::text from miembros
                    where negocio_id = 'a0000000-0000-4000-8000-000000000001' and rol = 'dueno'$$,
  $$values ('dueno')$$, 'el local sigue con exactamente un dueño');

select * from finish();
rollback;
