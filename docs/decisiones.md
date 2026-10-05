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
Desde la web `miembros` es solo lectura (el encabezado de `rls.sql` todavía dice que la web escribe "equipo": quedó desactualizado por `permisos.sql`, que borra esa policy). Con `ALL` para el dueño, podía nombrar dueños, sacar a otros dueños o dejar al negocio sin dueño. Invitar/cambiar roles y crear un negocio con su primer dueño (atómico, validando identidad) van por RPC en Fase 4. Hoy nadie puede crear negocios desde la web: no hay policy ni GRANT de insert. (Resuelto en Fase 4: ver más abajo.)

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
- **Límite atómico:** `consumir_limite_ia` incrementa contadores por minuto con upsert: 20 por usuario y 60 por negocio. Un cajero no agota solo la cuota del local. Cuenta **intentos**, no interpretaciones exitosas: a propósito, porque un intento fallido también le cuesta al proveedor.
- **Versión obligatoria** al mandar un mensaje a una tarjeta existente (400 si falta): control optimista completo, también contra pantallas viejas.
- **Defensa en la base:** `guardar_interpretacion` rechaza borradores con productos de otro negocio aunque la función ya los filtre.
- **Textos de la IA acotados:** dudosos y preguntas se recortan a 300 caracteres en el reducer. Los errores del proveedor se loguean solo con el código HTTP (su cuerpo podría repetir parte del prompt).
- `listo_para_confirmar` es solo una sugerencia para la pantalla: nunca confirma nada.
- **Productos que se agotan en el medio:** `guardar_interpretacion` exige productos activos pero no bloquea sus filas. No hace falta: el borrador es solo una propuesta, y `confirmar_pedido` vuelve a exigir productos activos dentro de su propia transacción al confirmar.
- **Costo de los reintentos:** un reintento de la IA puede duplicar el costo de esa llamada sin sumar al límite (máximo 2 llamadas por solicitud). Se acepta: son ~US$ 0,0001 cada una.
- **Respuesta perdida al crear una tarjeta:** si la conversación nueva se guardó pero la respuesta no llegó al navegador, reintentar crea otra conversación con el mismo mensaje. Es raro y se ve (dos tarjetas, una se descarta). Si molesta, se resuelve con una clave de idempotencia por tarjeta. Pendiente, no bloqueante.
- **Validaciones de datos del dueño:** hora de corte menor a 24:00 (Postgres acepta 24:00 y correría los pedidos al día anterior), zona horaria existente (con una inválida no se podrían crear pedidos), y largos máximos de nombres y alias del menú, que van al prompt de la IA.
- **Entrada acotada:** solo `application/json`, cuerpo de hasta 32 KB, configuración de IA validada al inicio (un `IA_EXTRA` mal formado da 500 claro, no una excepción suelta). Respuesta de la IA de hasta 200.000 caracteres.
- **Cada consulta chequea su error** y todas las lecturas con service_role filtran por `negocio_id`, incluido el historial.
- `guardar_interpretacion` y `consumir_limite_ia` reciben el negocio y el usuario por parámetro: por eso **solo las puede ejecutar service_role** (test: authenticated recibe 42501).

### WhatsApp: número de prueba de Meta, no Twilio
Meta da un número de prueba gratis con hasta 5 destinatarios autorizados, con la misma API que producción. Twilio cobra por mensaje y usa otro formato, que habría que reescribir al pasar al número real. El orden queda: parser (Fase 2) → webhook con número de prueba (parte de Fase 5, adelantada) → cocina y deploy (Fase 3).

## Fase 3

### Cocina lee por una RPC, no por la tabla
Resuelve lo pendiente de la Fase 0: RLS filtra filas, no columnas, y cocina veía la dirección de delivery y el mensaje original. Ahora `pedidos` y `pedido_items` solo los leen dueño y cajero; cocina usa `pedidos_cocina(negocio_id)`, que devuelve número, estado, modo de entrega, mesa, notas e items. No incluye dirección, teléfono, mensaje original ni precios. También devuelve la hora del servidor, para que el temporizador no dependa del reloj de la tablet.

### Realtime por Broadcast, con aviso mínimo
El plan decía suscribirse a los cambios de `pedidos`, pero `postgres_changes` manda la fila completa (con la dirección) y escala peor. Un trigger manda por Broadcast al canal privado `negocio:<id>:pedidos` solo `{pedido_id, estado}`, y la pantalla recarga por la RPC. Solo avisa al crear el pedido y cuando el estado cambia de verdad: un update al mismo estado no manda nada. Una policy en `realtime.messages` deja suscribirse solo a los miembros del negocio. No hay policy de insert: nadie manda avisos desde el navegador. `realtime.send` loguea y sigue si falla, así que un problema de Realtime no impide crear ni mover pedidos.

