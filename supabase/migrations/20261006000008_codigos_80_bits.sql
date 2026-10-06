-- Revisión de seguridad de la Fase 4, tercera vuelta: códigos de alta de 80 bits.
--
-- Con 12 caracteres (60 bits), adivinar en línea es inviable, pero si se filtrara la tabla
-- codigos_alta, los hashes sha256 permitirían probar candidatos fuera de línea. 16 caracteres
-- (80 bits) lo dejan fuera de alcance aunque el código siga vigente. Formato: XXXX-XXXX-XXXX-XXXX.
-- Todavía no hay códigos en producción: no hace falta migrar los viejos (los de 12 dejan de
-- ser aceptados por la web, que valida el largo).

create or replace function public.crear_codigo_alta(p_nota text default null, p_dias int default 14)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  c_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  c_largo constant int := 16;
  v_bytes bytea := extensions.gen_random_bytes(c_largo);
  v_codigo text := '';
begin
  if p_dias is null or p_dias not between 1 and 90 then
    raise exception 'Los días de validez van de 1 a 90' using errcode = '22023';
  end if;
  -- 256 es múltiplo de 32: el módulo no sesga ninguna letra.
  for i in 0..c_largo - 1 loop
    v_codigo := v_codigo || substr(c_alfabeto, get_byte(v_bytes, i) % 32 + 1, 1);
  end loop;
  insert into public.codigos_alta (codigo_hash, nota, vence_at)
  values (public.hash_codigo(v_codigo), nullif(btrim(p_nota), ''), now() + make_interval(days => p_dias));
  return substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4) || '-'
      || substr(v_codigo, 9, 4) || '-' || substr(v_codigo, 13, 4);
end;
$$;

-- create or replace conserva los permisos: solo el operador (revocada a todos los roles de la API).
