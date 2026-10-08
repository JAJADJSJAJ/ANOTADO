-- Fase 6: el bot responde, y la demo pública.
--
-- 1. El bot le contesta al cliente con PLANTILLAS, nunca con texto libre de la IA:
--    - después de interpretar: lo anotado y lo que falta aclarar (lo arma la Edge Function a
--      partir del borrador y se guarda en la MISMA transacción que la interpretación, así un
--      reintento por versión no duplica la respuesta);
--    - al confirmar el pedido: número y total (calculado acá, no por la IA);
--    - cuando está listo para retirar, cuando sale el delivery, o si se cancela.
--    Las respuestas son mensajes con rol 'asistente'. Mandarlas por Meta queda pendiente: los
--    locales de demo nunca se mandan.
-- 2. confirmar_conversacion: una respuesta del bot no frena la confirmación (antes cualquier
--    mensaje nuevo la frenaba; ahora solo los del cliente).
-- 3. Demo pública (/demo): un local compartido (negocios.es_demo). Cada visitante entra con un
--    usuario anónimo de Supabase y se suma como cajero (unirse_demo). En la demo el cajero
--    también mueve los pedidos de la cocina, para que una persona haga todo el recorrido.
-- 4. Las cuentas anónimas solo pueden ser miembros de locales de demo: no aceptan
--    invitaciones ni crean locales (la limpieza las borra a las 24 h).
-- 5. Tope diario de IA y de mensajes para los locales de demo (además de los por minuto).
-- 6. Limpieza diaria de la demo (pg_cron): pedidos, chats, clientes, agotados y usuarios anónimos.
-- 7. Slugs reservados: se suman /demo y /privacidad.

-- 1. Columnas -------------------------------------------------------------------------------

alter table public.negocios add column es_demo boolean not null default false;

-- Avisos del bot que salen una sola vez por pedido ('confirmado:<pedido>', 'listo:<pedido>'…):
-- deshacer un estado y volver a avanzarlo no repite el mensaje.
alter table public.mensajes
  add column clave text check (char_length(clave) <= 100);
create unique index mensajes_clave on public.mensajes (clave) where clave is not null;

-- 2. Mensajes del bot -------------------------------------------------------------------------

-- $ 1.250 · $ 125,50 (igual que formatearPrecio en shared/dinero.ts).
create function public.formatear_pesos(p_centavos int) returns text
language sql immutable set search_path = '' as $$
  select '$ ' || replace(to_char(p_centavos / 100, 'FM999G999G999G990'), ',', '.')
    || case when p_centavos % 100 = 0 then '' else ',' || lpad((p_centavos % 100)::text, 2, '0') end;
$$;

revoke all on function public.formatear_pesos(int) from public, anon, authenticated;

