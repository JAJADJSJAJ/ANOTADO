-- updated_at automático.
create function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger pedidos_updated_at
  before update on pedidos
  for each row execute function set_updated_at();

-- Número de pedido correlativo por negocio y jornada (#1, #2...).
--
-- La jornada es la fecha local del negocio corrida por hora_corte_jornada: con corte a las
-- 06:00, un pedido de las 01:30 del martes es de la jornada del lunes. Así un turno de
-- 19 a 01 no se reinicia a medianoche.
--
-- El contador se incrementa con insert ... on conflict do update, que bloquea la fila:
-- dos pedidos simultáneos nunca reciben el mismo número. Se ignora cualquier numero o
-- jornada que venga en el insert.
create function asignar_numero_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_zona text;
  v_corte time;
begin
  select zona_horaria, hora_corte_jornada into strict v_zona, v_corte
  from public.negocios where id = new.negocio_id;

  new.jornada := ((new.created_at at time zone v_zona) - v_corte::interval)::date;

  insert into public.contadores_pedidos as c (negocio_id, jornada, ultimo)
  values (new.negocio_id, new.jornada, 1)
  on conflict (negocio_id, jornada) do update set ultimo = c.ultimo + 1
  returning ultimo into new.numero;

  return new;
end;
$$;

create trigger pedidos_numero
  before insert on pedidos
  for each row execute function asignar_numero_pedido();
