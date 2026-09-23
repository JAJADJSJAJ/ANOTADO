-- Permisos de tabla y función (GRANT/REVOKE).
--
-- RLS filtra filas, pero no quita permisos: Supabase da por defecto ALL (incluido TRUNCATE,
-- que no pasa por RLS) a anon y authenticated sobre todo lo que se crea en public.
-- Acá se saca todo y se da solo lo que cada policy necesita. Las dos capas se complementan:
-- el GRANT dice qué operación se puede intentar, la policy sobre qué filas.
--
-- Quién saltea todo esto: postgres (dueño de las tablas) y service_role (BYPASSRLS), que
-- usan solo las Edge Functions. Las RPC security definer corren como su dueño, así que
-- validan usuario, negocio y rol por su cuenta.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Lo que se cree en migraciones futuras arranca sin permisos: cada tabla o RPC nueva
-- tiene que declarar sus GRANT explícitamente.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- Helpers usados por las policies.
grant execute on function es_miembro(uuid) to authenticated;
grant execute on function tiene_rol(uuid, rol_miembro[]) to authenticated;

-- anon: nada. Todo requiere login.

-- authenticated: lectura (las policies deciden qué filas).
grant select on
  negocios, miembros, categorias, productos, clientes,
  conversaciones, mensajes, pedidos, pedido_items, uso_ia
to authenticated;

-- negocios: el dueño edita solo datos operativos. slug, activo y wa_phone_number_id
-- los maneja el servidor (el número de WhatsApp es único: nadie debe poder reclamar uno ajeno).
grant update (nombre, zona_horaria, hora_corte_jornada, horarios, config)
  on negocios to authenticated;

-- menú y clientes: escritura limitada por las policies (dueño / cajero).
grant insert, update, delete on categorias, productos, clientes to authenticated;

-- miembros: solo lectura desde la web. Asignar o cambiar roles (incluido el primer dueño
-- al crear un negocio) va por RPC en Fase 4, con invitación y sin poder dejar al
-- negocio sin dueño.
drop policy "gestionar miembros" on miembros;

-- pedidos, pedido_items, conversaciones, mensajes, uso_ia, contadores_pedidos:
-- sin escritura para authenticated. Solo servidor.