-- Guarda un mensaje del bot en la conversación, solo si es de WhatsApp (tiene cliente: las
-- tarjetas armadas pegando mensajes no tienen a quién contestarle). Con clave, una sola vez.
create function public.mensaje_bot(p_conversacion_id uuid, p_contenido text, p_clave text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
begin
  select cv.negocio_id into v_negocio_id
  from public.conversaciones cv
  where cv.id = p_conversacion_id and cv.cliente_id is not null;
  if v_negocio_id is null then
    return;
  end if;
  insert into public.mensajes (negocio_id, conversacion_id, rol, contenido, tipo, interpretado, clave)
  values (v_negocio_id, p_conversacion_id, 'asistente', left(p_contenido, 1000), 'texto', true, p_clave)
  on conflict (clave) where clave is not null do nothing;
end;
$$;

revoke all on function public.mensaje_bot(uuid, text, text) from public, anon, authenticated;

-- Avisos del pedido al cliente. Corre en la misma transacción que crea o mueve el pedido.
create function public.avisar_cliente_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_modo text := new.entrega ->> 'modo';
  v_texto text;
begin
  if new.conversacion_id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_texto := '¡Listo! Tu pedido #' || new.numero || ' quedó confirmado. Total: '
      || public.formatear_pesos(new.total_centavos)
      || case when new.envio_centavos > 0 then ' (con ' || public.formatear_pesos(new.envio_centavos) || ' de envío)' else '' end
      || '.'
      || case v_modo
           when 'delivery' then ' Te avisamos cuando salga.'
           when 'retiro' then ' Te avisamos cuando esté para retirar.'
           else '' end;
    perform public.mensaje_bot(new.conversacion_id, v_texto, 'confirmado:' || new.id);
    return null;
  end if;

  if new.estado = 'listo' and v_modo = 'retiro' then
    perform public.mensaje_bot(new.conversacion_id,
      'Tu pedido #' || new.numero || ' está listo. Podés pasar a retirarlo.', 'listo:' || new.id);
  elsif new.estado = 'entregado' and v_modo = 'delivery' then
    perform public.mensaje_bot(new.conversacion_id,
      'Tu pedido #' || new.numero || ' salió. ¡Ya va en camino!', 'salio:' || new.id);
  elsif new.estado = 'cancelado' then
    perform public.mensaje_bot(new.conversacion_id,
      'Tu pedido #' || new.numero || ' se canceló. Si tenés alguna duda, escribinos por acá.', 'cancelado:' || new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.avisar_cliente_pedido() from public, anon, authenticated;

create trigger pedidos_avisar_cliente_alta
  after insert on public.pedidos
  for each row execute function public.avisar_cliente_pedido();

create trigger pedidos_avisar_cliente_estado
  after update of estado on public.pedidos
  for each row when (old.estado is distinct from new.estado)
  execute function public.avisar_cliente_pedido();

-- 3. Interpretación con respuesta ----------------------------------------------------------------

-- Igual que antes, más p_respuesta: lo que el bot le contesta al cliente (o null). Va en la misma
-- transacción: si el cajero editó en el medio (40001), no queda una respuesta sobre un borrador
-- viejo, y el reintento contesta una sola vez.
drop function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int);

create function public.guardar_interpretacion_wa(
  p_negocio_id uuid,
  p_conversacion_id uuid,
  p_version int,
  p_mensajes uuid[],
  p_borrador jsonb,
  p_pendientes jsonb,
  p_modelo text,
  p_tokens_entrada int,
  p_tokens_salida int,
  p_respuesta text default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_estado text;
  v_version int;
  v_respuesta text := nullif(btrim(p_respuesta), '');
begin
  perform public.exigir_borrador_valido(p_negocio_id, p_borrador, true);
  perform public.exigir_pendientes_validos(p_pendientes);
  if coalesce(cardinality(p_mensajes), 0) = 0 then
    raise exception 'Faltan los mensajes interpretados' using errcode = '22023';
  end if;
  if char_length(v_respuesta) > 1000 then
    raise exception 'Respuesta demasiado larga' using errcode = '22023';
  end if;

  select cv.estado, cv.version into v_estado, v_version
  from public.conversaciones cv
  where cv.id = p_conversacion_id and cv.negocio_id = p_negocio_id
  for update;
  if not found or v_estado <> 'abierta' then
    raise exception 'La conversación no existe o ya está cerrada' using errcode = '22023';
  end if;
  if v_version is distinct from p_version then
    raise exception 'La conversación cambió mientras se interpretaba' using errcode = '40001';
  end if;

  -- Todos los ids tienen que ser mensajes de texto del cliente, de ESTA conversación y todavía
  -- sin interpretar: ni de otra conversación, ni ya interpretados, ni audios. Con la fila de la
  -- conversación bloqueada, nadie más los marca en el medio. Repetidos cuentan una vez.
  if (
    select count(*) from public.mensajes m
    where m.id = any (p_mensajes)
      and m.conversacion_id = p_conversacion_id and m.negocio_id = p_negocio_id
      and m.rol = 'cliente' and m.tipo = 'texto' and not m.interpretado
  ) <> (select count(distinct x) from unnest(p_mensajes) x) then
    raise exception 'Mensajes interpretados inválidos' using errcode = '22023';
  end if;

  update public.mensajes m set interpretado = true
  where m.id = any (p_mensajes) and m.conversacion_id = p_conversacion_id and m.negocio_id = p_negocio_id;

  update public.conversaciones cv
  set borrador = p_borrador, pendientes = p_pendientes, version = cv.version + 1
  where cv.id = p_conversacion_id
  returning cv.version into v_version;

  insert into public.uso_ia (negocio_id, conversacion_id, modelo, tokens_entrada, tokens_salida)
  values (p_negocio_id, p_conversacion_id, left(p_modelo, 100), greatest(p_tokens_entrada, 0), greatest(p_tokens_salida, 0));

  if v_respuesta is not null then
    perform public.mensaje_bot(p_conversacion_id, v_respuesta);
  end if;

  return v_version;
end;
$$;

revoke all on function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int, text)
  from public, anon, authenticated;
grant execute on function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int, text)
  to service_role;

