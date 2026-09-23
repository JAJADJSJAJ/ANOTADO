-- Esquema inicial de Anotado.
--
-- Convenciones:
--   * negocio_id en todas las tablas (simplifica RLS).
--   * Plata en centavos enteros.
--   * FKs compuestas (x_id, negocio_id) → (id, negocio_id): la base impide que una fila
--     del negocio A apunte a una del negocio B. RLS no alcanza para esto porque las FKs
--     se verifican sin pasar por RLS.

create type origen_pedido as enum ('whatsapp', 'mostrador', 'telefono', 'mesa');
create type estado_pedido as enum ('pendiente', 'en_cocina', 'listo', 'entregado', 'cancelado');
create type rol_miembro as enum ('dueno', 'cajero', 'cocina');
create type rol_mensaje as enum ('cliente', 'asistente', 'sistema');

create table negocios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text unique not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  wa_phone_number_id text unique,                  -- Fase 5
  zona_horaria text not null default 'America/Montevideo',
  -- La jornada arranca a esta hora local: un pedido de las 01:30 cuenta para el día anterior.
  hora_corte_jornada time not null default '06:00',
  horarios jsonb not null default '{}',            -- {"lun":[["19:00","01:00"]], ...}
  config jsonb not null default '{}',              -- zonas de envío, mensajes, etc.
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table miembros (
  negocio_id uuid not null references negocios on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  rol rol_miembro not null,
  primary key (negocio_id, user_id)
);

create table categorias (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  nombre text not null,
  orden int not null default 0,
  unique (id, negocio_id)
);

create table productos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  categoria_id uuid,
  nombre text not null,
  alias text[] not null default '{}',              -- {"completa","compl","la completa"}
  precio_centavos int not null check (precio_centavos >= 0),
  activo boolean not null default true,            -- false = agotado
  created_at timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (categoria_id, negocio_id) references categorias (id, negocio_id)
    on delete set null (categoria_id)
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  telefono text not null,
  nombre text,
  direcciones jsonb not null default '[]',
  unique (negocio_id, telefono),
  unique (id, negocio_id)
);

create table conversaciones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  cliente_id uuid,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  borrador jsonb not null default '{"items":[],"entrega":null}',
  ultimo_mensaje_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, negocio_id),
  foreign key (cliente_id, negocio_id) references clientes (id, negocio_id)
);

-- Una sola conversación abierta por cliente y negocio.
-- Ojo: no aplica cuando cliente_id es null (mensajes pegados sin cliente). Se define en Fase 2.
create unique index una_abierta on conversaciones (negocio_id, cliente_id)
  where estado = 'abierta';

create table mensajes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  conversacion_id uuid not null,
  rol rol_mensaje not null,
  contenido text not null,
  wa_message_id text unique,                       -- Deduplicación (Fase 5)
  created_at timestamptz not null default now(),
  foreign key (conversacion_id, negocio_id) references conversaciones (id, negocio_id)
    on delete cascade
);

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  -- numero y jornada los asigna el trigger asignar_numero_pedido. El número es el que se
  -- grita en cocina; se repite entre jornadas, la identidad real es id.
  jornada date not null,
  numero int not null,
  conversacion_id uuid,
  cliente_id uuid,
  origen origen_pedido not null,
  estado estado_pedido not null default 'pendiente',
  entrega jsonb,                                   -- {"modo":"delivery","direccion":"..."}
  notas text,
  total_centavos int not null default 0 check (total_centavos >= 0),
  mensaje_original text,
  creado_por uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (negocio_id, jornada, numero),
  unique (id, negocio_id),
  foreign key (conversacion_id, negocio_id) references conversaciones (id, negocio_id)
    on delete set null (conversacion_id),
  foreign key (cliente_id, negocio_id) references clientes (id, negocio_id)
    on delete set null (cliente_id)
);

create table pedido_items (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios on delete cascade,
  pedido_id uuid not null,
  producto_id uuid,
  nombre_snapshot text not null,                   -- Si cambian nombre o precio después,
  precio_unitario_centavos int not null            -- los pedidos viejos no se alteran.
    check (precio_unitario_centavos >= 0),
  cantidad int not null check (cantidad between 1 and 20),
  notas text,
  foreign key (pedido_id, negocio_id) references pedidos (id, negocio_id) on delete cascade,
  -- Sin on delete: un producto con pedidos no se borra, se desactiva (activo = false).
  foreign key (producto_id, negocio_id) references productos (id, negocio_id)
);

create table uso_ia (
  id bigint generated always as identity primary key,
  negocio_id uuid not null references negocios on delete cascade,
  conversacion_id uuid,
  modelo text not null,
  tokens_entrada int not null check (tokens_entrada >= 0),
  tokens_salida int not null check (tokens_salida >= 0),
  created_at timestamptz not null default now(),
  foreign key (conversacion_id, negocio_id) references conversaciones (id, negocio_id)
    on delete set null (conversacion_id)
);

-- Último número entregado por negocio y jornada. Lo usa solo el trigger.
create table contadores_pedidos (
  negocio_id uuid not null references negocios on delete cascade,
  jornada date not null,
  ultimo int not null,
  primary key (negocio_id, jornada)
);
