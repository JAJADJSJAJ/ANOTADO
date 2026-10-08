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
-- 3. Demo pública (/demo): un local compartido (negocios.es_demo). Cada visitante es una cuenta
--    de demo que crea la Edge Function demo-entrar (con límite por IP) y se suma como dueña
--    (sumar_visitante_demo), con la demo CERRADA por triggers: pedidos, cocina, agotados y hasta 3
--    productos propios; el menú base, ajustes, IA, zonas, categorías y equipo no se tocan.
-- 4. Las cuentas de demo solo pueden ser miembros de locales de demo, no cambian su mail y Auth no
--    les manda mails (ni de cambio de email ni de reautenticación).
-- 5. Cupos diarios atómicos (demo_cupos): IA, mensajes del simulador, cuentas, pedidos y clientes.
-- 6. Limpieza de la demo (pg_cron): todo cada noche, los agotados cada hora.
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

-- 6. Demo: cupos diarios ----------------------------------------------------------------------

-- Contadores por día (hora de Uruguay), atómicos: el upsert bloquea la fila, así que dos pedidos
-- simultáneos no pasan el tope (revisión: antes se contaba y se registraba por separado).
create table public.demo_cupos (
  clave text not null check (char_length(clave) <= 120),
  dia date not null,
  cuenta int not null,
  primary key (clave, dia)
);
alter table public.demo_cupos enable row level security;  -- sin policies: solo el servidor

-- Suma uno al cupo de hoy y dice si todavía está dentro del máximo. Si la transacción que la llama
-- falla, la suma se deshace: lo rechazado no cuenta.
create function public.consumir_cupo_demo(p_clave text, p_max int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_cuenta int;
begin
  insert into public.demo_cupos as c (clave, dia, cuenta)
  values (p_clave, (now() at time zone 'America/Montevideo')::date, 1)
  on conflict (clave, dia) do update set cuenta = c.cuenta + 1
  returning cuenta into v_cuenta;
  return v_cuenta <= p_max;
end;
$$;

revoke all on function public.consumir_cupo_demo(text, int) from public, anon, authenticated;

-- 7. Demo: entrar ------------------------------------------------------------------------------

-- Cada visitante es una cuenta de demo que crea la Edge Function demo-entrar con la API de
-- administración (el registro público está apagado, y con él el login anónimo de Supabase):
-- mail inventado en .invalid y app_metadata.demo = true, que solo puede poner el servidor.
create function public.es_cuenta_demo(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_anonymous or coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true'
                   from auth.users u where u.id = p_user_id), false);
$$;

revoke all on function public.es_cuenta_demo(uuid) from public, anon, authenticated;

