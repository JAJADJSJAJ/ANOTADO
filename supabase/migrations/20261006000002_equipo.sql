-- Equipo: invitaciones por link y roles (Fase 4).
--
-- `miembros` sigue siendo de solo lectura desde la web (permisos.sql). Todo cambio de equipo
-- va por estas RPC, que validan que quien llama sea dueño y que el local nunca quede sin
-- dueño. Para eso bloquean la fila del negocio: dos cambios simultáneos no pueden sacar a
-- los dos últimos dueños a la vez.
--
-- Invitación: el dueño elige el rol y recibe un link de un solo uso que vence en 48 h, para
-- mandarlo por WhatsApp. El token se guarda hasheado y se muestra una sola vez. Quien abre el
-- link entra (o crea su cuenta con la Edge Function `registro`) y acepta.

create table public.invitaciones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios on delete cascade,
  rol public.rol_miembro not null,
  token_hash bytea not null unique,
  creada_por uuid references auth.users on delete set null,
  vence_at timestamptz not null,
  -- Cuentas creadas con esta invitación (registro_permitido).
  registros int not null default 0,
  usada_por uuid references auth.users on delete set null,
  usada_at timestamptz,
  revocada_at timestamptz,
  created_at timestamptz not null default now()
);

create index invitaciones_negocio on public.invitaciones (negocio_id, created_at);

alter table public.invitaciones enable row level security;

-- El dueño ve las invitaciones de su local (para revocarlas). Nadie escribe directo.
create policy "ver invitaciones" on public.invitaciones for select to authenticated
  using (public.tiene_rol(negocio_id, '{dueno}'));
-- Sin token_hash ni registros: no le sirven a la pantalla.
grant select (id, negocio_id, rol, creada_por, vence_at, usada_por, usada_at, revocada_at, created_at)
  on public.invitaciones to authenticated;

-- Fila de una invitación usable (no usada, no revocada, no vencida), por token.
create function public.invitacion_vigente(p_token text) returns public.invitaciones
language sql stable set search_path = '' as $$
  select * from public.invitaciones
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and usada_at is null and revocada_at is null and vence_at > now();
$$;

-- Dueño: crea una invitación. Devuelve el token (única vez que se ve en claro).
create function public.crear_invitacion(p_negocio_id uuid, p_rol public.rol_miembro) returns jsonb
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

