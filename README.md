# Anotado

> Los pedidos de WhatsApp, anotados solos.

Los locales de comida reciben pedidos por WhatsApp y los anotan en papel: se mezclan, se pierden, llegan tarde. Anotado convierte esos mensajes en pedidos ordenados que aparecen en la pantalla de cocina en tiempo real. La IA propone el pedido, una persona lo confirma.

> 🚧 En construcción. Demo en vivo, GIF y arquitectura llegan con la Fase 3.

## Decisiones clave

- **El estado vive en la base, no en la IA.** La IA traduce texto a acciones; el borrador del pedido está en Postgres.
- **La IA propone, el humano confirma.** Lo dudoso se marca, nunca se inventa.
- **Aislamiento por negocio con RLS** en todas las tablas, verificado con tests.
- **Los precios nunca salen de la IA.** El total se recalcula en el servidor.

Detalle en [`docs/decisiones.md`](docs/decisiones.md).

## Stack

React + TypeScript (Vite, Tailwind) · Supabase (Postgres, Auth, Realtime, Edge Functions) · Zod · Vitest · pgTAP · pnpm workspaces.

## Correrlo localmente

Requisitos: Node 24, pnpm y Docker Desktop.

```bash
pnpm install
pnpm db:start          # levanta Supabase local, aplica migraciones y seed
pnpm db:test           # tests de la base (aislamiento, roles, numeración, confirmar_pedido)
pnpm test              # tests de packages/shared
```

Copiá `.env.example` a `apps/web/.env.local` con la URL y la publishable key que imprime `pnpm supabase status`, y después:

```bash
pnpm dev
```

Usuarios de prueba (contraseña `anotado123`): `dueno@elceibo.test`, `cajero@elceibo.test`, `cocina@elceibo.test`, `dueno@laesquina.test`.

Para entrar con tu propio mail, copiá `supabase/seed.local.example.sql` a `supabase/seed.local.sql` (ignorado por git), poné tu mail y corré `pnpm db:reset`.

Panel local: Studio en http://127.0.0.1:54323 (tablas, usuarios, SQL) y Mailpit en http://127.0.0.1:54324 (mails que manda Auth).

## Estructura

```
apps/web            Frontend
packages/shared     Schemas y lógica pura compartida (web + Edge Functions)
supabase/           Migraciones, seed, tests pgTAP y Edge Functions
docs/               Arquitectura y decisiones
```