-- 4. Confirmar: solo frenan los mensajes del cliente ------------------------------------------

-- Igual que antes, salvo que solo cuenta lo que escribió el cliente después del último mensaje
-- que vio la pantalla: una respuesta del bot no cambia el pedido.
create or replace function public.confirmar_conversacion(
  p_negocio_id uuid,
  p_conversacion_id uuid,
  p_version int,
  p_ultimo_mensaje uuid,
  p_items jsonb,
  p_entrega jsonb default null,
  p_notas text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_version int;
  v_visto bigint;
begin
  if not public.tiene_rol(p_negocio_id, '{dueno,cajero}') then
    raise exception 'Sin permiso para crear pedidos en este negocio' using errcode = '42501';
  end if;
  select cv.version into v_version
  from public.conversaciones cv
  where cv.id = p_conversacion_id and cv.negocio_id = p_negocio_id and cv.estado = 'abierta'
  for update;
  if not found then
    raise exception 'La conversación no existe o ya está cerrada' using errcode = '22023';
  end if;
  -- El último mensaje que vio la pantalla tiene que ser de esta conversación. Se compara por
  -- orden de llegada (mensajes.orden), no por hora: ver el comentario de la columna.
  if p_ultimo_mensaje is not null then
    select m.orden into v_visto
    from public.mensajes m
    where m.id = p_ultimo_mensaje and m.conversacion_id = p_conversacion_id;
    if not found then
      raise exception 'Llegó un mensaje nuevo o la tarjeta cambió. Revisala y confirmá de nuevo.' using errcode = '40001';
    end if;
  end if;
  if v_version is distinct from p_version
     or exists (
       select 1 from public.mensajes m
       where m.conversacion_id = p_conversacion_id
         and m.rol = 'cliente'
         and (v_visto is null or m.orden > v_visto)
     ) then
    raise exception 'Llegó un mensaje nuevo o la tarjeta cambió. Revisala y confirmá de nuevo.' using errcode = '40001';
  end if;
  -- Misma transacción y mismo usuario: confirmar_pedido valida rol, productos, entrega y zona,
  -- recalcula el total y cierra la conversación.
  return public.confirmar_pedido(p_negocio_id, 'whatsapp', p_items, p_entrega, p_notas, p_conversacion_id);
end;
$$;

-- 5. Demo: el cajero también cocina ------------------------------------------------------------

create function public.es_demo(p_negocio_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select ng.es_demo from public.negocios ng where ng.id = p_negocio_id), false);
$$;

revoke all on function public.es_demo(uuid) from public, anon, authenticated;

