-- Datos de desarrollo local. Contraseña de todos los usuarios: anotado123
--
--   Rotisería El Ceibo  (el-ceibo)    dueno@elceibo.test · cajero@elceibo.test · cocina@elceibo.test
--   Pizzería La Esquina (la-esquina)  dueno@laesquina.test · cajero@laesquina.test
--
-- IDs fijos para poder referenciarlos en tests.

create function pg_temp.crear_usuario(p_id uuid, p_email text) returns void
language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('anotado123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    p_id::text, p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now()
  );
$$;

select pg_temp.crear_usuario('00000000-0000-4000-a000-0000000000a1', 'dueno@elceibo.test');
select pg_temp.crear_usuario('00000000-0000-4000-a000-0000000000a2', 'cajero@elceibo.test');
select pg_temp.crear_usuario('00000000-0000-4000-a000-0000000000a3', 'cocina@elceibo.test');
select pg_temp.crear_usuario('00000000-0000-4000-a000-0000000000b1', 'dueno@laesquina.test');
select pg_temp.crear_usuario('00000000-0000-4000-a000-0000000000b2', 'cajero@laesquina.test');

-- El Ceibo tiene la IA habilitada; La Esquina no (para ver ese estado en local).
insert into negocios (id, nombre, slug, ia_permitida, horarios) values
  ('a0000000-0000-4000-8000-000000000001', 'Rotisería El Ceibo', 'el-ceibo', true,
   '{"mar":[["19:00","00:30"]],"mie":[["19:00","00:30"]],"jue":[["19:00","00:30"]],"vie":[["19:00","01:30"]],"sab":[["19:00","01:30"]],"dom":[["11:30","14:30"],["19:00","00:30"]]}'),
  ('b0000000-0000-4000-8000-000000000001', 'Pizzería La Esquina', 'la-esquina', false,
   '{"vie":[["20:00","00:00"]],"sab":[["20:00","00:00"]]}');

-- Números de WhatsApp de mentira (phone_number_id de Meta), para scripts/simular-whatsapp.mjs.
update negocios set wa_phone_number_id = '100000000000001' where slug = 'el-ceibo';
update negocios set wa_phone_number_id = '100000000000002' where slug = 'la-esquina';

insert into miembros (negocio_id, user_id, rol) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000a1', 'dueno'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000a2', 'cajero'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000a3', 'cocina'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000b1', 'dueno'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-0000000000b2', 'cajero');

-- Menú de El Ceibo ----------------------------------------------------------------------

insert into categorias (id, negocio_id, nombre, orden) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Chivitos', 1),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Milanesas', 2),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Hamburguesas', 3),
  ('a1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Pizzas', 4),
  ('a1000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'Empanadas', 5),
  ('a1000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'Acompañamientos', 6),
  ('a1000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'Bebidas', 7);

insert into productos (negocio_id, categoria_id, nombre, alias, precio_centavos, activo)
select 'a0000000-0000-4000-8000-000000000001', ('a1000000-0000-4000-8000-00000000000' || cat)::uuid,
       nombre, alias, precio, activo
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

-- Menú de La Esquina (chico: existe para probar el aislamiento) ------------------------

insert into categorias (id, negocio_id, nombre, orden) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Pizzas', 1),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Bebidas', 2);

insert into productos (negocio_id, categoria_id, nombre, alias, precio_centavos) values
  ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Pizza muzzarella', '{muzza}', 45000),
  ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Pizza napolitana', '{napo}', 50000),
  ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'Coca-Cola 1,5 L', '{"coca grande"}', 16000);
