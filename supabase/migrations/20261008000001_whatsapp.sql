-- Fase 5: WhatsApp real (Meta Cloud API).
--
-- 1. El webhook guarda cada mensaje al recibirlo (recibir_mensaje_wa), antes de contestarle
--    a Meta: dedupe por wa_message_id, cliente por teléfono y la conversación abierta del
--    cliente (o una nueva si la anterior lleva 30 min quieta; 3 h si tiene un pedido armado
--    sin confirmar). La IA corre después.
-- 2. mensajes.interpretado: los de WhatsApp entran sin interpretar. guardar_interpretacion_wa
--    marca SOLO los que leyó la IA: uno que llegó mientras tanto queda para la vuelta siguiente.
-- 3. conversaciones.interpretando_hasta: turno para que interprete un solo proceso por
--    conversación. Si el proceso se cae, vence solo. No hace falta para la integridad (eso lo
--    da la versión), sino para no pagar dos veces la misma interpretación.
-- 4. guardar_borrador: lo que edita el cajero se guarda solo, con control de versión. Así la IA
--    trabaja siempre sobre lo último y nada se pierde al recargar.
-- 5. confirmar_conversacion: confirma solo si la pantalla tenía la última versión y todos los
--    mensajes (un "agregame una coca" que llega al confirmar no se pierde).
-- 6. Realtime: aviso {conversacion_id} a dueño y cajero (cocina no ve conversaciones).
-- 7. Operador: conectar el número de WhatsApp de un local.
--
-- Las funciones que reciben el negocio por parámetro (las del webhook) son solo para
-- service_role: la Edge Function ya verificó la firma de Meta.

-- 1. Columnas ---------------------------------------------------------------------------------

alter table public.mensajes
  add column tipo text not null default 'texto'
    check (tipo in ('texto', 'audio', 'imagen', 'video', 'documento', 'ubicacion', 'sticker', 'contacto', 'otro')),
  add column interpretado boolean not null default true,
  -- Orden estable de llegada. created_at NO sirve: es la hora en que EMPIEZA la transacción, y un
  -- mensaje que esperó el bloqueo del cliente puede quedar con una hora anterior a otro que se
  -- guardó antes que él (reproducido con dos sesiones). El número se toma al insertar, y los
  -- mensajes de una conversación se insertan de a uno (bloqueo del cliente en el webhook, de la
  -- conversación en guardar_interpretacion): sigue el orden real, sin empates.
  add column orden bigint generated always as identity;

create index mensajes_conversacion_orden on public.mensajes (conversacion_id, orden);
create index mensajes_sin_interpretar on public.mensajes (conversacion_id, orden) where not interpretado;

alter table public.conversaciones add column interpretando_hasta timestamptz;

-- phone_number_id de Meta: solo dígitos. Lo carga el operador (no está en el GRANT de update).
alter table public.negocios
  add constraint negocios_wa_phone_number_id_valido check (wa_phone_number_id ~ '^[0-9]{5,30}$');

alter table public.clientes
  add constraint clientes_nombre_largo check (char_length(nombre) <= 80),
  add constraint clientes_telefono_largo check (char_length(telefono) <= 30);

-- Un cliente con varias conversaciones (una por pedido): buscar la abierta usa una_abierta.

-- 2. Validación de borradores (compartida por las funciones nuevas) -----------------------------