-- Límite para crear cuentas de demo: por minuto, 3 por IP (hasheada) y 30 en total; por día, 10 por
-- IP y 300 en total; y hasta 500 cuentas de demo vivas (la limpieza borra las de más de un día).
-- Los de por minuto usan claves propias en limites_registro: no comparten el cupo de registro.
create function public.consumir_limite_demo(p_ip_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ventana timestamptz := date_trunc('minute', now());
  v_ip int;
  v_total int;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash de IP inválido' using errcode = '22023';
  end if;
  if (select count(*) from auth.users u where coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true') >= 500 then
    return false;
  end if;
  delete from public.limites_registro where ventana < v_ventana - interval '10 minutes';

  insert into public.limites_registro as l (clave, ventana, cuenta) values ('demo:total', v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_total;

  insert into public.limites_registro as l (clave, ventana, cuenta) values ('demo:' || p_ip_hash, v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_ip;

  return v_ip <= 3 and v_total <= 30
    and public.consumir_cupo_demo('cuentas:' || p_ip_hash, 10)
    and public.consumir_cupo_demo('cuentas', 300);
end;
$$;

-- Suma la cuenta de demo recién creada como DUEÑA del local de demo (así prueba también el menú;
-- lo que no puede tocar lo frenan los triggers de abajo). Y le cierra el envío de mails: Auth no
-- manda un mail de cambio de email ni de reautenticación si el anterior es de hace menos de un
-- rato, y acá "el anterior" queda en el año 2999 (probado: responde 429 sin mandar nada). Así
-- nadie puede usar la demo para que el SMTP del proyecto le escriba a un tercero.
create function public.sumar_visitante_demo(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
  v_slug text;
begin
  if not public.es_cuenta_demo(p_user_id) then
    raise exception 'No es una cuenta de demo' using errcode = '42501';
  end if;
  select ng.id, ng.slug into v_negocio_id, v_slug
  from public.negocios ng
  where ng.es_demo and ng.activo
  order by ng.created_at
  limit 1;
  if v_negocio_id is null then
    raise exception 'La demo no está disponible' using errcode = 'P0002';
  end if;
  update auth.users
  set email_change_sent_at = '2999-01-01', reauthentication_sent_at = '2999-01-01', phone_change_sent_at = '2999-01-01'
  where id = p_user_id;
  insert into public.miembros (negocio_id, user_id, rol) values (v_negocio_id, p_user_id, 'dueno')
  on conflict (negocio_id, user_id) do nothing;
  return jsonb_build_object('slug', v_slug, 'negocio_id', v_negocio_id);
end;
$$;

-- Cupo de mensajes del simulador: 60 por visitante y 2000 en total por día (cada uno es una fila).
-- false si no es un local de demo.
create function public.consumir_mensaje_demo(p_negocio_id uuid, p_user_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  return public.es_demo(p_negocio_id)
    and public.consumir_cupo_demo('mensajes:' || p_user_id, 60)
    and public.consumir_cupo_demo('mensajes:' || p_negocio_id, 2000);
end;
$$;

revoke all on function public.consumir_limite_demo(text) from public, anon, authenticated;
revoke all on function public.sumar_visitante_demo(uuid) from public, anon, authenticated;
revoke all on function public.consumir_mensaje_demo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consumir_limite_demo(text) to service_role;
grant execute on function public.sumar_visitante_demo(uuid) to service_role;
grant execute on function public.consumir_mensaje_demo(uuid, uuid) to service_role;

-- Una cuenta de demo solo puede ser miembro de un local de demo: si no, alguien que probó la
-- demo y después acepta una invitación (o crea su local) en el mismo navegador quedaría con
-- una cuenta que la limpieza borra al otro día.
create function public.exigir_miembro_no_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.es_cuenta_demo(new.user_id) and not public.es_demo(new.negocio_id) then
    raise exception 'Con la cuenta de la demo no podés sumarte a un local. Salí y entrá con tu mail.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_miembro_no_demo() from public, anon, authenticated;

create trigger miembros_no_demo
  before insert or update of negocio_id, user_id on public.miembros
  for each row execute function public.exigir_miembro_no_demo();

-- Una cuenta de demo no cambia su mail ni su teléfono: no se convierte en una cuenta real que
-- sobreviva a la limpieza. (Los mails de confirmación ni salen: ver sumar_visitante_demo.)
create function public.exigir_cuenta_demo_fija() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email
     or coalesce(new.email_change, '') <> coalesce(old.email_change, '') and coalesce(new.email_change, '') <> ''
     or new.phone is distinct from old.phone
     or coalesce(new.phone_change, '') <> coalesce(old.phone_change, '') and coalesce(new.phone_change, '') <> '' then
    raise exception 'La cuenta de la demo no se puede cambiar' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_cuenta_demo_fija() from public, anon, authenticated;

-- La condición va en línea, igual que es_cuenta_demo: el WHEN lo evalúa el rol de Auth, que no
-- puede ejecutar funciones de public (fallarían TODAS las actualizaciones de usuarios).
create trigger usuarios_demo_fijos
  before update on auth.users
  for each row when (old.is_anonymous or coalesce(old.raw_app_meta_data ->> 'demo', '') = 'true')
  execute function public.exigir_cuenta_demo_fija();

-- 8. Demo cerrada: qué puede tocar un visitante ------------------------------------------------
--
-- Los visitantes son dueños del local de demo, pero desde la web (auth.uid() no nulo) solo
-- pueden: tomar y confirmar pedidos, mover la cocina, marcar agotados (vuelven cada hora) y agregar
-- hasta 3 productos suyos (40 entre todos), que pueden editar o borrar. El menú base no se toca. Ni
-- ajustes, IA, horarios, zonas, categorías, equipo ni invitaciones (las invitaciones llevan al
-- registro, que manda mails). El servidor (service_role, la limpieza, el SQL Editor) no tiene auth.uid()
-- y no pasa por acá.

create function public.exigir_demo_sin_cambios() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fila jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_negocio_id uuid := (v_fila ->> (case when tg_table_name = 'negocios' then 'id' else 'negocio_id' end))::uuid;
begin
  if auth.uid() is not null and public.es_demo(v_negocio_id) then
    raise exception 'En la demo esto no se puede cambiar.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.exigir_demo_sin_cambios() from public, anon, authenticated;

create trigger negocios_demo_fija before update or delete on public.negocios
  for each row execute function public.exigir_demo_sin_cambios();
create trigger categorias_demo_fijas before insert or update or delete on public.categorias
  for each row execute function public.exigir_demo_sin_cambios();
create trigger zonas_demo_fijas before insert or update or delete on public.zonas_envio
  for each row execute function public.exigir_demo_sin_cambios();
create trigger invitaciones_demo_no before insert or update or delete on public.invitaciones
  for each row execute function public.exigir_demo_sin_cambios();
create trigger miembros_demo_fijos before insert or update or delete on public.miembros
  for each row execute function public.exigir_demo_sin_cambios();

-- Productos que agregaron los visitantes (los demás son el menú base, que no se toca).
create table public.demo_productos_agregados (
  producto_id uuid primary key references public.productos on delete cascade,
  negocio_id uuid not null references public.negocios on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.demo_productos_agregados enable row level security;  -- sin policies

create function public.exigir_producto_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_negocio_id uuid := case when tg_op = 'DELETE' then old.negocio_id else new.negocio_id end;
  v_duenio uuid;
begin
  if v_uid is null or not public.es_demo(v_negocio_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    -- De a uno por local: dos altas simultáneas no pasan el tope.
    perform pg_advisory_xact_lock(hashtextextended('demo-productos:' || v_negocio_id, 0));
    if (select count(*) from public.demo_productos_agregados a where a.user_id = v_uid) >= 3 then
      raise exception 'En la demo podés agregar hasta 3 productos.' using errcode = '42501';
    end if;
    if (select count(*) from public.demo_productos_agregados a where a.negocio_id = v_negocio_id) >= 40 then
      raise exception 'La demo ya tiene muchos productos agregados. Probá mañana.' using errcode = '42501';
    end if;
    return new;
  end if;

  select a.user_id into v_duenio from public.demo_productos_agregados a where a.producto_id = old.id;
  if v_duenio is distinct from v_uid then
    -- Menú base o producto de otro visitante: solo agotado / disponible.
    if tg_op = 'DELETE' or new.negocio_id is distinct from old.negocio_id
       or to_jsonb(new) - 'activo' is distinct from to_jsonb(old) - 'activo' then
      raise exception 'Los productos de la demo no se editan: agregá uno tuyo para probar.' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and new.negocio_id is distinct from old.negocio_id then
    raise exception 'En la demo esto no se puede cambiar.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.anotar_producto_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and public.es_demo(new.negocio_id) then
    insert into public.demo_productos_agregados (producto_id, negocio_id, user_id) values (new.id, new.negocio_id, auth.uid());
  end if;
  return null;
end;
$$;

revoke all on function public.exigir_producto_demo() from public, anon, authenticated;
revoke all on function public.anotar_producto_demo() from public, anon, authenticated;

create trigger productos_demo before insert or update or delete on public.productos
  for each row execute function public.exigir_producto_demo();
create trigger productos_demo_anotar after insert on public.productos
  for each row execute function public.anotar_producto_demo();

-- Pedidos y clientes cargados a mano: 20 pedidos por visitante y 500 en total por día; 10 clientes
-- por visitante. (Los clientes del simulador los crea el servidor, sin auth.uid().)
create function public.exigir_cupo_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.es_demo(new.negocio_id) then
    return new;
  end if;
  if tg_table_name = 'pedidos' then
    if not public.consumir_cupo_demo('pedidos:' || v_uid, 20)
       or not public.consumir_cupo_demo('pedidos:' || new.negocio_id, 500) then
      raise exception 'La demo llegó al límite de pedidos de hoy. Volvé mañana.' using errcode = '42501';
    end if;
  elsif not public.consumir_cupo_demo('clientes:' || v_uid, 10) then
    raise exception 'En la demo podés cargar hasta 10 clientes por día.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_cupo_demo() from public, anon, authenticated;

create trigger pedidos_cupo_demo before insert on public.pedidos
  for each row execute function public.exigir_cupo_demo();
create trigger clientes_cupo_demo before insert on public.clientes
  for each row execute function public.exigir_cupo_demo();

-- 9. Demo: topes de IA -------------------------------------------------------------------------

-- En la demo, además de los límites por minuto: como mucho 20 por minuto en el local, y por día 25
-- por visitante (o cliente del simulador) y 200 en total. Se llama SOLO si ya pasó el límite por
-- minuto (revisión: si no, los intentos rechazados gastaban el cupo de todos), y primero el del
-- visitante: uno que ya llegó a su tope no gasta el del resto.
create function public.consumir_ia_demo(p_negocio_id uuid, p_quien text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.consumir_cupo_demo('ia:' || p_quien, 25) then
    return false;
  end if;
  return public.consumir_cupo_demo('ia:' || p_negocio_id, 200);
end;
$$;

revoke all on function public.consumir_ia_demo(uuid, text) from public, anon, authenticated;

-- Igual que antes, más los topes de la demo.
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
  if public.es_demo(p_negocio_id) then
    p_max_negocio := least(p_max_negocio, 20);
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

  if v_negocio > p_max_negocio or v_usuario > p_max_usuario then
    return false;
  end if;
  -- Demo: el cupo diario, solo si pasó el de por minuto.
  if public.es_demo(p_negocio_id) then
    return public.consumir_ia_demo(p_negocio_id, p_user_id::text);
  end if;
  return true;
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
  if public.es_demo(p_negocio_id) then
    p_max_negocio := least(p_max_negocio, 20);
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

  if v_negocio > p_max_negocio or v_cliente > p_max_cliente then
    return false;
  end if;
  -- Demo: el cupo diario, solo si pasó el de por minuto.
  if public.es_demo(p_negocio_id) then
    return public.consumir_ia_demo(p_negocio_id, 'cliente:' || p_cliente_id);
  end if;
  return true;
end;
$$;

-- 10. Demo: limpieza ---------------------------------------------------------------------------

-- Lo agotado en la demo vuelve a ofrecerse cada hora: si un visitante marca todo agotado, el
-- siguiente no tiene que esperar a la noche para probarla.
create function public.reponer_agotados_demo() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.productos p set activo = true from public.negocios ng
  where ng.id = p.negocio_id and ng.es_demo and not p.activo;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.reponer_agotados_demo() from public, anon, authenticated;

-- Deja los locales de demo como recién creados (solo el menú base, nada agotado, sin pedidos ni
-- chats) y borra las cuentas de demo de más de un día (sus membresías se van en cascada).
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
  -- Lo que agregaron los visitantes (después de los pedidos, que lo referencian).
  delete from public.productos p using public.demo_productos_agregados a where a.producto_id = p.id;
  perform public.reponer_agotados_demo();
  delete from public.demo_cupos where dia < (now() at time zone 'America/Montevideo')::date - 1;

  -- Solo las marcadas por demo-entrar (revisión: no cualquier anónima).
  delete from auth.users u
  where coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true'
    and u.created_at < now() - interval '1 day';
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

revoke all on function public.limpiar_demo() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

-- Todos los días a las 5:00 de Uruguay (8:00 UTC), la hora más tranquila.
select cron.schedule('limpiar-demo', '0 8 * * *', 'select public.limpiar_demo()');
select cron.schedule('reponer-agotados-demo', '30 * * * *', 'select public.reponer_agotados_demo()');

-- 11. Slugs reservados: /demo y /privacidad -----------------------------------------------------

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

-- 12. El local de demo ------------------------------------------------------------------------

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
