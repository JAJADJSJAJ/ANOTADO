-- Panel del operador de Anotado.
--
-- El operador administra LOCALES, no lo que pasa adentro: ve la lista de locales con datos
-- agregados (dueños, fecha de alta, cantidad de pedidos y de uso de IA), prende o corta la IA,
-- suspende o reactiva un local y maneja los códigos de alta. No ve pedidos, productos,
-- clientes ni conversaciones.
--
-- Quién es operador: la tabla `operadores`, que la web no puede escribir. El primero se carga
-- una vez a mano con SQL (docs/deploy.md).
--
-- Segundo factor obligatorio: es_operador() exige además que la sesión tenga `aal = aal2`, o
-- sea que en esta sesión se verificó el código de la app de autenticación (TOTP). Lo decide la
-- base mirando el JWT, no la pantalla: con solo la contraseña, ninguna función del panel
-- responde.
--
-- Suspender un local: negocios.activo (ya existía, la web nunca lo pudo editar). es_miembro y
-- tiene_rol ahora exigen que el local esté activo, y como todas las policies y RPC del local
-- pasan por ellas, un local suspendido queda sin acceso a todo de una vez (también Realtime y
-- parse-order). mis_locales_suspendidos() le dice a su gente por qué no puede entrar.
--
-- Cada acción del panel queda en registro_operador.

create table public.operadores (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.operadores enable row level security;  -- sin policies ni GRANT

create table public.registro_operador (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  accion text not null,
  negocio_id uuid references public.negocios on delete set null,
  detalle jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.registro_operador enable row level security;  -- sin policies ni GRANT

-- Operador con el segundo factor verificado en esta sesión.
create function public.es_operador() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.operadores where user_id = auth.uid());
$$;

-- Para la pantalla: si quien llama es operador y si ya verificó el código. Solo informa sobre
-- uno mismo.
create function public.mi_estado_operador() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'operador', exists (select 1 from public.operadores where user_id = auth.uid()),
    'segundo_factor', coalesce(auth.jwt() ->> 'aal', '') = 'aal2');
$$;

create function public.exigir_operador() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.es_operador() then
    raise exception 'Solo el operador de Anotado, con el código de verificación' using errcode = '42501';
  end if;
end;
$$;

create function public.anotar_operador(p_accion text, p_negocio_id uuid, p_detalle jsonb default '{}')
returns void
language sql security definer set search_path = '' as $$
  insert into public.registro_operador (user_id, accion, negocio_id, detalle)
  values (auth.uid(), p_accion, p_negocio_id, coalesce(p_detalle, '{}'));
$$;

-- Suspensión: los helpers de RLS exigen local activo ---------------------------------------

create or replace function public.es_miembro(n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m join public.negocios ng on ng.id = m.negocio_id
    where m.negocio_id = n and m.user_id = auth.uid() and ng.activo
  );
$$;