-- Lanza 22023 si el borrador no tiene la forma esperada, o 23514 si tiene productos que no son
-- de este negocio (o no están activos, si p_solo_activos). Espeja BorradorSchema de shared.
create function public.exigir_borrador_valido(p_negocio_id uuid, p_borrador jsonb, p_solo_activos boolean)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_entrega jsonb;
begin
  if jsonb_typeof(p_borrador) is distinct from 'object' then
    raise exception 'El borrador tiene que ser un objeto' using errcode = '22023';
  end if;
  if length(p_borrador::text) > 20000 then
    raise exception 'Borrador demasiado grande' using errcode = '22023';
  end if;
  if jsonb_typeof(p_borrador -> 'items') is distinct from 'array' or jsonb_array_length(p_borrador -> 'items') > 30 then
    raise exception 'borrador.items tiene que ser una lista de hasta 30' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_borrador -> 'items') loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'producto_id') is distinct from 'string'
       or (v_item ->> 'producto_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'cantidad') is distinct from 'number' then
      raise exception 'Item del borrador inválido' using errcode = '22023';
    end if;
    if (v_item ->> 'cantidad')::numeric <> trunc((v_item ->> 'cantidad')::numeric)
       or (v_item ->> 'cantidad')::numeric not between 1 and 20
       or (v_item ? 'notas' and (jsonb_typeof(v_item -> 'notas') <> 'string' or char_length(v_item ->> 'notas') > 200)) then
      raise exception 'Item del borrador inválido' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.productos p
      where p.id = (v_item ->> 'producto_id')::uuid and p.negocio_id = p_negocio_id and (p.activo or not p_solo_activos)
    ) then
      raise exception 'El borrador tiene productos que no son de este negocio o están agotados' using errcode = '23514';
    end if;
  end loop;

  v_entrega := p_borrador -> 'entrega';
  if v_entrega is not null and v_entrega <> 'null'::jsonb then
    if jsonb_typeof(v_entrega) <> 'object'
       or coalesce(v_entrega ->> 'modo', '') not in ('retiro', 'delivery', 'mesa')
       or char_length(coalesce(v_entrega ->> 'direccion', '')) > 200
       or char_length(coalesce(v_entrega ->> 'mesa', '')) > 20 then
      raise exception 'Entrega del borrador inválida' using errcode = '22023';
    end if;
  end if;
end;
$$;

