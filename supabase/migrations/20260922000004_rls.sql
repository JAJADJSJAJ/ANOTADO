-- Seguridad por negocio.
--
-- Principio: la web (rol authenticated) solo escribe lo que el usuario edita a mano
-- (menú, clientes, equipo). Pedidos, conversaciones, mensajes y uso de IA se escriben
-- únicamente desde el servidor: Edge Functions con service_role o RPCs security definer
-- que validan y recalculan (crear pedido en Fase 1, avanzar_estado en Fase 3).
-- Así nadie puede insertar un pedido con total inventado desde el navegador.

-- Helpers. security definer para leer miembros sin pasar por su propia RLS (evita recursión).
create function es_miembro(n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros where negocio_id = n and user_id = auth.uid()
  );
$$;

create function tiene_rol(n uuid, roles public.rol_miembro[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros
    where negocio_id = n and user_id = auth.uid() and rol = any (roles)
  );
$$;

revoke execute on function es_miembro(uuid) from public, anon;
revoke execute on function tiene_rol(uuid, rol_miembro[]) from public, anon;
grant execute on function es_miembro(uuid) to authenticated;
grant execute on function tiene_rol(uuid, rol_miembro[]) to authenticated;

-- RLS en todas las tablas, sin excepción. Sin policy = sin acceso.
alter table negocios enable row level security;
alter table miembros enable row level security;
alter table categorias enable row level security;
alter table productos enable row level security;
alter table clientes enable row level security;
alter table conversaciones enable row level security;
alter table mensajes enable row level security;
alter table pedidos enable row level security;
alter table pedido_items enable row level security;
alter table uso_ia enable row level security;
alter table contadores_pedidos enable row level security;  -- solo el trigger

-- negocios: alta en Fase 4 (RPC), nunca se borra desde la web.
create policy "ver negocio" on negocios for select to authenticated
  using (es_miembro(id));
create policy "editar negocio" on negocios for update to authenticated
  using (tiene_rol(id, '{dueno}'))
  with check (tiene_rol(id, '{dueno}'));

-- miembros: todos ven a su equipo, solo el dueño lo gestiona.
create policy "ver miembros" on miembros for select to authenticated
  using (es_miembro(negocio_id));
create policy "gestionar miembros" on miembros for all to authenticated
  using (tiene_rol(negocio_id, '{dueno}'))
  with check (tiene_rol(negocio_id, '{dueno}'));

-- menú: todos lo ven, solo el dueño lo edita.
create policy "ver categorias" on categorias for select to authenticated
  using (es_miembro(negocio_id));
create policy "editar categorias" on categorias for all to authenticated
  using (tiene_rol(negocio_id, '{dueno}'))
  with check (tiene_rol(negocio_id, '{dueno}'));

create policy "ver productos" on productos for select to authenticated
  using (es_miembro(negocio_id));
create policy "editar productos" on productos for all to authenticated
  using (tiene_rol(negocio_id, '{dueno}'))
  with check (tiene_rol(negocio_id, '{dueno}'));

-- clientes: dueño y cajero los ven y cargan; borrar, solo el dueño. Cocina no ve teléfonos.
create policy "ver clientes" on clientes for select to authenticated
  using (tiene_rol(negocio_id, '{dueno,cajero}'));
create policy "crear clientes" on clientes for insert to authenticated
  with check (tiene_rol(negocio_id, '{dueno,cajero}'));
create policy "editar clientes" on clientes for update to authenticated
  using (tiene_rol(negocio_id, '{dueno,cajero}'))
  with check (tiene_rol(negocio_id, '{dueno,cajero}'));
create policy "borrar clientes" on clientes for delete to authenticated
  using (tiene_rol(negocio_id, '{dueno}'));

-- conversaciones y mensajes: lectura para dueño y cajero; escritura solo servidor.
create policy "ver conversaciones" on conversaciones for select to authenticated
  using (tiene_rol(negocio_id, '{dueno,cajero}'));
create policy "ver mensajes" on mensajes for select to authenticated
  using (tiene_rol(negocio_id, '{dueno,cajero}'));

-- pedidos: todos los miembros los ven (cocina incluida); escritura solo por RPC.
create policy "ver pedidos" on pedidos for select to authenticated
  using (es_miembro(negocio_id));
create policy "ver items" on pedido_items for select to authenticated
  using (es_miembro(negocio_id));

-- uso de IA: solo el dueño.
create policy "ver uso ia" on uso_ia for select to authenticated
  using (tiene_rol(negocio_id, '{dueno}'));