create or replace function public.puede_mover_estado(
  p_negocio_id uuid, p_desde public.estado_pedido, p_hacia public.estado_pedido
) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when (p_desde, p_hacia) in (('pendiente', 'en_cocina'), ('en_cocina', 'listo'),
                                ('en_cocina', 'pendiente'), ('listo', 'en_cocina'))
      then public.tiene_rol(p_negocio_id, '{dueno,cocina}')
        or (public.es_demo(p_negocio_id) and public.tiene_rol(p_negocio_id, '{cajero}'))
    when (p_desde, p_hacia) in (('listo', 'entregado'), ('entregado', 'listo'))
      then public.tiene_rol(p_negocio_id, '{dueno,cajero}')
    else false
  end;
$$;

-- 6. Demo: entrar ------------------------------------------------------------------------------

-- El visitante (usuario anónimo) se suma como cajero del local de demo. Devuelve el slug.
create function public.unirse_demo() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_negocio_id uuid;
  v_slug text;
begin
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'La demo es solo para visitantes sin cuenta' using errcode = '42501';
  end if;
  select ng.id, ng.slug into v_negocio_id, v_slug
  from public.negocios ng
  where ng.es_demo and ng.activo
  order by ng.created_at
  limit 1;
  if v_negocio_id is null then
    raise exception 'La demo no está disponible' using errcode = 'P0002';
  end if;
  insert into public.miembros (negocio_id, user_id, rol) values (v_negocio_id, v_user, 'cajero')
  on conflict (negocio_id, user_id) do nothing;
  return jsonb_build_object('slug', v_slug, 'negocio_id', v_negocio_id);
end;
$$;

revoke all on function public.unirse_demo() from public, anon, authenticated;
grant execute on function public.unirse_demo() to authenticated;

-- Una cuenta anónima solo puede ser miembro de un local de demo: si no, alguien que probó la
-- demo y después acepta una invitación (o crea su local) en el mismo navegador quedaría con
-- una cuenta que la limpieza borra al otro día.
create function public.exigir_miembro_no_anonimo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users u where u.id = new.user_id and u.is_anonymous)
     and not public.es_demo(new.negocio_id) then
    raise exception 'Con la cuenta de la demo no podés sumarte a un local. Salí y entrá con tu mail.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_miembro_no_anonimo() from public, anon, authenticated;

create trigger miembros_no_anonimos
  before insert or update of negocio_id, user_id on public.miembros
  for each row execute function public.exigir_miembro_no_anonimo();

-- 7. Demo: topes diarios ---------------------------------------------------------------------

