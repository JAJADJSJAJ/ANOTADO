-- Acceso a la IA por negocio. Dos llaves, las dos tienen que estar en true:
--   ia_permitida: la da o la saca el operador de Anotado (hoy, con SQL desde el dashboard).
--                 Nadie la cambia desde la web: no está en el GRANT de update.
--   ia_activa:    la prende o la apaga el dueño para su local.
-- parse-order las chequea antes de llamar al proveedor: con alguna apagada no se gasta nada.
-- Un negocio nuevo arranca sin IA hasta que el operador la habilita.

alter table public.negocios
  add column ia_permitida boolean not null default false,
  add column ia_activa boolean not null default true;

grant update (ia_activa) on public.negocios to authenticated;
