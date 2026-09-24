-- Alta del local de demo en Supabase cloud. Se corre UNA vez en el SQL Editor del dashboard.
--
-- Antes: crear los tres usuarios en Authentication → Users → Add user (con "Auto Confirm
-- User") y poner sus mails abajo. Las contraseñas las elegís vos: nada de anotado123 en la nube.
--
-- Crea "Rotisería El Ceibo" (slug el-ceibo) con la IA habilitada y el menú de ejemplo.

do $$
declare
  -- Cambiá estos tres mails por los de los usuarios que creaste.
  c_dueno  constant text := 'dueno@ejemplo.com';
  c_cajero constant text := 'cajero@ejemplo.com';
  c_cocina constant text := 'cocina@ejemplo.com';

  v_negocio uuid;
  v_cat uuid[];
  v_email text;
begin
  foreach v_email in array array[c_dueno, c_cajero, c_cocina] loop
    if not exists (select 1 from auth.users where email = v_email) then
      raise exception 'No existe el usuario %: crealo primero en Authentication → Users', v_email;
    end if;
  end loop;

  insert into public.negocios (nombre, slug, ia_permitida)
  values ('Rotisería El Ceibo', 'el-ceibo', true)
  returning id into v_negocio;

  insert into public.miembros (negocio_id, user_id, rol)
  select v_negocio, u.id, r.rol::public.rol_miembro
  from (values (c_dueno, 'dueno'), (c_cajero, 'cajero'), (c_cocina, 'cocina')) as r (email, rol)
  join auth.users u on u.email = r.email;

  with nuevas as (
    insert into public.categorias (negocio_id, nombre, orden)
    select v_negocio, nombre, orden
    from (values ('Chivitos', 1), ('Milanesas', 2), ('Hamburguesas', 3), ('Pizzas', 4),
                 ('Empanadas', 5), ('Acompañamientos', 6), ('Bebidas', 7)) as c (nombre, orden)
    returning id, orden
  )
  select array_agg(id order by orden) into v_cat from nuevas;

  insert into public.productos (negocio_id, categoria_id, nombre, alias, precio_centavos, activo)
  select v_negocio, v_cat[cat], nombre, alias, precio, activo
  from (values
  (1, 'Chivito canadiense al pan',   '{chivito,"chivito al pan",chivi}'::text[],                   45000, true),
  (1, 'Chivito canadiense al plato', '{"chivito al plato","al plato"}',                            69000, true),
  (2, 'Milanesa al pan completa',    '{"mila al pan","milanesa al pan","mila completa"}',          32000, true),
  (2, 'Milanesa napolitana al plato','{napo,napolitana,"mila napo"}',                              55000, true),
  (3, 'Hamburguesa completa',        '{completa,compl,"la completa","hambur completa"}',           28000, true),
  (3, 'Hamburguesa simple',          '{simple,"hambur simple",hamburguesa}',                       20000, true),
  (4, 'Pizza muzzarella',            '{muzza,muza,"pizza común",pizza}',                           42000, true),
  (4, 'Pizza especial',              '{especial,"pizza con jamón"}',                               52000, true),
  (4, 'Fainá (porción)',             '{faina,fainá}',                                               6000, true),
  (5, 'Empanada de carne',           '{carne,"emp carne"}',                                         7000, true),
  (5, 'Empanada de jamón y queso',   '{jyq,"jamón y queso"}',                                       7000, true),
  (5, 'Pascualina (porción)',        '{pascualina}',                                               12000, false), -- agotada
  (6, 'Papas fritas',                '{papas,fritas,"porción de papas"}',                          20000, true),
  (7, 'Coca-Cola 600 ml',            '{"coca chica","coca 600"}',                                   9000, true),
  (7, 'Coca-Cola 1,5 L',             '{"coca grande","coca 1.5","coca de litro y medio"}',         15000, true),
  (7, 'Coca-Cola 2,25 L',            '{"coca 2.25","coca de 2 litros"}',                           19000, true),
  (7, 'Agua sin gas 600 ml',         '{agua}',                                                      7000, true),
  (7, 'Cerveza Pilsen 1 L',          '{pilsen,birra,cerveza}',                                     22000, true)
  ) as m (cat, nombre, alias, precio, activo);

  raise notice 'Listo: entrá a /el-ceibo con el usuario dueño.';
end;
$$;