-- Locales de demo: hasta 300 interpretaciones de IA por día (unos centavos de dólar). Los
-- límites por minuto siguen igual. Se usa en los dos consumir_limite_*.
create function public.demo_sin_cupo_ia(p_negocio_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.es_demo(p_negocio_id)
    and (select count(*) from public.uso_ia u
         where u.negocio_id = p_negocio_id and u.created_at > now() - interval '1 day') >= 300;
$$;

revoke all on function public.demo_sin_cupo_ia(uuid) from public, anon, authenticated;

-- Mensajes del simulador: hasta 3000 por día entre todos los visitantes (cada uno es una fila).
create function public.demo_puede_recibir(p_negocio_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.es_demo(p_negocio_id)
    and (select count(*) from public.mensajes m
         where m.negocio_id = p_negocio_id and m.rol = 'cliente'
           and m.created_at > now() - interval '1 day') < 3000;
$$;

revoke all on function public.demo_puede_recibir(uuid) from public, anon, authenticated;
grant execute on function public.demo_puede_recibir(uuid) to service_role;

-- Igual que antes, más el tope diario de la demo.
create or replace function public.consumir_limite_ia(
  p_negocio_id uuid,
  p_user_id uuid,
  p_max_negocio int,
  p_max_usuario int
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ventana timestamptz := date_trunc('minute', now());
  v_negocio int;
  v_usuario int;
begin
  if public.demo_sin_cupo_ia(p_negocio_id) then
    return false;
  end if;
  -- Limpieza de ventanas viejas del mismo negocio (usa la PK, es barato).
  delete from public.limites_ia where negocio_id = p_negocio_id and ventana < v_ventana - interval '10 minutes';

  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (p_negocio_id, 'negocio', v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_negocio;

  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (p_negocio_id, p_user_id::text, v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_usuario;

  return v_negocio <= p_max_negocio and v_usuario <= p_max_usuario;
end;
$$;

create or replace function public.consumir_limite_ia_cliente(
  p_negocio_id uuid,
  p_cliente_id uuid,
  p_max_negocio int,
  p_max_cliente int
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ventana timestamptz := date_trunc('minute', now());
  v_negocio int;
  v_cliente int;
begin
  if public.demo_sin_cupo_ia(p_negocio_id) then
    return false;
  end if;
  delete from public.limites_ia where negocio_id = p_negocio_id and ventana < v_ventana - interval '10 minutes';

  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (p_negocio_id, 'negocio', v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_negocio;

  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (p_negocio_id, 'cliente:' || p_cliente_id, v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_cliente;

  return v_negocio <= p_max_negocio and v_cliente <= p_max_cliente;
end;
$$;

-- 8. Demo: limpieza diaria ---------------------------------------------------------------------

-- Deja los locales de demo como recién creados (menú intacto, nada agotado, sin pedidos ni
-- chats) y borra los usuarios anónimos de más de un día (sus membresías se van en cascada).
-- Devuelve cuántos usuarios borró.
create function public.limpiar_demo() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_borrados int;
begin
  delete from public.pedidos p using public.negocios ng where ng.id = p.negocio_id and ng.es_demo;
  delete from public.uso_ia u using public.negocios ng where ng.id = u.negocio_id and ng.es_demo;
  delete from public.conversaciones c using public.negocios ng where ng.id = c.negocio_id and ng.es_demo;
  delete from public.clientes c using public.negocios ng where ng.id = c.negocio_id and ng.es_demo;
  delete from public.limites_ia l using public.negocios ng where ng.id = l.negocio_id and ng.es_demo;
  delete from public.contadores_pedidos cp using public.negocios ng where ng.id = cp.negocio_id and ng.es_demo;
  update public.productos p set activo = true from public.negocios ng
  where ng.id = p.negocio_id and ng.es_demo and not p.activo;

  delete from auth.users u where u.is_anonymous and u.created_at < now() - interval '1 day';
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

revoke all on function public.limpiar_demo() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

-- Todos los días a las 5:00 de Uruguay (8:00 UTC), la hora más tranquila.
select cron.schedule('limpiar-demo', '0 8 * * *', 'select public.limpiar_demo()');

-- 9. Slugs reservados: /demo y /privacidad -----------------------------------------------------

create or replace function public.crear_negocio(p_codigo text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- Rutas fijas de la web que un slug no puede tapar.
  c_reservados constant text[] := '{login,registro,invitacion,bienvenida,operador,privacidad,demo,nuevo-local,admin,api,app,anotado,www}';
  c_max_intentos_slug constant int := 50;
  v_user uuid := auth.uid();
  v_nombre text := btrim(p_nombre);
  v_codigo_id uuid;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_negocio_id uuid;
begin
  if v_user is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '42501';
  end if;
  if v_nombre is null or char_length(v_nombre) not between 1 and 120 then
    raise exception 'El nombre del local va de 1 a 120 caracteres' using errcode = '22023';
  end if;

  -- Se bloquea el código: dos pestañas con el mismo código no crean dos locales.
  select id into v_codigo_id from public.codigos_alta
  where codigo_hash = public.hash_codigo(p_codigo) and usado_at is null and vence_at > now()
  for update;
  if v_codigo_id is null then
    raise exception 'El código no es válido, venció o ya se usó' using errcode = '22023';
  end if;

  v_base := public.slug_desde_nombre(v_nombre);
  if v_base = any (c_reservados) then v_base := v_base || '-local'; end if;
  v_slug := v_base;
  -- El exists evita casi todos los choques; el unique de negocios.slug resuelve el resto
  -- (otra alta con el mismo nombre al mismo tiempo): se reintenta con el número siguiente.
  loop
    if not exists (select 1 from public.negocios where slug = v_slug) then
      begin
        insert into public.negocios (nombre, slug) values (v_nombre, v_slug)
        returning id into v_negocio_id;
        exit;
      exception when unique_violation then
        null;
      end;
    end if;
    v_n := v_n + 1;
    if v_n > c_max_intentos_slug then
      raise exception 'No se pudo generar la dirección del local: probá con otro nombre' using errcode = '23505';
    end if;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.miembros (negocio_id, user_id, rol) values (v_negocio_id, v_user, 'dueno');
  update public.codigos_alta
  set usado_por = v_user, usado_at = now(), negocio_id = v_negocio_id
  where id = v_codigo_id;

  return jsonb_build_object('id', v_negocio_id, 'slug', v_slug);
end;
$$;

-- 10. El local de demo ------------------------------------------------------------------------

-- Datos de referencia (no de prueba): tiene que existir también en la nube. El
-- phone_number_id empieza con 0 (los de Meta nunca), así ningún número real cae acá.
insert into public.negocios (id, nombre, slug, es_demo, wa_phone_number_id, ia_permitida, ia_activa)
values ('d0000000-0000-4000-8000-000000000001', 'El Ceibo (demo)', 'el-ceibo-demo', true, '000000000001', true, true);

insert into public.categorias (id, negocio_id, nombre, orden) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Chivitos', 1),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'Milanesas', 2),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'Hamburguesas', 3),
  ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'Pizzas', 4),
  ('d1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', 'Empanadas', 5),
  ('d1000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001', 'Acompañamientos', 6),
  ('d1000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000001', 'Bebidas', 7);

insert into public.productos (negocio_id, categoria_id, nombre, alias, precio_centavos)
select 'd0000000-0000-4000-8000-000000000001', ('d1000000-0000-4000-8000-00000000000' || cat)::uuid,
       nombre, alias, precio
from (values
  (1, 'Chivito canadiense al pan',    '{chivito,"chivito al pan",chivi}'::text[],           45000),
  (1, 'Chivito canadiense al plato',  '{"chivito al plato","al plato"}',                    69000),
  (2, 'Milanesa al pan completa',     '{"mila al pan","milanesa al pan","mila completa"}',  32000),
  (2, 'Milanesa napolitana al plato', '{napo,napolitana,"mila napo"}',                      55000),
  (3, 'Hamburguesa completa',         '{completa,compl,"la completa","hambur completa"}',   28000),
  (3, 'Hamburguesa simple',           '{simple,"hambur simple",hamburguesa}',               20000),
  (4, 'Pizza muzzarella',             '{muzza,muza,"pizza común",pizza}',                   42000),
  (4, 'Pizza especial',               '{especial,"pizza con jamón"}',                       52000),
  (4, 'Fainá (porción)',              '{faina,fainá}',                                       6000),
  (5, 'Empanada de carne',            '{carne,"emp carne"}',                                 7000),
  (5, 'Empanada de jamón y queso',    '{jyq,"jamón y queso"}',                               7000),
  (6, 'Papas fritas',                 '{papas,fritas,"porción de papas"}',                  20000),
  (7, 'Coca-Cola 600 ml',             '{"coca chica","coca 600"}',                           9000),
  (7, 'Coca-Cola 1,5 L',              '{"coca grande","coca 1.5","coca de litro y medio"}', 15000),
  (7, 'Coca-Cola 2,25 L',             '{"coca 2.25","coca de 2 litros"}',                   19000),
  (7, 'Agua sin gas 600 ml',          '{agua}',                                              7000),
  (7, 'Cerveza Pilsen 1 L',           '{pilsen,birra,cerveza}',                             22000)
) as m (cat, nombre, alias, precio);

insert into public.zonas_envio (negocio_id, nombre, costo_centavos, orden) values
  ('d0000000-0000-4000-8000-000000000001', 'Centro', 6000, 1),
  ('d0000000-0000-4000-8000-000000000001', 'Pocitos', 9000, 2);