create or replace function public.tiene_rol(n uuid, roles public.rol_miembro[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m join public.negocios ng on ng.id = m.negocio_id
    where m.negocio_id = n and m.user_id = auth.uid() and m.rol = any (roles) and ng.activo
  );
$$;

-- Locales suspendidos de quien llama (solo nombres), para explicarle por qué no entra.
create function public.mis_locales_suspendidos() returns table (nombre text)
language sql stable security definer set search_path = '' as $$
  select ng.nombre from public.miembros m join public.negocios ng on ng.id = m.negocio_id
  where m.user_id = auth.uid() and not ng.activo
  order by ng.nombre;
$$;

-- Panel -------------------------------------------------------------------------------------

-- Locales con datos agregados. Nada de contenido: ni pedidos, ni productos, ni clientes.
create function public.operador_locales()
returns table (
  id uuid, nombre text, slug text, activo boolean, ia_permitida boolean, ia_activa boolean,
  created_at timestamptz, duenos text[], miembros int, pedidos_30d int, usos_ia_30d int
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
       where ui.negocio_id = ng.id and ui.created_at > now() - interval '30 days')
    from public.negocios ng
    order by ng.created_at desc, ng.nombre;
end;
$$;

create function public.operador_cambiar_ia(p_negocio_id uuid, p_permitida boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_operador();
  if p_permitida is null then
    raise exception 'Falta indicar si la IA queda permitida' using errcode = '22023';
  end if;
  update public.negocios set ia_permitida = p_permitida where id = p_negocio_id;
  if not found then
    raise exception 'Local no encontrado' using errcode = 'P0002';
  end if;
  perform public.anotar_operador(case when p_permitida then 'ia_permitida' else 'ia_cortada' end, p_negocio_id);
end;
$$;

create function public.operador_cambiar_activo(p_negocio_id uuid, p_activo boolean, p_motivo text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.exigir_operador();
  if p_activo is null then
    raise exception 'Falta indicar si el local queda activo' using errcode = '22023';
  end if;
  if char_length(v_motivo) > 200 then
    raise exception 'El motivo puede tener hasta 200 caracteres' using errcode = '22023';
  end if;
  update public.negocios set activo = p_activo where id = p_negocio_id;
  if not found then
    raise exception 'Local no encontrado' using errcode = 'P0002';
  end if;
  perform public.anotar_operador(case when p_activo then 'reactivado' else 'suspendido' end, p_negocio_id,
    jsonb_strip_nulls(jsonb_build_object('motivo', v_motivo)));
end;
$$;

-- Código de alta nuevo. Devuelve el código en claro: única vez que se ve.
create function public.operador_crear_codigo(p_nota text default null, p_dias int default 14) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text;
begin
  perform public.exigir_operador();
  v_codigo := public.crear_codigo_alta(p_nota, p_dias);
  perform public.anotar_operador('codigo_creado', null,
    jsonb_strip_nulls(jsonb_build_object('nota', nullif(btrim(p_nota), ''), 'dias', p_dias)));
  return v_codigo;
end;
$$;

-- Códigos con su estado (sin el hash).
create function public.operador_codigos()
returns table (id uuid, nota text, created_at timestamptz, vence_at timestamptz, usado_at timestamptz,
               negocio text, estado text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_operador();
  return query
    select c.id, c.nota, c.created_at, c.vence_at, c.usado_at, ng.nombre,
      case when c.usado_at is not null then 'usado'
           when c.vence_at <= now() then 'vencido'
           else 'vigente' end
    from public.codigos_alta c left join public.negocios ng on ng.id = c.negocio_id
    order by c.created_at desc
    limit 200;
end;
$$;

-- Anular un código sin usar: vence ahora.
create function public.operador_anular_codigo(p_codigo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_operador();
  update public.codigos_alta set vence_at = now()
  where id = p_codigo_id and usado_at is null and vence_at > now();
  if not found then
    raise exception 'El código no existe, ya se usó o ya venció' using errcode = 'P0002';
  end if;
  perform public.anotar_operador('codigo_anulado', null, jsonb_build_object('codigo_id', p_codigo_id));
end;
$$;


-- La ruta /operador de la web: un local no puede tener ese slug (crear_negocio, igual que antes
-- salvo la lista de reservados).
create or replace function public.crear_negocio(p_codigo text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- Rutas fijas de la web que un slug no puede tapar.
  c_reservados constant text[] := '{login,registro,invitacion,bienvenida,operador,nuevo-local,admin,api,app,anotado,www}';
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
-- Permisos ----------------------------------------------------------------------------------

revoke all on function public.es_operador() from public, anon, authenticated;
revoke all on function public.mi_estado_operador() from public, anon, authenticated;
revoke all on function public.exigir_operador() from public, anon, authenticated;
revoke all on function public.anotar_operador(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mis_locales_suspendidos() from public, anon, authenticated;
revoke all on function public.operador_locales() from public, anon, authenticated;
revoke all on function public.operador_cambiar_ia(uuid, boolean) from public, anon, authenticated;
revoke all on function public.operador_cambiar_activo(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.operador_crear_codigo(text, int) from public, anon, authenticated;
revoke all on function public.operador_codigos() from public, anon, authenticated;
revoke all on function public.operador_anular_codigo(uuid) from public, anon, authenticated;

grant execute on function public.mi_estado_operador() to authenticated;
grant execute on function public.mis_locales_suspendidos() to authenticated;
grant execute on function public.operador_locales() to authenticated;
grant execute on function public.operador_cambiar_ia(uuid, boolean) to authenticated;
grant execute on function public.operador_cambiar_activo(uuid, boolean, text) to authenticated;
grant execute on function public.operador_crear_codigo(text, int) to authenticated;
grant execute on function public.operador_codigos() to authenticated;
grant execute on function public.operador_anular_codigo(uuid) to authenticated;
-- es_miembro y tiene_rol: create or replace conserva su GRANT a authenticated.