### Nunca perder un pedido: la lista siempre sale de la base
El aviso solo dice "algo cambió". La lista completa se recarga al suscribirse (también en cada reconexión), al volver internet, al volver a la pestaña y cada 30 s. Lo último es por las tablets que se duermen y dejan el websocket muerto sin avisar. Probado: un pedido creado con la red cortada aparece al volver.

### avanzar_estado recibe el estado que se ve en pantalla
El plan decía `avanzar_estado(pedido_id)`. Con eso, un doble toque o un reintento después de un corte saltean un paso. `avanzar_estado(pedido_id, desde)` solo mueve si el pedido sigue en `desde`; si no, no hace nada y devuelve el estado real con `cambiado = false`. Un pedido de otro negocio o inexistente da el mismo error (`P0002`), para no revelar qué ids existen.

### Cada rol mueve lo de su área
Cocina pasa de pendiente a en cocina y de en cocina a listo. El mostrador (cajero) marca listo → entregado. El dueño puede todo. Deshacer (`retroceder_estado`) lo puede quien pudo hacer el paso, y en pantalla se ofrece durante 10 s: sirve para corregir un toque equivocado. Las reglas están espejadas en `shared/src/cocina.ts`, solo para UX.

### Cancelar: desde el mostrador, con motivo y sin deshacer
Cajero o dueño cancelan un pedido que no se entregó (`cancelar_pedido`), con motivo opcional y quién canceló. Cocina no cancela. Un cancelado no se revive. Si ya se cobró, la devolución se hace por fuera de la app: Anotado no maneja plata. En la tablet, el cancelado sale al instante y queda una franja roja hasta que alguien toca "Entendido".

### IA por local con dos llaves
`ia_permitida` la cambia solo el operador de Anotado: no está en el GRANT de update, así que nadie la toca desde la web. `ia_activa` la prende o apaga el dueño. `parse-order` chequea las dos antes del límite y de la IA, así que con alguna apagada no se gasta nada. Un negocio nuevo arranca sin IA. Para cortar la IA de todos los locales a la vez se revoca la key en OpenRouter. Hoy se opera con SQL desde el dashboard; un panel del operador vendría después.

### Temporizador configurable por el dueño, para todo el local
Minutos para amarillo y rojo (10 y 20 por defecto) en `negocios.config.cocina`, desde *Ajustes*. Sin migración: `config` ya existía y el dueño ya podía editarla. Como es jsonb libre, se lee siempre con Zod: si falta o está mal, se usan los valores por defecto.

### Tablet: arranque con un toque
Los navegadores bloquean el audio y la pantalla completa hasta un gesto del usuario, por eso la cocina arranca con "Empezar". El sonido se genera con Web Audio (sin archivos): uno para pedido nuevo y otro, distinto, para cancelado. Se usa Wake Lock y se vuelve a pedir al volver a la pestaña. Si la tablet no lo soporta, se avisa que hay que configurarla para que no se apague.

### Deploy
- **Vercel** con `apps/web` como raíz. `vercel.json` redirige las rutas al SPA y pone una CSP que solo permite conectarse a `*.supabase.co`, probada con el build.
- **Edge Function con `@supabase/server`**: exige las claves de firma JWT nuevas (asimétricas) del proyecto y rechaza los tokens HS256 viejos. Queda como paso a chequear en `docs/deploy.md`.
- **El seed no sube a la nube.** El local de demo se crea con `supabase/demo/negocio-demo.sql`, con usuarios creados a mano y contraseñas propias.
- **Sin usuario público en la demo**, para no dejar abierto el gasto de IA. Se da acceso a mano.
- **Edge Functions con `packages/shared`: resuelto.** `functions deploy` empaqueta con Docker siguiendo el import map, y `shared` va adentro (1,7 MB). Verificado en la nube con `scripts/verificar-parse-order.mjs`, con sesiones reales: la función responde con sus propios mensajes, cocina recibe 403 y con la IA apagada no se registra uso.
- **Verificado en la nube** (2026-09-24): un pedido confirmado en la compu aparece solo en el celular que hace de tablet; con modo avión aparece "Sin conexión" y el pedido creado durante el corte llega al volver; cancelar desde el mostrador llega a cocina; apagar la IA desde Ajustes y por `ia_permitida` funciona; la IA interpreta un pedido real.
- **Ping diario** (GitHub Actions) para que el plan gratis no pause el proyecto.
- Registro de usuarios desactivado en la nube y Realtime solo con canales privados (configuración del dashboard).

## Fase 4

