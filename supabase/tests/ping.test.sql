-- ping: anon lo puede ejecutar y sigue sin acceso a nada más.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(has_function_privilege('anon', 'public.ping()', 'EXECUTE'), 'anon ejecuta ping');

set local role anon;
select is(public.ping(), true, 'ping devuelve true');
reset role;

-- Lo único: ninguna otra función ni tabla de public le queda a anon.
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['ping'],
  'ping es la única función de public que anon puede ejecutar');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
     and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')),
  0,
  'anon sigue sin acceso a tablas ni vistas');
select ok(not has_function_privilege('authenticated', 'public.ping()', 'EXECUTE'),
  'authenticated no lo necesita');

select * from finish();
rollback;