-- Dueño: anula una invitación que todavía no se usó.
create function public.revocar_invitacion(p_invitacion_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.invitaciones where id = p_invitacion_id;
  -- Mismo error si no existe o es de otro local: no se revela qué ids existen.
  if v_negocio_id is null or not public.tiene_rol(v_negocio_id, '{dueno}') then
    raise exception 'Invitación no encontrada' using errcode = 'P0002';
  end if;
  update public.invitaciones set revocada_at = now()
  where id = p_invitacion_id and usada_at is null and revocada_at is null;
end;
$$;

-- Quien abrió el link (ya con sesión): a qué local y con qué rol lo invitan.
create function public.ver_invitacion(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitaciones;
  v_nombre text;
begin
  if auth.uid() is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '42501';
  end if;
  v_inv := public.invitacion_vigente(p_token);
  if v_inv.id is null then
    raise exception 'La invitación no existe, venció o ya se usó' using errcode = 'P0002';
  end if;
  select nombre into v_nombre from public.negocios where id = v_inv.negocio_id;
  return jsonb_build_object(
    'negocio', v_nombre,
    'rol', v_inv.rol,
    'ya_es_miembro', exists (
      select 1 from public.miembros where negocio_id = v_inv.negocio_id and user_id = auth.uid()));
end;
$$;

-- Acepta la invitación: suma a quien llama al local con el rol de la invitación.
create function public.aceptar_invitacion(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_negocio_id uuid;
  v_rol public.rol_miembro;
  v_slug text;
begin
  if v_user is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '42501';
  end if;
  -- Se bloquea la invitación: dos personas con el mismo link no entran las dos.
  select id, negocio_id, rol into v_id, v_negocio_id, v_rol
  from public.invitaciones
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and usada_at is null and revocada_at is null and vence_at > now()
  for update;
  if v_id is null then
    raise exception 'La invitación no existe, venció o ya se usó' using errcode = 'P0002';
  end if;
  -- Un miembro no cambia su propio rol con un link: eso lo hace el dueño desde Equipo.
  if exists (select 1 from public.miembros where negocio_id = v_negocio_id and user_id = v_user) then
    raise exception 'Ya sos parte de este local' using errcode = '23505';
  end if;

  insert into public.miembros (negocio_id, user_id, rol) values (v_negocio_id, v_user, v_rol);
  update public.invitaciones set usada_por = v_user, usada_at = now() where id = v_id;
  select slug into v_slug from public.negocios where id = v_negocio_id;
  return jsonb_build_object('slug', v_slug, 'rol', v_rol);
end;
$$;

-- Edge Function `registro` (service_role): ¿se puede crear una cuenta con este código de
-- alta o esta invitación? Si sí, suma uno a su contador. Hasta 3 cuentas por código o
-- invitación: alcanza para equivocarse de mail, no para crear cuentas en serie con un link
-- filtrado. No consume el código ni la invitación: eso pasa al crear el local o aceptar.
create function public.registro_permitido(p_codigo text default null, p_token text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c_max_registros constant int := 3;
  v_id uuid;
begin
  if (p_codigo is null) = (p_token is null) then
    raise exception 'Se espera un código o una invitación' using errcode = '22023';
  end if;

  if p_codigo is not null then
    select id into v_id from public.codigos_alta
    where codigo_hash = public.hash_codigo(p_codigo)
      and usado_at is null and vence_at > now() and registros < c_max_registros
    for update;
    if v_id is null then return false; end if;
    update public.codigos_alta set registros = registros + 1 where id = v_id;
  else
    select id into v_id from public.invitaciones
    where token_hash = extensions.digest(p_token, 'sha256')
      and usada_at is null and revocada_at is null and vence_at > now() and registros < c_max_registros
    for update;
    if v_id is null then return false; end if;
    update public.invitaciones set registros = registros + 1 where id = v_id;
  end if;
  return true;
end;
$$;

-- Dueño: el equipo con sus mails (auth.users no se lee desde la web). Mails = datos
-- personales: solo para el dueño.
create function public.miembros_negocio(p_negocio_id uuid)
returns table (user_id uuid, email text, rol public.rol_miembro)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.tiene_rol(p_negocio_id, '{dueno}') then
    raise exception 'Solo el dueño ve el equipo' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.rol
    from public.miembros m join auth.users u on u.id = m.user_id
    where m.negocio_id = p_negocio_id
    order by m.rol, u.email;
end;
$$;

-- Cambio de equipo: valida dueño, bloquea el negocio y devuelve el rol actual del miembro.
create function public.preparar_cambio_equipo(p_negocio_id uuid, p_user_id uuid)
returns public.rol_miembro
language plpgsql security definer set search_path = '' as $$
declare
  v_rol public.rol_miembro;
begin
  if not public.tiene_rol(p_negocio_id, '{dueno}') then
    raise exception 'Solo el dueño cambia el equipo' using errcode = '42501';
  end if;
  perform 1 from public.negocios where id = p_negocio_id for update;
  select rol into v_rol from public.miembros where negocio_id = p_negocio_id and user_id = p_user_id;
  if v_rol is null then
    raise exception 'Esa persona no es parte del local' using errcode = 'P0002';
  end if;
  return v_rol;
end;
$$;

create function public.es_ultimo_dueno(p_negocio_id uuid, p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.miembros
    where negocio_id = p_negocio_id and rol = 'dueno' and user_id <> p_user_id);
$$;

create function public.cambiar_rol(p_negocio_id uuid, p_user_id uuid, p_rol public.rol_miembro)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actual public.rol_miembro := public.preparar_cambio_equipo(p_negocio_id, p_user_id);
begin
  if p_rol is null then
    raise exception 'Falta el rol' using errcode = '22023';
  end if;
  if v_actual = 'dueno' and p_rol <> 'dueno' and public.es_ultimo_dueno(p_negocio_id, p_user_id) then
    raise exception 'El local tiene que tener al menos un dueño' using errcode = '22023';
  end if;
  update public.miembros set rol = p_rol where negocio_id = p_negocio_id and user_id = p_user_id;
end;
$$;

create function public.quitar_miembro(p_negocio_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actual public.rol_miembro := public.preparar_cambio_equipo(p_negocio_id, p_user_id);
begin
  if v_actual = 'dueno' and public.es_ultimo_dueno(p_negocio_id, p_user_id) then
    raise exception 'El local tiene que tener al menos un dueño' using errcode = '22023';
  end if;
  delete from public.miembros where negocio_id = p_negocio_id and user_id = p_user_id;
end;
$$;

revoke all on function public.invitacion_vigente(text) from public, anon, authenticated;
revoke all on function public.crear_invitacion(uuid, public.rol_miembro) from public, anon, authenticated;
revoke all on function public.revocar_invitacion(uuid) from public, anon, authenticated;
revoke all on function public.ver_invitacion(text) from public, anon, authenticated;
revoke all on function public.aceptar_invitacion(text) from public, anon, authenticated;
revoke all on function public.registro_permitido(text, text) from public, anon, authenticated;
revoke all on function public.miembros_negocio(uuid) from public, anon, authenticated;
revoke all on function public.preparar_cambio_equipo(uuid, uuid) from public, anon, authenticated;
revoke all on function public.es_ultimo_dueno(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cambiar_rol(uuid, uuid, public.rol_miembro) from public, anon, authenticated;
revoke all on function public.quitar_miembro(uuid, uuid) from public, anon, authenticated;

grant execute on function public.crear_invitacion(uuid, public.rol_miembro) to authenticated;
grant execute on function public.revocar_invitacion(uuid) to authenticated;
grant execute on function public.ver_invitacion(text) to authenticated;
grant execute on function public.aceptar_invitacion(text) to authenticated;
grant execute on function public.miembros_negocio(uuid) to authenticated;
grant execute on function public.cambiar_rol(uuid, uuid, public.rol_miembro) to authenticated;
grant execute on function public.quitar_miembro(uuid, uuid) to authenticated;
grant execute on function public.registro_permitido(text, text) to service_role;
