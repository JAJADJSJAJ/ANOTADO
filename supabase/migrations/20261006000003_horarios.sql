-- Horarios del local (Fase 4).
--
-- negocios.horarios ya existía (jsonb). El dueño lo edita desde Ajustes, así que la base valida
-- la forma, igual que los alias del menú. Formato:
--   {"lun": [["19:00", "00:30"]], "sab": [["11:30", "14:30"], ["19:00", "01:30"]]}
--   * claves: lun mar mie jue vie sab dom (un día sin clave o con [] = cerrado);
--   * hasta 4 turnos por día, cada uno ["HH:MM", "HH:MM"];
--   * si el cierre es menor o igual a la apertura, el turno termina al día siguiente
--     ("19:00"–"00:30"; "20:00"–"00:00" cierra a medianoche). Apertura igual a cierre, no.
-- La lógica de "¿está abierto?" vive en shared/src/horarios.ts. Hoy solo avisa en el
-- mostrador; con el bot de WhatsApp (Fase 5/6) va a decidir qué responder.

create function public.horarios_validos(h jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c_hora constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  v_dia record;
  v_turno jsonb;
begin
  if jsonb_typeof(h) is distinct from 'object' then return false; end if;
  for v_dia in select key, value from jsonb_each(h) loop
    if v_dia.key not in ('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom') then return false; end if;
    if jsonb_typeof(v_dia.value) <> 'array' then return false; end if;
    if jsonb_array_length(v_dia.value) > 4 then return false; end if;
    for v_turno in select value from jsonb_array_elements(v_dia.value) loop
      if jsonb_typeof(v_turno) <> 'array' then return false; end if;
      if jsonb_array_length(v_turno) <> 2 then return false; end if;
      if jsonb_typeof(v_turno -> 0) <> 'string' or jsonb_typeof(v_turno -> 1) <> 'string' then
        return false;
      end if;
      if (v_turno ->> 0) !~ c_hora or (v_turno ->> 1) !~ c_hora then return false; end if;
      if (v_turno ->> 0) = (v_turno ->> 1) then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

alter table public.negocios
  add constraint horarios_validos check (public.horarios_validos(horarios));

revoke all on function public.horarios_validos(jsonb) from public, anon, authenticated;
-- El check se evalúa con los permisos de quien escribe (el dueño). Función pura, sin datos.
grant execute on function public.horarios_validos(jsonb) to authenticated;
