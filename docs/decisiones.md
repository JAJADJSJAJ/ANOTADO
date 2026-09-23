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
Teléfonos y direcciones son datos personales (Ley 18.331). Cocina no ve `clientes`, `conversaciones` ni `mensajes`. **Sí ve** `pedidos.entrega` (dirección de delivery) y `pedidos.mensaje_original`, porque RLS filtra filas, no columnas. Se acepta por ahora; en Fase 3 se decide si cocina lee por una RPC/vista que devuelva solo lo que necesita (ojo: Realtime manda la fila completa).

### GRANTs mínimos además de RLS
Supabase da `ALL` (incluido `TRUNCATE`, que no pasa por RLS) a `anon` y `authenticated` sobre todo lo que se crea en `public`. La migración `permisos` saca todo y da solo lo que cada policy usa; `anon` no tiene nada. Los default privileges también se revocaron: **cada tabla o RPC nueva tiene que declarar sus GRANT** en su migración.

### Roles y alta de negocio solo por RPC (Fase 4)
Desde la web `miembros` es solo lectura. Con `ALL` para el dueño, podía nombrar dueños, sacar a otros dueños o dejar al negocio sin dueño. Invitar/cambiar roles y crear un negocio con su primer dueño (atómico, validando identidad) van por RPC en Fase 4. Hoy nadie puede crear negocios desde la web: no hay policy ni GRANT de insert.

### service_role vs RPC security definer
- **Edge Function con `service_role`**: saltea RLS y GRANTs. La función verifica JWT, membresía y rol antes de tocar nada.
- **RPC `security definer`**: corre como su dueño, también saltea RLS. Tiene que validar `auth.uid()`, que sea miembro con el rol correcto del `negocio_id` recibido, y **recalcular precios y total desde `productos`**, ignorando cualquier total que mande el cliente.

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
