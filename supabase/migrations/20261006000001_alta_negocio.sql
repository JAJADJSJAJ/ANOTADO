-- Alta de negocios con código del operador (Fase 4).
--
-- Para dar de alta un local hace falta un código de un solo uso que genera el operador de
-- Anotado (crear_codigo_alta, desde el SQL Editor). Así el registro es self-service pero
-- controlado: nadie crea locales ni cuentas sin un código o una invitación de un dueño.
--
--   * Las cuentas las crea la Edge Function `registro` (el registro público de Supabase
--     queda apagado). Antes de crear la cuenta llama a registro_permitido (migración
--     equipo), que valida el código y cuenta cuántas cuentas se crearon con él (máximo 3).
--   * crear_negocio(codigo, nombre) crea el negocio y su primer dueño en una transacción y
--     marca el código como usado. El negocio arranca sin IA (ia_permitida = false).
--   * Los códigos se guardan hasheados (sha256): leer la tabla no da códigos usables.

create table public.codigos_alta (
  id uuid primary key default gen_random_uuid(),
  codigo_hash bytea not null unique,
  -- Para quién es el código. Solo lo ve el operador.
  nota text check (char_length(nota) <= 200),
  vence_at timestamptz not null,
  -- Cuentas creadas con este código (registro_permitido). Acota el abuso de un código filtrado.
  registros int not null default 0,
  usado_por uuid references auth.users on delete set null,
  usado_at timestamptz,
  negocio_id uuid references public.negocios on delete set null,
  created_at timestamptz not null default now()
);

-- Sin policies ni GRANT: solo el operador (postgres) y las funciones de abajo.
alter table public.codigos_alta enable row level security;

-- Alfabeto sin caracteres que se confunden (0/O, 1/I). 12 caracteres = 60 bits.
-- Se normaliza lo que escribe la persona: mayúsculas, sin guiones ni espacios.
create function public.hash_codigo(p_codigo text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), 'sha256');
$$;

-- Token aleatorio de un solo uso, en base64url (para invitaciones).
create function public.token_aleatorio(p_bytes int) returns text
language sql volatile set search_path = '' as $$
  select translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), E'+/=\n', '-_');
$$;

-- Operador: genera un código. Se corre en el SQL Editor y se le pasa al dueño.
--   select crear_codigo_alta('Pizzería Don José', 14);
create function public.crear_codigo_alta(p_nota text default null, p_dias int default 14)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  c_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_codigo text := '';
begin
  if p_dias is null or p_dias not between 1 and 90 then
    raise exception 'Los días de validez van de 1 a 90' using errcode = '22023';
  end if;
  -- 256 es múltiplo de 32: el módulo no sesga ninguna letra.
  for i in 0..11 loop
    v_codigo := v_codigo || substr(c_alfabeto, get_byte(v_bytes, i) % 32 + 1, 1);
  end loop;
  insert into public.codigos_alta (codigo_hash, nota, vence_at)
  values (public.hash_codigo(v_codigo), nullif(btrim(p_nota), ''), now() + make_interval(days => p_dias));
  return substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4) || '-' || substr(v_codigo, 9, 4);
end;
$$;

-- Slug para la URL a partir del nombre: "Rotisería El Ceibo" → "rotiseria-el-ceibo".
create function public.slug_desde_nombre(p_nombre text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(trim(both '-' from left(
      regexp_replace(lower(translate(p_nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', '-', 'g'),
      40)), ''),
    'local');
$$;

-- Crea el negocio y su primer dueño (quien llama), y consume el código. Todo o nada.
create function public.crear_negocio(p_codigo text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- Rutas fijas de la web que un slug no puede tapar.
  c_reservados constant text[] := '{login,registro,invitacion,nuevo-local,admin,api,app,anotado,www}';
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
  while exists (select 1 from public.negocios where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.negocios (nombre, slug) values (v_nombre, v_slug)
  returning id into v_negocio_id;
  insert into public.miembros (negocio_id, user_id, rol) values (v_negocio_id, v_user, 'dueno');
  update public.codigos_alta
  set usado_por = v_user, usado_at = now(), negocio_id = v_negocio_id
  where id = v_codigo_id;

  return jsonb_build_object('id', v_negocio_id, 'slug', v_slug);
end;
$$;

revoke all on function public.hash_codigo(text) from public, anon, authenticated;
revoke all on function public.token_aleatorio(int) from public, anon, authenticated;
revoke all on function public.crear_codigo_alta(text, int) from public, anon, authenticated, service_role;
revoke all on function public.slug_desde_nombre(text) from public, anon, authenticated;
revoke all on function public.crear_negocio(text, text) from public, anon, authenticated;

grant execute on function public.crear_negocio(text, text) to authenticated;
