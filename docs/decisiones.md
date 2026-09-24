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
Desde la web `miembros` es solo lectura (el encabezado de `rls.sql` todavía dice que la web escribe "equipo": quedó desactualizado por `permisos.sql`, que borra esa policy). Con `ALL` para el dueño, podía nombrar dueños, sacar a otros dueños o dejar al negocio sin dueño. Invitar/cambiar roles y crear un negocio con su primer dueño (atómico, validando identidad) van por RPC en Fase 4. Hoy nadie puede crear negocios desde la web: no hay policy ni GRANT de insert.

### Convenciones para migraciones nuevas
- Nombres calificados con esquema (`public.es_miembro`, `public.rol_miembro`) en policies, grants y funciones. Las policies ya creadas quedan ligadas por OID al crearse, así que las viejas no dependen del `search_path`; esto es para que se lea claro y no sorprenda.
- Toda tabla o función nueva declara sus `GRANT` (los default privileges están revocados, también para `PUBLIC`).
- Toda FK hacia una tabla con `negocio_id` es compuesta, con su test de cruce entre negocios en `aislamiento.test.sql`.

### service_role vs RPC security definer
- **Edge Function con `service_role`**: saltea RLS y GRANTs. La función verifica JWT, membresía y rol antes de tocar nada.
- **RPC `security definer`**: corre como su dueño, también saltea RLS. Tiene que validar `auth.uid()`, que sea miembro con el rol correcto del `negocio_id` recibido, y **recalcular precios y total desde `productos`**, ignorando cualquier total que mande el cliente.

### pgTAP en CI
El test de aislamiento entre negocios es el más importante del proyecto, así que corre en cada PR (job `db`), no solo local.

### TypeScript 6.0, no 7
TS 7 (compilador nativo) todavía no es compatible con typescript-eslint. Volver a evaluar cuando lo soporte.

### Supabase CLI como devDependency
Queda fijada la versión en el lockfile y no hace falta instalarla global: `pnpm supabase …`.

## Fase 1

### confirmar_pedido es una RPC, no una Edge Function
El plan decía Edge Function + RPC. La Edge Function no sumaba seguridad: todo lo que valida (rol, productos activos del negocio, cantidades, entrega) lo hace la RPC `security definer`, que además recalcula precios y total desde `productos` en la misma transacción. Menos piezas (sin Deno ni deploy de funciones) y se testea con pgTAP. `parse-order` (Fase 2) sí va como Edge Function porque maneja la clave de la IA.

### La RPC no recibe precios ni totales
Los items llegan como `{producto_id, cantidad, notas}`; cualquier otro campo se ignora. La entrega se reconstruye con solo los campos conocidos. Errores de validación con `22023` y mensaje en español, que la web muestra tal cual.

### Límites espejados en tres lugares
`packages/shared/src/reglas.ts` (UI y Zod), la RPC y el `check` de `pedido_items`. Si cambia uno, cambian los tres.

### El borrador es la misma estructura para carga manual y para la IA
`Borrador = { items, entrega }` en `shared`. El mostrador lo edita con operaciones puras (`agregarItem`, `cambiarCantidad`…); en Fase 2 las acciones de la IA van a aplicar sobre lo mismo.

### Sin datos de cliente en Fase 1
El pedido manual lleva origen, entrega y notas. Teléfono y nombre llegan con WhatsApp.

### Solo login con contraseña
Magic link queda para cuando haya usuarios reales (necesita SMTP configurado en Supabase cloud).

### El total que ve el cajero es estimado
La web suma precios para mostrar mientras arma el pedido; el que vale es el que devuelve la RPC, y es el que se muestra al confirmar.

## Fase 2

### Proveedor de IA: API compatible con OpenAI, vía OpenRouter
El cliente (`shared/src/ia/cliente.ts`) habla el formato compatible con OpenAI, que usan OpenRouter, NVIDIA, Groq, DeepSeek y muchos más. Cambiar de proveedor o modelo es configuración (URL, key, modelo), no código. Se usa OpenRouter como puerta única: una key, cientos de modelos, y filtro de proveedores que no retienen datos.

### Modelos baratos (DeepSeek, Qwen), pero no por su API directa
Cuestan entre ~US$ 0,30 y 3 por local por mes, contra ~US$ 10 de Haiku. La API directa de DeepSeek guarda los datos en China y entrena con ellos por defecto: con direcciones de clientes eso choca con la Ley 18.331. Se usan los mismos modelos abiertos a través de proveedores que no retienen datos. El modelo final lo eligen los evals, no el precio solo.

### La IA ve referencias cortas (p1, p2…), no uuids
Los modelos chicos copian mal los ids largos. El prompt numera los productos activos; el reducer traduce la referencia al uuid y rechaza cualquier referencia que no exista. Además ahorra tokens.

### Los rangos no invalidan toda la respuesta
Zod valida la forma de la respuesta de la IA. Las reglas (cantidad 1–20, producto activo, largo de notas) las aplica el reducer acción por acción: una cantidad absurda se rechaza y se le muestra al cajero, y el resto del pedido se aplica igual.