### Alta de locales con código del operador
Self-service, pero controlado: para crear un local hace falta un código de un solo uso que genera el operador (`crear_codigo_alta`, desde el SQL Editor, 12 caracteres sin 0/O ni 1/I, vence en 14 días por defecto). Se descartó el registro abierto con confirmación por mail (necesita SMTP y deja entrar a cualquiera) y el registro abierto sin confirmar (cualquiera podría registrar el mail de otro y dejarlo afuera). `crear_negocio(codigo, nombre)` crea negocio y primer dueño en una transacción, bloquea el código para que dos pestañas no creen dos locales, genera el slug (sin tildes, con `-2` si existe, y sin tapar rutas de la web como `/login`) y deja el local **sin IA**: el gasto lo sigue habilitando el operador. Los códigos se guardan hasheados (sha256).

### Las cuentas las crea una Edge Function, no el registro público
El registro de Supabase sigue apagado (en la nube y ahora también en local). `registro` es la única forma de crear una cuenta desde la web, y solo con un código de alta o una invitación vigentes. No pide sesión (`verify_jwt = false`) pero sí la publishable key. Antes de crear la cuenta llama a `registro_permitido`, que suma uno al contador del código o la invitación: **máximo 3 cuentas** por cada uno, para que un link filtrado no sirva para crear cuentas en serie. No hace falta límite por IP: códigos de 60 bits y tokens de 256 no se adivinan.
- La cuenta nace con el mail confirmado: sin SMTP no hay cómo verificarlo. Se acepta porque solo llega quien tiene un código o una invitación.
- La función no crea el local ni acepta la invitación: eso lo hace la web con la sesión nueva (`crear_negocio`, `aceptar_invitacion`), que es la que consume el código. Si algo falla en el medio, queda una cuenta sin local, que puede reintentar.
- Sin SMTP tampoco hay "olvidé mi contraseña": la resetea el operador desde el dashboard.

### Invitaciones por link de WhatsApp
El dueño elige el rol y recibe un link `/invitacion/<token>` de un solo uso que vence en 48 h; lo comparte por WhatsApp, que es donde ya está su equipo. El token (32 bytes) se muestra una sola vez y se guarda hasheado: si se pierde, se anula y se crea otro. Hasta 20 invitaciones sin usar por local. Quien abre el link crea su cuenta o entra con la que tiene, ve el local y el rol, y acepta. Un miembro no puede cambiar su propio rol aceptando otro link (eso lo hace el dueño).

### El local nunca queda sin dueño
`cambiar_rol` y `quitar_miembro` bloquean la fila del negocio antes de contar dueños: dos cambios simultáneos no pueden sacar a los dos últimos a la vez. El dueño ve el equipo con mails por `miembros_negocio` (auth.users no se lee desde la web, y los mails son datos personales: solo el dueño). Quitar a alguien le corta el acceso en la siguiente consulta, porque RLS mira `miembros` cada vez.

### Horarios: avisan, no bloquean
`negocios.horarios` ya existía; ahora lo edita el dueño en *Ajustes* y la base valida la forma (`horarios_validos`, igual que los alias). Un turno cuyo cierre es menor o igual a la apertura termina al día siguiente (19:00–01:30; 20:00–00:00). `estadoHorario` en `shared` calcula abierto/cerrado en la zona horaria del local, incluido el turno del día anterior que cruza medianoche, y el mostrador lo muestra. **No bloquea pedidos**: el cajero puede tomar un encargue antes de abrir. Bloquear o responder "estamos cerrados" queda para el bot (Fase 5/6).

### Agotados: cualquiera del local, solo esa columna
Quien se entera de que algo se terminó suele ser la cocina o el cajero. `marcar_agotado` deja a los tres roles cambiar **solo** `productos.activo`; nombre, precio y alias siguen siendo del dueño por RLS. Panel rápido en el mostrador (pestaña *Agotados*) y en la cocina. No se separó "agotado" de "dado de baja": los dos son `activo = false`, así que un cajero puede volver a habilitar algo que el dueño sacó del menú. Se acepta por ahora. El mostrador no se entera al instante de un agotado marcado en otra pantalla: si lo agrega, confirmar falla con "agotado" y el menú se recarga.

### Zonas de envío con costo, calculado en la base
Tabla `zonas_envio` (nombre, costo, activa), con FK compuesta desde `pedidos`. El cajero elige la zona en un delivery y `confirmar_pedido` suma el costo leído de la base: igual que los precios, nunca viene del navegador ni de la IA. El pedido guarda `zona_id`, `envio_centavos` y el nombre de la zona en `entrega.zona` (snapshot); borrar o cambiar la zona no altera pedidos viejos. `total_centavos` = items + envío. Si el local tiene zonas activas, **todo delivery necesita zona** (que no se olvide cobrar el envío); un local sin zonas sigue igual. La IA no elige zonas: sin geocodificación, "por la terminal" lo resuelve una persona. Cocina no ve zonas.

## Pendiente de decidir

- **Clave de idempotencia para tarjetas nuevas de WhatsApp** (Fase 2). No bloquea.
