# Decisiones

Registro del porqué de cada decisión. Lo nuevo va abajo.

## Fase 0

### Número de pedido por jornada, no por día calendario
El `numero` (#1, #2…) es la etiqueta que se grita en cocina; la identidad real del pedido es `id`. Se reinicia por **jornada**: la fecha local del negocio corrida por `negocios.hora_corte_jornada` (default 06:00). Una rotisería que abre de 19 a 01 no pasa de #47 a #1 a medianoche. Único por `(negocio_id, jornada, numero)`.

### Contador en tabla aparte
`max(numero) + 1` da números repetidos con inserts simultáneos. `contadores_pedidos` se incrementa con `insert … on conflict do update … returning`, que bloquea la fila y serializa.

### FKs compuestas `(x_id, negocio_id)`
RLS valida el `negocio_id` de la fila que se escribe, pero las FKs se verifican sin RLS: sin esto, un usuario de A podría crear un item que apunte a un pedido o producto de B. Con FKs compuestas la base lo impide sin importar qué falle arriba.

### Pedidos, conversaciones y mensajes solo se escriben desde el servidor
Ninguna policy permite a `authenticated` insertar o editar `pedidos`, `pedido_items`, `conversaciones`, `mensajes` ni `uso_ia`. Se escriben desde Edge Functions o RPCs `security definer` que validan y recalculan el total. Si el navegador pudiera insertar pedidos, el recálculo del total en el servidor no serviría de nada.

### Cocina no ve clientes ni conversaciones
Teléfonos y direcciones son datos personales (Ley 18.331). Cocina solo necesita el pedido.

### pgTAP en CI
El test de aislamiento entre negocios es el más importante del proyecto, así que corre en cada PR (job `db`), no solo local.

### TypeScript 6.0, no 7
TS 7 (compilador nativo) todavía no es compatible con typescript-eslint. Volver a evaluar cuando lo soporte.

### Supabase CLI como devDependency
Queda fijada la versión en el lockfile y no hace falta instalarla global: `pnpm supabase …`.

## Pendiente de decidir

- **Conversación al pegar un mensaje (Fase 2).** Sin teléfono no hay `cliente_id`, y el índice `una_abierta` no aplica a nulls. Definir si cada pegado abre una conversación o el cajero elige una.
- **Compartir `packages/shared` con Deno (Fase 2).** Hacer una prueba chica de import + deploy antes de depender de eso.
- **Proveedor y modelo de IA (antes de Fase 2).**
