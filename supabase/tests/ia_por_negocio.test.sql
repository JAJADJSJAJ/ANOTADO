-- Acceso a la IA por negocio: el dueño prende o apaga ia_activa; ia_permitida solo la
-- cambia el operador (nadie desde la web).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

\set A '\'a0000000-0000-4000-8000-000000000001\''

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

select is((select ia_permitida from negocios where slug = 'el-ceibo'), true, 'seed: El Ceibo con IA');
insert into negocios (nombre, slug) values ('Nuevo', 'nuevo');
select is((select ia_permitida from negocios where slug = 'nuevo'), false, 'un negocio nuevo arranca sin IA');

-- Dueño de A
select pg_temp.como('00000000-0000-4000-a000-0000000000a1');
select lives_ok($$update negocios set ia_activa = false where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'el dueño apaga la IA de su local');
select throws_ok($$update negocios set ia_permitida = true where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'el dueño no toca ia_permitida');

-- Cajero de A
reset role;
select pg_temp.como('00000000-0000-4000-a000-0000000000a2');
update negocios set ia_activa = true where id = :A;  -- la policy lo deja sin efecto

reset role;
select is((select ia_activa from negocios where id = :A), false, 'el cajero no prende la IA');

-- Dueño de B sobre A
select pg_temp.como('00000000-0000-4000-a000-0000000000b1');
update negocios set ia_activa = true where id = :A;
reset role;
select is((select ia_activa from negocios where id = :A), false, 'otro dueño no toca la IA de A');

set local role anon;
select throws_ok($$update negocios set ia_activa = true$$, '42501', null, 'anon no toca nada');

select * from finish();
rollback;
