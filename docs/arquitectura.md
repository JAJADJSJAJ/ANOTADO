# Arquitectura

```mermaid
flowchart LR
  subgraph navegador[Navegador]
    mostrador[Mostrador]
    cocina[Cocina]
    admin[Admin]
  end
  subgraph supabase[Supabase]
    auth[Auth]
    fn[parse-order<br/>Edge Function]
    rpc[RPC security definer<br/>confirmar_pedido · avanzar_estado<br/>cancelar_pedido · pedidos_cocina]
    db[(Postgres + RLS)]
    rt[Realtime<br/>canal negocio:id:pedidos]
  end
  ia[OpenRouter]

  mostrador -- JWT --> fn
  fn --> ia
  fn -- service_role,<br/>una transacción --> db
  mostrador & cocina & admin -- JWT --> rpc
  admin -- menú, ajustes<br/>RLS por rol --> db
  rpc --> db
  db -- trigger: id + estado --> rt
  rt -- solo miembros --> cocina & mostrador
```

## Quién escribe qué

| Qué | Cómo | Por qué |
|---|---|---|
| Menú, ajustes, horarios, zonas de envío | Directo a la tabla, con RLS por rol | Es lo que el dueño edita a mano |
| Agotados | `marcar_agotado` (cualquier rol del local) | Solo toca `productos.activo`; precio y nombre siguen siendo del dueño |
| Pedidos | `confirmar_pedido` (cajero, dueño) | Recalcula el total desde `productos` y el envío desde `zonas_envio`, ignora precios del cliente |
| Cuentas | Edge Function `registro` | Solo con código de alta o invitación vigentes; la cuenta nace sin contraseña y se confirma por mail |
| Locales | `crear_negocio` | Negocio + primer dueño en una transacción, consume el código del operador |
| Equipo | `crear_invitacion` / `aceptar_invitacion` / `cambiar_rol` / `quitar_miembro` | Solo el dueño; el local nunca queda sin dueño |
| Operador: IA, suspensión, códigos | `operador_*` | Solo quien está en `operadores` y verificó el código del celular (`aal2`); no ve el contenido de los locales |
| Estado del pedido | `avanzar_estado` / `retroceder_estado` / `cancelar_pedido` | Solo cambian el estado, y cada rol solo mueve lo de su área |
| Borrador de WhatsApp (pegado) | `parse-order` → `guardar_interpretacion` | La IA no escribe: todo se guarda en una transacción al final |
| Mensajes de WhatsApp (Meta) | `whatsapp-webhook` → `recibir_mensaje_wa` | Firma de Meta verificada; se guarda antes de contestar, con dedupe por `wa_message_id` |
| Borrador de WhatsApp (Meta) | intérprete → `guardar_interpretacion_wa` | Turno por conversación; marca solo los mensajes que leyó la IA |
| Correcciones del cajero | `guardar_borrador` (cajero, dueño) | Con versión: la IA siempre parte de lo corregido |
| Pedido de WhatsApp | `confirmar_conversacion` → `confirmar_pedido` | Exige la última versión y que no haya mensajes después del último que se ve |

## Un pedido de WhatsApp, de punta a punta

```mermaid
sequenceDiagram
  participant C as Cajero (mostrador)
  participant F as parse-order
  participant IA as OpenRouter
  participant DB as Postgres
  participant RT as Realtime
  participant K as Cocina (tablet)

  C->>F: mensaje + borrador actual
  F->>DB: rol, IA habilitada, límite, menú, conversación
  F->>IA: menú (p1, p2… sin precios) + borrador + últimos mensajes
  IA-->>F: acciones JSON
  F->>F: Zod + reducer (productos, cantidades, largos)
  F->>DB: guardar_interpretacion (una transacción)
  F-->>C: borrador, dudosos, preguntas
  C->>DB: confirmar_pedido (total recalculado)
  DB->>RT: trigger: {pedido_id, estado}
  RT-->>K: aviso
  K->>DB: pedidos_cocina()
  DB-->>K: pedidos activos (sin dirección ni teléfono)
```

### Con WhatsApp conectado

```mermaid
sequenceDiagram
  participant Cl as Cliente
  participant M as Meta
  participant W as whatsapp-webhook
  participant DB as Postgres
  participant IA as OpenRouter
  participant RT as Realtime
  participant C as Cajero (mostrador)

  Cl->>M: "2 completas a Blandengues 450"
  M->>W: webhook firmado (HMAC del cuerpo)
  W->>W: verificar firma
  W->>DB: recibir_mensaje_wa (dedupe, cliente, conversación)
  W-->>M: 200 enseguida
  DB->>RT: {conversacion_id}
  RT-->>C: aviso → relee la tarjeta
  W->>DB: tomar turno, esperar la ráfaga, leer pendientes
  W->>IA: menú + borrador guardado + mensajes nuevos juntos
  IA-->>W: acciones JSON
  W->>DB: guardar_interpretacion_wa (solo esos mensajes)
  DB->>RT: {conversacion_id}
  RT-->>C: el pedido aparece
  C->>DB: guardar_borrador (correcciones, con versión)
  C->>DB: confirmar_conversacion (versión + último mensaje visto)
```

## Cocina: nunca perder un pedido

Realtime es solo un aviso de que algo cambió; la verdad es siempre `pedidos_cocina()`. La lista completa se recarga:

1. Al suscribirse al canal, y otra vez en cada reconexión (Realtime vuelve a mandar `SUBSCRIBED`).
2. Al volver internet (`online`) y al volver a la pestaña (`visibilitychange`).
3. Cada 30 s, por si el websocket murió sin avisar (típico en tablets que se duermen).

Varios avisos seguidos se juntan en una sola recarga, y nunca corren dos cargas a la vez. El temporizador usa la hora del servidor (con el desfase medido en cada carga), no el reloj de la tablet.

Cambiar un estado manda el estado que se ve en pantalla (`desde`): si otro dispositivo ya lo movió, la base no hace nada y devuelve el estado real. Así un doble toque o un reintento después de un corte no saltea un paso.

## Seguridad por capas

- **RLS** en todas las tablas y **GRANTs mínimos**: `anon` no tiene nada salvo la RPC `ping()` (sin datos, para que el plan gratis no pause el proyecto), y cada tabla o función declara sus permisos.
- **FKs compuestas `(id, negocio_id)`**: la base impide cruzar datos entre negocios aunque falle lo de arriba.
- **Cocina** no lee `pedidos` ni `pedido_items` directo: solo por `pedidos_cocina()`.
- **Realtime** con canales privados: una policy sobre `realtime.messages` deja escuchar solo a los miembros del negocio, y nadie manda avisos desde el navegador.
- **IA**: la key vive en los secrets de Supabase; la web nunca la ve. Hay límites por usuario y por negocio, y dos llaves de acceso por local.
- **Web**: CSP que solo permite conectarse a Supabase (`apps/web/vercel.json`).
