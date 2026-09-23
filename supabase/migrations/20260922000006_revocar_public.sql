-- Defensivo: hoy no hay grants a PUBLIC en tablas ni secuencias (verificado), pero si
-- alguna vez se otorgan, anon y authenticated los heredarían sin aparecer en ningún GRANT.
-- Las migraciones corren como postgres, que es dueño de todos los objetos de public.
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;

alter default privileges for role postgres in schema public
  revoke all on tables from public;
alter default privileges for role postgres in schema public
  revoke all on sequences from public;