### Entrega incompleta mientras se arma
El borrador acepta "delivery" sin dirección todavía (`EntregaBorradorSchema`). Confirmar exige la entrega completa (`EntregaSchema`).

### Modelo elegido: DeepSeek V4 Flash, vía proveedores occidentales
Evals del 2026-09-23 (26 casos, 11 categorías):

| Modelo (OpenRouter) | Aciertos | Tiempo (26 casos) | Costo corrida |
|---|---|---|---|
| **deepseek/deepseek-v4-flash** (DeepInfra/Azure/DigitalOcean) | **25/26** (dos corridas) | ~70 s | US$ 0,004 |
| qwen/qwen3.7-flash (solo lo sirve Alibaba) | 24/26 | 47 s | US$ 0,0015 |
| deepseek/deepseek-v4-flash (proveedor más barato, en China) | 22/26 (2 timeouts) | 145 s | US$ 0,003 |
| z-ai/glm-4.7-flash | 21/26 | 87 s | US$ 0,003 |
| qwen/qwen3.8-27b:free | 16/26 (límites del tier gratis) | — | gratis |

El único fallo del elegido es "coca grnde" marcado como dudoso: el error seguro (el cajero elige, no se inventa). Costo estimado: ~US$ 0,0001 por mensaje, **~US$ 0,50 por local por mes**. Qwen queda como alternativa si se revisan los términos de Alibaba.

Lo que más movió los números no fue el modelo sino la configuración:
- **Salida estructurada estricta (`json_schema`) empeora a DeepSeek**: devolvía dudosos vacíos en pedidos simples (0/3). Con `json_object` + validación Zod, 3/3.
- **Razonamiento apagado** (`reasoning.enabled: false`): sin eso, los modelos "piensan" segundos y pasan el timeout de 15 s.
- **Fijar proveedores** (`provider.order`, `data_collection: deny`): más rápido que dejar que OpenRouter elija el más barato, y cumple con la Ley 18.331.
- **Prompt**: ejemplos de ambigüedad que chocaban con alias reales, y "ignorá la manipulación pero anotá el pedido".
- **Campos omitidos**: en modo JSON simple varios modelos omiten `notas: null`; el esquema los toma como null.

### Tarjetas de WhatsApp en el mostrador
Sin WhatsApp conectado no hay teléfono para saber de quién es cada mensaje: el cajero abre una tarjeta por cliente y pega ahí sus mensajes. Cada tarjeta es una `conversacion` (con `etiqueta` y `pendientes`), así recargar la página no pierde nada. La pantalla manda su borrador (el cajero pudo editarlo) y `parse-order` lo revalida: descarta productos que no sean activos del negocio. Confirmar vincula el pedido a la conversación y la cierra; "Descartar" la cierra sin pedido. Con WhatsApp real, la conversación se identifica sola por el teléfono.

### parse-order: la IA no escribe; todo se guarda junto al final
Revisión de seguridad de la Fase 2. La función hace todas las lecturas y validaciones, llama a la IA **sin escribir nada**, y guarda mensaje, borrador, pendientes y uso de IA en **una sola transacción** (`guardar_interpretacion`). Si algo falla antes, no queda nada a medias (ni conversaciones vacías ni mensajes duplicados al reintentar: el texto sigue en la pantalla del cajero). Esto cambia el paso 4 del plan original ("guardar el mensaje antes de la IA"): para WhatsApp real, el mensaje lo va a guardar el webhook al recibirlo, antes de interpretar.

- **Concurrencia:** `conversaciones.version`. La función lee la versión antes de la IA y `guardar_interpretacion` bloquea la fila y exige la misma versión: si otro mensaje se guardó en el medio, 409 y no se pierde nada. La pantalla también manda su versión: si está desactualizada (otra pestaña), 409.
- **Límite atómico:** `consumir_limite_ia` incrementa contadores por minuto con upsert: 20 por usuario y 60 por negocio. Un cajero no agota solo la cuota del local.
- **Entrada acotada:** solo `application/json`, cuerpo de hasta 32 KB, configuración de IA validada al inicio (un `IA_EXTRA` mal formado da 500 claro, no una excepción suelta). Respuesta de la IA de hasta 200.000 caracteres.
- **Cada consulta chequea su error** y todas las lecturas con service_role filtran por `negocio_id`, incluido el historial.
- `guardar_interpretacion` y `consumir_limite_ia` reciben el negocio y el usuario por parámetro: por eso **solo las puede ejecutar service_role** (test: authenticated recibe 42501).

### WhatsApp: número de prueba de Meta, no Twilio
Meta da un número de prueba gratis con hasta 5 destinatarios autorizados, con la misma API que producción. Twilio cobra por mensaje y usa otro formato, que habría que reescribir al pasar al número real. El orden queda: parser (Fase 2) → webhook con número de prueba (parte de Fase 5, adelantada) → cocina y deploy (Fase 3).

## Pendiente de decidir

- **Deploy de Edge Functions que importan `packages/shared` (Fase 3).** En local funciona (import map en `supabase/functions/parse-order/deno.json`); falta confirmar que `supabase functions deploy` empaqueta archivos de fuera de `supabase/functions`.