-- Pendientes: { dudosos, preguntas, errores }, listas de hasta 30 textos de hasta 300.
create function public.exigir_pendientes_validos(p_pendientes jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_clave text;
begin
  if jsonb_typeof(p_pendientes) is distinct from 'object' then
    raise exception 'Los pendientes tienen que ser un objeto' using errcode = '22023';
  end if;
  foreach v_clave in array array['dudosos', 'preguntas', 'errores'] loop
    if p_pendientes ? v_clave and (
      jsonb_typeof(p_pendientes -> v_clave) <> 'array'
      or jsonb_array_length(p_pendientes -> v_clave) > 30
      or exists (
        select 1 from jsonb_array_elements(p_pendientes -> v_clave) t
        where jsonb_typeof(t.value) <> 'string' or char_length(t.value #>> '{}') > 300
      )
    ) then
      raise exception 'Pendientes inválidos' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.exigir_borrador_valido(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.exigir_pendientes_validos(jsonb) from public, anon, authenticated;

-- 3. Webhook (solo service_role) ---------------------------------------------------------------

-- Guarda un mensaje de WhatsApp. Devuelve null si no hay que hacer nada (número sin local o
-- local suspendido, o un reintento de Meta ya guardado), y {limitado: true} si el cliente pasó
-- su límite de recepción. Si el número del local pasó el suyo, error AN429 (reintentar). Si no, el negocio, la conversación y si hay que interpretarla (solo
-- texto, y solo con la IA permitida y prendida).
create function public.recibir_mensaje_wa(
  p_phone_number_id text,
  p_wa_message_id text,
  p_telefono text,
  p_nombre text,
  p_tipo text,
  p_contenido text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_inactividad constant interval := interval '30 minutes';
  c_inactividad_con_pedido constant interval := interval '3 hours';
  v_con_items boolean;
  v_limite timestamptz;
  v_negocio_id uuid;
  v_ia boolean;
  v_cliente_id uuid;
  v_conv_id uuid;
  v_ultimo timestamptz;
  c_max_por_cliente constant int := 20;   -- mensajes por minuto
  c_max_por_negocio constant int := 300;  -- mensajes por minuto, entre todos los clientes
  v_ventana timestamptz;
  v_cuenta_negocio int;
  v_cuenta_cliente int;
begin
  if p_wa_message_id is null or char_length(p_wa_message_id) not between 1 and 200 then
    raise exception 'wa_message_id inválido' using errcode = '22023';
  end if;
  if p_telefono is null or p_telefono !~ '^[0-9]{6,20}$' then
    raise exception 'Teléfono inválido' using errcode = '22023';
  end if;
  if p_contenido is null or char_length(p_contenido) not between 1 and 2000 then
    raise exception 'Contenido inválido' using errcode = '22023';
  end if;

  select ng.id, ng.ia_permitida and ng.ia_activa into v_negocio_id, v_ia
  from public.negocios ng
  where ng.wa_phone_number_id = p_phone_number_id and ng.activo;
  if not found then
    return null;
  end if;

  -- Reintento de Meta: ya está guardado. El bloqueo por wa_message_id (hasta el fin de la
  -- transacción) hace que dos entregas simultáneas del MISMO mensaje pasen de a una: la segunda
  -- espera, lo encuentra guardado y sale acá, sin sumar al límite del local (revisión).
  perform pg_advisory_xact_lock(hashtextextended('wa:' || p_wa_message_id, 0));
  if exists (select 1 from public.mensajes m where m.wa_message_id = p_wa_message_id) then
    return null;
  end if;

  -- Límite de recepción del local (revisión): cada mensaje es una fila y cualquiera puede
  -- escribirle al local. Va ANTES de crear el cliente, para que miles de teléfonos distintos no
  -- inflen `clientes`. Pasado el tope NO se descarta: error AN429, el webhook responde 503 y Meta
  -- reintenta más tarde (lo ya guardado no se duplica). Como el error deshace la transacción, los
  -- rechazados no suman al contador.
  v_ventana := date_trunc('minute', now());
  delete from public.limites_ia l
  where l.negocio_id = v_negocio_id and l.ventana < v_ventana - interval '10 minutes';
  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (v_negocio_id, 'recibir:negocio', v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_cuenta_negocio;
  if v_cuenta_negocio > c_max_por_negocio then
    raise exception 'Demasiados mensajes para este número; reintentar más tarde' using errcode = 'AN429';
  end if;

  -- El upsert bloquea la fila del cliente: los mensajes de un mismo cliente se guardan de a
  -- uno, así que dos simultáneos no abren dos conversaciones. El nombre del perfil de WhatsApp
  -- no pisa uno que ya haya cargado el local.
  insert into public.clientes as c (negocio_id, telefono, nombre)
  values (v_negocio_id, p_telefono, nullif(left(btrim(p_nombre), 80), ''))
  on conflict (negocio_id, telefono) do update set nombre = coalesce(c.nombre, excluded.nombre)
  returning c.id into v_cliente_id;

  -- Reintento simultáneo: con el cliente bloqueado, se vuelve a mirar.
  if exists (select 1 from public.mensajes m where m.wa_message_id = p_wa_message_id) then
    return null;
  end if;

  -- Límite por cliente (los reintentos de Meta no cuentan: salen arriba por el dedupe). Pasado
  -- el límite, el mensaje no se guarda y Meta recibe 200: afecta solo a quien manda de más.
  insert into public.limites_ia as l (negocio_id, clave, ventana, cuenta)
  values (v_negocio_id, 'recibir:' || v_cliente_id, v_ventana, 1)
  on conflict (negocio_id, clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_cuenta_cliente;
  if v_cuenta_cliente > c_max_por_cliente then
    return jsonb_build_object('limitado', true);
  end if;

  select cv.id, cv.ultimo_mensaje_at, jsonb_array_length(coalesce(cv.borrador -> 'items', '[]')) > 0
    into v_conv_id, v_ultimo, v_con_items
  from public.conversaciones cv
  where cv.negocio_id = v_negocio_id and cv.cliente_id = v_cliente_id and cv.estado = 'abierta'
  for update;
  -- 30 min sin mensajes: esa charla quedó atrás, se cierra y empieza otra. Si tiene un pedido
  -- armado sin confirmar, aguanta hasta 3 h: cerrarla lo haría desaparecer del mostrador.
  if v_con_items then
    v_limite := now() - c_inactividad_con_pedido;
  else
    v_limite := now() - c_inactividad;
  end if;
  if v_conv_id is not null and v_ultimo < v_limite then
    update public.conversaciones
    set estado = 'cerrada', pendientes = '{"dudosos":[],"preguntas":[],"errores":[]}'
    where id = v_conv_id;
    v_conv_id := null;
  end if;
  if v_conv_id is null then
    insert into public.conversaciones (negocio_id, cliente_id)
    values (v_negocio_id, v_cliente_id)
    returning id into v_conv_id;
  end if;

  -- Lo que no es texto no lo interpreta la IA: queda marcado para que lo vea el cajero.
  insert into public.mensajes (negocio_id, conversacion_id, rol, contenido, tipo, wa_message_id, interpretado)
  values (v_negocio_id, v_conv_id, 'cliente', p_contenido, p_tipo, p_wa_message_id, p_tipo <> 'texto');

  update public.conversaciones set ultimo_mensaje_at = now() where id = v_conv_id;

  return jsonb_build_object(
    'negocio_id', v_negocio_id,
    'conversacion_id', v_conv_id,
    'interpretar', p_tipo = 'texto' and v_ia);
end;
$$;

-- Turno para interpretar una conversación. false = otro proceso la está interpretando (o ya
-- no está abierta).
create function public.tomar_conversacion_wa(p_negocio_id uuid, p_conversacion_id uuid, p_segundos int)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_segundos is null or p_segundos not between 5 and 300 then
    raise exception 'Duración del turno inválida' using errcode = '22023';
  end if;
  update public.conversaciones
  set interpretando_hasta = now() + make_interval(secs => p_segundos)
  where id = p_conversacion_id and negocio_id = p_negocio_id and estado = 'abierta'
    and (interpretando_hasta is null or interpretando_hasta < now());
  return found;
end;
$$;

-- Suelta el turno. Devuelve si quedaron mensajes de texto sin interpretar: uno que llegó justo
-- antes de soltar no encontró el turno libre, así que quien suelta lo vuelve a tomar.
create function public.soltar_conversacion_wa(p_negocio_id uuid, p_conversacion_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversaciones
  set interpretando_hasta = null
  where id = p_conversacion_id and negocio_id = p_negocio_id;
  return exists (
    select 1 from public.mensajes m join public.conversaciones cv on cv.id = m.conversacion_id
    where m.conversacion_id = p_conversacion_id and m.negocio_id = p_negocio_id
      and not m.interpretado and cv.estado = 'abierta'
  );
end;
$$;

-- Límite de IA para mensajes de WhatsApp: por negocio (compartido con parse-order) y por
-- cliente, para que alguien que manda spam no gaste la cuota del local.
create function public.consumir_limite_ia_cliente(
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

-- Guarda lo que interpretó la IA de los mensajes p_mensajes (los que leyó, ni uno más).
-- Misma regla de versión que guardar_interpretacion: si el cajero editó en el medio, 40001 y
-- el proceso vuelve a interpretar sobre lo nuevo. Devuelve la versión nueva.
create function public.guardar_interpretacion_wa(
  p_negocio_id uuid,
  p_conversacion_id uuid,
  p_version int,
  p_mensajes uuid[],
  p_borrador jsonb,
  p_pendientes jsonb,
  p_modelo text,
  p_tokens_entrada int,
  p_tokens_salida int
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_estado text;
  v_version int;
begin
  perform public.exigir_borrador_valido(p_negocio_id, p_borrador, true);
  perform public.exigir_pendientes_validos(p_pendientes);
  if coalesce(cardinality(p_mensajes), 0) = 0 then
    raise exception 'Faltan los mensajes interpretados' using errcode = '22023';
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

  return v_version;
end;
$$;

revoke all on function public.recibir_mensaje_wa(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.tomar_conversacion_wa(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.soltar_conversacion_wa(uuid, uuid) from public, anon, authenticated;
revoke all on function public.consumir_limite_ia_cliente(uuid, uuid, int, int) from public, anon, authenticated;
revoke all on function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int)
  from public, anon, authenticated;
grant execute on function public.recibir_mensaje_wa(text, text, text, text, text, text) to service_role;
grant execute on function public.tomar_conversacion_wa(uuid, uuid, int) to service_role;
grant execute on function public.soltar_conversacion_wa(uuid, uuid) to service_role;
grant execute on function public.consumir_limite_ia_cliente(uuid, uuid, int, int) to service_role;
grant execute on function public.guardar_interpretacion_wa(uuid, uuid, int, uuid[], jsonb, jsonb, text, int, int)
  to service_role;

-- 4. Mostrador: autoguardado y confirmar con la última versión -------------------------------

-- Guarda lo que editó el cajero. Si la conversación cambió (la IA interpretó un mensaje o se
-- editó en otra pantalla), 40001: la pantalla recarga. Devuelve la versión nueva.
create function public.guardar_borrador(
  p_conversacion_id uuid,
  p_version int,
  p_borrador jsonb,
  p_pendientes jsonb
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
  v_estado text;
  v_version int;
begin
  select cv.negocio_id into v_negocio_id from public.conversaciones cv where cv.id = p_conversacion_id;
  -- Mismo error si no existe o si es de otro negocio: no se revela qué ids existen.
  if v_negocio_id is null or not public.tiene_rol(v_negocio_id, '{dueno,cajero}') then
    raise exception 'Sin permiso sobre esta conversación' using errcode = '42501';
  end if;
  -- Productos del negocio, aunque se hayan agotado: confirmar_pedido vuelve a exigir activos.
  perform public.exigir_borrador_valido(v_negocio_id, p_borrador, false);
  perform public.exigir_pendientes_validos(p_pendientes);

  select cv.estado, cv.version into v_estado, v_version
  from public.conversaciones cv where cv.id = p_conversacion_id
  for update;
  if v_estado <> 'abierta' then
    raise exception 'La conversación ya está cerrada' using errcode = '22023';
  end if;
  if v_version is distinct from p_version then
    raise exception 'Esta tarjeta cambió. Se recargó con lo último.' using errcode = '40001';
  end if;

  update public.conversaciones cv
  set borrador = p_borrador, pendientes = p_pendientes, version = cv.version + 1
  where cv.id = p_conversacion_id
  returning cv.version into v_version;
  return v_version;
end;
$$;

-- Confirmar una tarjeta de WhatsApp. Además de lo que valida confirmar_pedido, exige que la
-- pantalla tenga la última versión del borrador y el último mensaje del cliente
-- (p_ultimo_mensaje, null si no vio ninguno): si llegó algo mientras el cajero confirmaba,
-- 40001 y lo revisa antes.
create function public.confirmar_conversacion(
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
         and (v_visto is null or m.orden > v_visto)
     ) then
    raise exception 'Llegó un mensaje nuevo o la tarjeta cambió. Revisala y confirmá de nuevo.' using errcode = '40001';
  end if;
  -- Misma transacción y mismo usuario: confirmar_pedido valida rol, productos, entrega y zona,
  -- recalcula el total y cierra la conversación.
  return public.confirmar_pedido(p_negocio_id, 'whatsapp', p_items, p_entrega, p_notas, p_conversacion_id);
end;
$$;

revoke all on function public.guardar_borrador(uuid, int, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.confirmar_conversacion(uuid, uuid, int, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.guardar_borrador(uuid, int, jsonb, jsonb) to authenticated;
grant execute on function public.confirmar_conversacion(uuid, uuid, int, uuid, jsonb, jsonb, text) to authenticated;

-- 5. Tiempo real ------------------------------------------------------------------------------

-- Canal privado negocio:<uuid>:conversaciones. Null si el topic no tiene esa forma.
create function public.negocio_de_topic_conversaciones(p_topic text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_topic ~ '^negocio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:conversaciones$'
      then substring(p_topic from 9 for 36)::uuid
  end;
$$;

revoke all on function public.negocio_de_topic_conversaciones(text) from public, anon, authenticated;
grant execute on function public.negocio_de_topic_conversaciones(text) to authenticated;

-- Solo dueño y cajero: cocina no ve conversaciones. (La policy de pedidos da null para este
-- topic, así que no lo abre.)
create policy "dueño y cajero escuchan las conversaciones de su negocio" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.tiene_rol(public.negocio_de_topic_conversaciones(realtime.topic()), '{dueno,cajero}')
  );

-- El aviso solo dice qué conversación cambió; la pantalla relee por RLS.
create function public.avisar_conversacion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  -- Ramas separadas: plpgsql prepara cada sentencia al ejecutarla, y conversaciones no tiene
  -- conversacion_id.
  if tg_table_name = 'mensajes' then
    v_id := new.conversacion_id;
  else
    v_id := new.id;
  end if;
  perform realtime.send(
    jsonb_build_object('conversacion_id', v_id),
    'conversacion',
    'negocio:' || new.negocio_id || ':conversaciones',
    true
  );
  return null;
end;
$$;

revoke all on function public.avisar_conversacion() from public, anon, authenticated;

create trigger mensajes_avisar
  after insert on public.mensajes
  for each row execute function public.avisar_conversacion();

create trigger conversaciones_avisar_alta
  after insert on public.conversaciones
  for each row execute function public.avisar_conversacion();

-- Tomar o soltar el turno de la IA no avisa: solo cambia lo que se ve.
create trigger conversaciones_avisar_cambio
  after update on public.conversaciones
  for each row when (old.version is distinct from new.version or old.estado is distinct from new.estado)
  execute function public.avisar_conversacion();

-- 6. Operador: conectar el número de WhatsApp ------------------------------------------------

-- operador_locales suma el número conectado (cambia el tipo de retorno: se reemplaza).
drop function public.operador_locales();

create function public.operador_locales()
returns table (
  id uuid, nombre text, slug text, activo boolean, ia_permitida boolean, ia_activa boolean,
  created_at timestamptz, duenos text[], miembros int, pedidos_30d int, usos_ia_30d int,
  wa_phone_number_id text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_operador();
  return query
    select ng.id, ng.nombre, ng.slug, ng.activo, ng.ia_permitida, ng.ia_activa, ng.created_at,
      coalesce((select array_agg(u.email::text order by u.email)
                from public.miembros m join auth.users u on u.id = m.user_id
                where m.negocio_id = ng.id and m.rol = 'dueno'), '{}'),
      (select count(*)::int from public.miembros m where m.negocio_id = ng.id),
      (select count(*)::int from public.pedidos p
       where p.negocio_id = ng.id and p.created_at > now() - interval '30 days'),
      (select count(*)::int from public.uso_ia ui
       where ui.negocio_id = ng.id and ui.created_at > now() - interval '30 days'),
      ng.wa_phone_number_id
    from public.negocios ng
    order by ng.created_at desc, ng.nombre;
end;
$$;

revoke all on function public.operador_locales() from public, anon, authenticated;
grant execute on function public.operador_locales() to authenticated;

-- Conecta (o con null, desconecta) el número de WhatsApp de un local. El phone_number_id lo
-- da Meta en el panel de la app; no es secreto.
create function public.operador_conectar_whatsapp(p_negocio_id uuid, p_phone_number_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id text := nullif(btrim(p_phone_number_id), '');
begin
  perform public.exigir_operador();
  if v_id !~ '^[0-9]{5,30}$' then
    raise exception 'El identificador del número son solo dígitos (lo da Meta en la app)' using errcode = '22023';
  end if;
  begin
    update public.negocios set wa_phone_number_id = v_id where id = p_negocio_id;
  exception when unique_violation then
    raise exception 'Ese número ya está conectado a otro local' using errcode = '23505';
  end;
  if not found then
    raise exception 'Local no encontrado' using errcode = 'P0002';
  end if;
  perform public.anotar_operador(case when v_id is null then 'whatsapp_desconectado' else 'whatsapp_conectado' end,
    p_negocio_id, jsonb_strip_nulls(jsonb_build_object('phone_number_id', v_id)));
end;
$$;

revoke all on function public.operador_conectar_whatsapp(uuid, text) from public, anon, authenticated;
grant execute on function public.operador_conectar_whatsapp(uuid, text) to authenticated;
