-- Revisión de seguridad de la Fase 4, segunda vuelta: cupos de registro y límite de solicitudes.
--
-- 1. Reservas con id. Antes, la Edge Function devolvía el cupo ante cualquier error de
--    inviteUserByEmail. Pero Supabase Auth puede fallar DESPUÉS de crear la cuenta (el hook
--    triggerAfterUserCreated corre después del commit), y entonces se liberaba un cupo de una
--    cuenta que sí existe. Ahora cada intento es una fila en reservas_registro y se resuelve
--    contra la base, no contra el error:
--      * al reservar se anota el mail (hash) y si YA había una cuenta con ese mail;
--      * al resolver, la reserva gastó un cupo ('creada') solo si antes no había cuenta y
--        ahora sí. Si no ('liberada'), el cupo vuelve. Un reenvío a una cuenta sin confirmar,
--        o un "ya tenés cuenta", no gastan cupo. Sin comparar horas: no depende de relojes.
--    Si la función nunca llega a resolverla (corte de red), queda 'reservada' y cuenta como
--    usada: ante la duda, se gasta el cupo. Cada reserva se resuelve una sola vez (no hay
--    compensaciones dobles) y por su id (no toca el cupo de otra solicitud). Dos reservas
--    simultáneas para el mismo mail nuevo quedan las dos 'creada': cuenta de más, nunca de menos.
--    Límites: hasta 3 reservas no liberadas (cuentas) y 10 en total (intentos = mails).
--    Reemplaza los contadores registros/intentos, que se borran.
-- 2. Límite de solicitudes a `registro`, también con códigos inválidos: por IP (hasheada:
--    la IP es un dato personal) y uno total, porque la IP que llega en los headers se puede
--    falsear. El total es el techo real; el de IP evita que uno solo se lo coma entero.

drop function public.registro_permitido(text, text);
drop function public.liberar_registro(text, text);
alter table public.codigos_alta drop column registros, drop column intentos;
alter table public.invitaciones drop column registros, drop column intentos;

create table public.reservas_registro (
  id uuid primary key default gen_random_uuid(),
  codigo_id uuid references public.codigos_alta on delete cascade,
  invitacion_id uuid references public.invitaciones on delete cascade,
  -- sha256 del mail en minúsculas: el mail es un dato personal y acá solo hace falta compararlo.
  email_hash bytea not null,
  habia_cuenta boolean not null,
  estado text not null default 'reservada' check (estado in ('reservada', 'creada', 'liberada')),
  created_at timestamptz not null default now(),
  resuelta_at timestamptz,
  check ((codigo_id is null) <> (invitacion_id is null))
);

create index reservas_registro_codigo on public.reservas_registro (codigo_id) where codigo_id is not null;
create index reservas_registro_invitacion on public.reservas_registro (invitacion_id) where invitacion_id is not null;

-- Sin policies ni GRANT: solo las funciones de abajo (service_role).
alter table public.reservas_registro enable row level security;

create function public.hash_email(p_email text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(lower(btrim(coalesce(p_email, ''))), 'sha256');
$$;

-- ¿Hay una cuenta con este mail (por hash)? Recorre auth.users: alcanza para la escala actual.
create function public.existe_cuenta(p_email_hash bytea) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where public.hash_email(email) = p_email_hash);
$$;

