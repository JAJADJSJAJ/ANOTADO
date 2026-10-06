-- Revisión de seguridad de la Fase 4.
--
-- 1. Autorización vencida: preparar_cambio_equipo y crear_invitacion comprobaban el rol de
--    dueño ANTES de bloquear el negocio. Si otra transacción le sacaba el rol mientras
--    esperaba el bloqueo, seguía con un permiso que ya no tenía (y podía volver a nombrarse
--    dueño). Ahora bloquean primero y comprueban después: en read committed, cada sentencia
--    posterior al bloqueo ve lo que la otra transacción ya confirmó. Se mantiene un chequeo
--    previo barato para que alguien ajeno no pueda bloquear la fila de un negocio.
--    Bloquear en crear_invitacion también hace exacto el tope de 20 invitaciones sin usar
--    frente a altas simultáneas.
-- 2. Cupos de registro: registro_permitido sumaba el cupo antes de crear la cuenta, y un
--    fallo lo dejaba gastado. Ahora hay dos límites: `registros` cuenta cuentas (máximo 3; la
--    Edge Function devuelve el cupo con liberar_registro si la cuenta no se creó) e
--    `intentos` cuenta llamadas (máximo 10, no se devuelve). Cada intento manda un mail a la
--    dirección que se escribió, así que acotar intentos también acota el spam con un link
--    filtrado. Las dos cuentas se suben en la misma sentencia, con la fila bloqueada
--    (`for update` vuelve a evaluar el `where` sobre la versión confirmada): son atómicas.
-- 3. Slug: dos altas simultáneas con el mismo nombre podían chocar con el unique de
--    negocios.slug y abortar. Ahora el insert reintenta con el siguiente número.
--    Largo máximo: 40 de base + sufijo ("-local" o "-N").

alter table public.codigos_alta add column intentos int not null default 0;
alter table public.invitaciones add column intentos int not null default 0;

-- 1. Bloquear primero, comprobar después -----------------------------------------------------

create or replace function public.preparar_cambio_equipo(p_negocio_id uuid, p_user_id uuid)
returns public.rol_miembro
language plpgsql security definer set search_path = '' as $$
declare
  v_rol public.rol_miembro;
begin
  -- Chequeo previo: alguien ajeno no llega a bloquear el negocio.
  if not public.tiene_rol(p_negocio_id, '{dueno}') then
    raise exception 'Solo el dueño cambia el equipo' using errcode = '42501';
  end if;
  perform 1 from public.negocios where id = p_negocio_id for update;
  -- El que vale: después del bloqueo, con lo que otras transacciones ya confirmaron.
  if not public.tiene_rol(p_negocio_id, '{dueno}') then
    raise exception 'Solo el dueño cambia el equipo' using errcode = '42501';
  end if;
  select rol into v_rol from public.miembros where negocio_id = p_negocio_id and user_id = p_user_id;
  if v_rol is null then
    raise exception 'Esa persona no es parte del local' using errcode = 'P0002';
  end if;
  return v_rol;
end;
$$;

create or replace function public.crear_invitacion(p_negocio_id uuid, p_rol public.rol_miembro)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_max_pendientes constant int := 20;
  v_token text := public.token_aleatorio(32);
  v_id uuid;
  v_vence timestamptz := now() + interval '48 hours';
begin
  if not public.tiene_rol(p_negocio_id, '{dueno}') then
    raise exception 'Solo el dueño invita gente al local' using errcode = '42501';
  end if;
  -- Mismo bloqueo que los cambios de equipo: serializa contra quitarle el rol a quien invita
  -- y hace exacto el conteo de invitaciones sin usar.
  perform 1 from public.negocios where id = p_negocio_id for update;
  if not public.tiene_rol(p_negocio_id, '{dueno}') then
    raise exception 'Solo el dueño invita gente al local' using errcode = '42501';
  end if;
  if p_rol is null then
    raise exception 'Falta el rol' using errcode = '22023';
  end if;
  if (select count(*) from public.invitaciones
      where negocio_id = p_negocio_id and usada_at is null and revocada_at is null and vence_at > now())
     >= c_max_pendientes then
    raise exception 'Hay % invitaciones sin usar: revocá alguna antes de crear otra', c_max_pendientes
      using errcode = '22023';
  end if;

  insert into public.invitaciones (negocio_id, rol, token_hash, creada_por, vence_at)
  values (p_negocio_id, p_rol, extensions.digest(v_token, 'sha256'), auth.uid(), v_vence)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'vence_at', v_vence);
end;
$$;

-- 2. Cupos: cuentas e intentos por separado ---------------------------------------------------

create or replace function public.registro_permitido(p_codigo text default null, p_token text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c_max_registros constant int := 3;
  c_max_intentos constant int := 10;
  v_id uuid;
begin
  if (p_codigo is null) = (p_token is null) then
    raise exception 'Se espera un código o una invitación' using errcode = '22023';
  end if;

  if p_codigo is not null then
    select id into v_id from public.codigos_alta
    where codigo_hash = public.hash_codigo(p_codigo)
      and usado_at is null and vence_at > now()
      and registros < c_max_registros and intentos < c_max_intentos
    for update;
    if v_id is null then return false; end if;
    update public.codigos_alta set registros = registros + 1, intentos = intentos + 1 where id = v_id;
  else
    select id into v_id from public.invitaciones
    where token_hash = extensions.digest(p_token, 'sha256')
      and usada_at is null and revocada_at is null and vence_at > now()
      and registros < c_max_registros and intentos < c_max_intentos
    for update;
    if v_id is null then return false; end if;
    update public.invitaciones set registros = registros + 1, intentos = intentos + 1 where id = v_id;
  end if;
  return true;
end;
$$;

-- Devuelve el cupo de cuenta (no el intento) cuando la Edge Function no pudo crear la cuenta.
create function public.liberar_registro(p_codigo text default null, p_token text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (p_codigo is null) = (p_token is null) then
    raise exception 'Se espera un código o una invitación' using errcode = '22023';
  end if;
  if p_codigo is not null then
    update public.codigos_alta set registros = greatest(registros - 1, 0)
    where codigo_hash = public.hash_codigo(p_codigo);
  else
    update public.invitaciones set registros = greatest(registros - 1, 0)
    where token_hash = extensions.digest(p_token, 'sha256');
  end if;
end;
$$;

revoke all on function public.liberar_registro(text, text) from public, anon, authenticated;
grant execute on function public.liberar_registro(text, text) to service_role;

-- 3. Slug sin carreras ------------------------------------------------------------------------

create or replace function public.crear_negocio(p_codigo text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- Rutas fijas de la web que un slug no puede tapar.
  c_reservados constant text[] := '{login,registro,invitacion,bienvenida,nuevo-local,admin,api,app,anotado,www}';
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

-- create or replace conserva los GRANT de las funciones reemplazadas.