-- Reserva un cupo para crear una cuenta con este código o invitación y este mail. Devuelve el
-- id de la reserva, o null si el código/invitación no sirve o ya no tiene cupo.
create function public.reservar_registro(p_email text, p_codigo text default null, p_token text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c_max_cuentas constant int := 3;
  c_max_intentos constant int := 10;
  v_codigo_id uuid;
  v_invitacion_id uuid;
  v_cuentas int;
  v_intentos int;
  v_email_hash bytea := public.hash_email(p_email);
  v_reserva uuid;
begin
  if (p_codigo is null) = (p_token is null) then
    raise exception 'Se espera un código o una invitación' using errcode = '22023';
  end if;
  if nullif(btrim(p_email), '') is null then
    raise exception 'Falta el mail' using errcode = '22023';
  end if;

  -- La fila del código o la invitación queda bloqueada hasta el final: dos reservas
  -- simultáneas se cuentan una después de la otra.
  if p_codigo is not null then
    select id into v_codigo_id from public.codigos_alta
    where codigo_hash = public.hash_codigo(p_codigo) and usado_at is null and vence_at > now()
    for update;
    if v_codigo_id is null then return null; end if;
  else
    select id into v_invitacion_id from public.invitaciones
    where token_hash = extensions.digest(p_token, 'sha256')
      and usada_at is null and revocada_at is null and vence_at > now()
    for update;
    if v_invitacion_id is null then return null; end if;
  end if;

  select count(*) filter (where estado <> 'liberada'), count(*) into v_cuentas, v_intentos
  from public.reservas_registro
  where codigo_id is not distinct from v_codigo_id and invitacion_id is not distinct from v_invitacion_id;
  if v_cuentas >= c_max_cuentas or v_intentos >= c_max_intentos then return null; end if;

  insert into public.reservas_registro (codigo_id, invitacion_id, email_hash, habia_cuenta)
  values (v_codigo_id, v_invitacion_id, v_email_hash, public.existe_cuenta(v_email_hash))
  returning id into v_reserva;
  return v_reserva;
end;
$$;

-- Resuelve una reserva según lo que pasó de verdad: gastó un cupo si antes no había cuenta con
-- ese mail y ahora sí. Idempotente: una reserva ya resuelta no cambia.
create function public.resolver_reserva(p_reserva uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_reserva public.reservas_registro;
  v_estado text;
begin
  select * into v_reserva from public.reservas_registro where id = p_reserva for update;
  if v_reserva.id is null then
    raise exception 'Reserva inexistente' using errcode = 'P0002';
  end if;
  if v_reserva.estado <> 'reservada' then return v_reserva.estado; end if;

  v_estado := case
    when not v_reserva.habia_cuenta and public.existe_cuenta(v_reserva.email_hash) then 'creada'
    else 'liberada'
  end;
  update public.reservas_registro set estado = v_estado, resuelta_at = now() where id = p_reserva;
  return v_estado;
end;
$$;

-- Límite de solicitudes a `registro` por minuto: por IP (hash) y total.
create table public.limites_registro (
  -- sha256 de la IP en hex, o 'total'.
  clave text not null,
  ventana timestamptz not null,
  cuenta int not null,
  primary key (clave, ventana)
);
create index limites_registro_ventana on public.limites_registro (ventana);
alter table public.limites_registro enable row level security;  -- sin policies: solo service_role

create function public.consumir_limite_registro(p_ip_hash text, p_max_ip int, p_max_total int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ventana timestamptz := date_trunc('minute', now());
  v_ip int;
  v_total int;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash de IP inválido' using errcode = '22023';
  end if;
  -- Limpieza de ventanas viejas (usa el índice por ventana).
  delete from public.limites_registro where ventana < v_ventana - interval '10 minutes';

  insert into public.limites_registro as l (clave, ventana, cuenta) values ('total', v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_total;

  insert into public.limites_registro as l (clave, ventana, cuenta) values (p_ip_hash, v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_ip;

  return v_ip <= p_max_ip and v_total <= p_max_total;
end;
$$;

revoke all on function public.hash_email(text) from public, anon, authenticated;
revoke all on function public.existe_cuenta(bytea) from public, anon, authenticated;
revoke all on function public.reservar_registro(text, text, text) from public, anon, authenticated;
revoke all on function public.resolver_reserva(uuid) from public, anon, authenticated;
revoke all on function public.consumir_limite_registro(text, int, int) from public, anon, authenticated;
grant execute on function public.reservar_registro(text, text, text) to service_role;
grant execute on function public.resolver_reserva(uuid) to service_role;
grant execute on function public.consumir_limite_registro(text, int, int) to service_role;
