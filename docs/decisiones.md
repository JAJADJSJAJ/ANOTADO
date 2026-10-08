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
Supabase da `ALL` (incluido `TRUNCATE`, que no pasa por RLS) a `anon` y `authenticated` sobre todo lo que se crea en `public`. La migración `permisos` saca todo y da solo lo que cada policy usa; `anon` no tiene nada (después se sumó solo `ping()`, ver más abajo). Los default privileges también se revocaron: **cada tabla o RPC nueva tiene que declarar sus GRANT** en su migración.

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
- **Ping diario** (GitHub Actions) para que el plan gratis no pause el proyecto. Al principio consultaba una tabla sin sesión y recibía 401: Supabase no lo contó como actividad y pausó el proyecto el 2026-09-29. Ahora llama a la RPC `ping()`, que devuelve `true` sin leer tablas, y el workflow falla si no recibe 200 con `true`. Es lo único que `anon` puede ejecutar (lo comprueba `ping.test.sql`).
- Registro de usuarios desactivado en la nube y Realtime solo con canales privados (configuración del dashboard).

## Fase 4

### Alta de locales con código del operador
Self-service, pero controlado: para crear un local hace falta un código de un solo uso que genera el operador (`crear_codigo_alta`, desde el SQL Editor, 12 caracteres sin 0/O ni 1/I, vence en 14 días por defecto). Se descartó el registro abierto con confirmación por mail (necesita SMTP y deja entrar a cualquiera) y el registro abierto sin confirmar (cualquiera podría registrar el mail de otro y dejarlo afuera). `crear_negocio(codigo, nombre)` crea negocio y primer dueño en una transacción, bloquea el código para que dos pestañas no creen dos locales, genera el slug (sin tildes, con `-2` si existe, y sin tapar rutas de la web como `/login`) y deja el local **sin IA**: el gasto lo sigue habilitando el operador. Los códigos se guardan hasheados (sha256).

### Las cuentas las crea una Edge Function, no el registro público
El registro de Supabase sigue apagado (en la nube y ahora también en local). `registro` es la única forma de crear una cuenta desde la web, y solo con un código de alta o una invitación vigentes. No pide sesión (`verify_jwt = false`) pero sí la publishable key. Códigos de 80 bits (16 caracteres; eran 12 = 60 bits, ver más abajo) y tokens de 256 no se adivinan; igual hay límite de solicitudes (abajo).
- **Mail verificado, contraseña después** (revisión de seguridad). La primera versión creaba la cuenta con el mail ya confirmado: con un link filtrado se podía ocupar el mail de otra persona. Ahora `registro` solo pide el mail y usa `inviteUserByEmail`: la cuenta nace sin confirmar y **sin contraseña**, y Supabase manda un mail. El link lleva a `/bienvenida`, donde quien abrió el mail elige su contraseña y vuelve a donde estaba (`siguiente`, solo rutas internas). Si la contraseña se eligiera antes de confirmar, alguien podría ocupar un mail ajeno con una contraseña que conoce y quedarse con la cuenta cuando el dueño real la confirmara. Si la cuenta existe sin confirmar, el mail se reenvía. Si ya está confirmada, la respuesta es la misma (201, "revisá tu mail") y al mail le llega un link para entrar sin contraseña (magic link) que lo deja donde iba: así no se revela qué mails tienen cuenta (revisión, tercera vuelta).
- **Cupos por reserva, resueltos contra la base** (revisión, dos vueltas). Primero el cupo se gastaba aunque la cuenta no se creara; después se devolvía ante cualquier error de Auth, pero Auth puede fallar *después* de crear la cuenta (el hook `triggerAfterUserCreated` corre después del commit). Ahora cada intento es una reserva con id (`reservas_registro`): al reservar se anota el hash del mail y si ya había cuenta; al final, `resolver_reserva` la marca `creada` solo si antes no había cuenta y ahora sí, y si no, `liberada`. No depende del error ni de relojes. Si la resolución no llega (corte), la reserva queda tomada: ante la duda se gasta. Máximo 3 reservas no liberadas (cuentas) y 10 en total (intentos, cada uno manda un mail).
- **Límite de solicitudes** (revisión): 5 por minuto por IP (guardada como hash, porque es un dato personal) y 60 por minuto en total, contadas antes de mirar el código, así que también cuentan los códigos inválidos. La IP de los headers se puede falsear: el tope total es el techo real. Si alguien lo satura, el alta queda frenada un minuto para todos; a esta escala se acepta.
- **Origen del link:** en la nube, `SITIO_URL` es obligatorio. Sin él la función no da altas (503): falla cerrado. El `Origin` de la solicitud solo se acepta si es localhost.
- **Códigos de 80 bits** (revisión, tercera vuelta): pasaron de 12 a 16 caracteres. Adivinar 60 bits en línea ya era inviable, pero si se filtrara `codigos_alta`, con el sha256 se podrían probar candidatos fuera de línea mientras el código siga vigente; con 80 bits, no.
- La función no crea el local ni acepta la invitación: eso lo hace la web con sesión (`crear_negocio`, `aceptar_invitacion`), que es la que consume el código. Mientras la persona va y vuelve del mail, el nombre del local se recuerda en el navegador.
- Con SMTP también hay "Me olvidé la contraseña" (misma pantalla `/bienvenida`), con el mismo mensaje exista o no la cuenta.
- SMTP propio en la nube (el de Supabase solo manda a los mails del equipo del proyecto). Plantillas en español en `supabase/templates/`.

### Equipo: bloquear primero, comprobar después (revisión)
`preparar_cambio_equipo` y `crear_invitacion` comprobaban que quien llama fuera dueño antes de bloquear el negocio: si otra transacción le sacaba el rol mientras esperaba, seguía con un permiso vencido (y podía volver a nombrarse dueño). Ahora bloquean y comprueban después; en read committed cada sentencia ve lo que la otra ya confirmó. Se mantiene un chequeo previo para que alguien ajeno no pueda bloquear la fila de un negocio. Reproducido con dos sesiones en paralelo: la segunda pasa el primer chequeo, espera el bloqueo y la frena el segundo. El mismo bloqueo hace exacto el tope de 20 invitaciones sin usar. `crear_negocio` reintenta el slug si otra alta con el mismo nombre ganó la carrera.

### Invitaciones por link de WhatsApp
El dueño elige el rol y recibe un link `/invitacion/<token>` de un solo uso que vence en 48 h; lo comparte por WhatsApp, que es donde ya está su equipo. El token (32 bytes) se muestra una sola vez y se guarda hasheado: si se pierde, se anula y se crea otro. Hasta 20 invitaciones sin usar por local. Quien abre el link crea su cuenta o entra con la que tiene, ve el local y el rol, y acepta. Un miembro no puede cambiar su propio rol aceptando otro link (eso lo hace el dueño).

### El local nunca queda sin dueño
`cambiar_rol` y `quitar_miembro` bloquean la fila del negocio antes de contar dueños: dos cambios simultáneos no pueden sacar a los dos últimos a la vez. El dueño ve el equipo con mails por `miembros_negocio` (auth.users no se lee desde la web, y los mails son datos personales: solo el dueño). Quitar a alguien le corta el acceso en la siguiente consulta, porque RLS mira `miembros` cada vez.

### Horarios: avisan, no bloquean
`negocios.horarios` ya existía; ahora lo edita el dueño en *Ajustes* y la base valida la forma (`horarios_validos`, igual que los alias). Un turno cuyo cierre es menor o igual a la apertura termina al día siguiente (19:00–01:30; 20:00–00:00). `estadoHorario` en `shared` calcula abierto/cerrado en la zona horaria del local, incluido el turno del día anterior que cruza medianoche, y el mostrador lo muestra. **No bloquea pedidos**: el cajero puede tomar un encargue antes de abrir. Bloquear o responder "estamos cerrados" queda para el bot (Fase 5/6).

### Agotados: cualquiera del local, solo esa columna
Quien se entera de que algo se terminó suele ser la cocina o el cajero. `marcar_agotado` deja a los tres roles cambiar **solo** `productos.activo`; nombre, precio y alias siguen siendo del dueño por RLS. Panel rápido en el mostrador (pestaña *Agotados*) y en la cocina. No se separó "agotado" de "dado de baja": los dos son `activo = false`, así que un cajero puede volver a habilitar algo que el dueño sacó del menú. Se acepta por ahora, y la pantalla de agotados lo dice. El mostrador no se entera al instante de un agotado marcado en otra pantalla: si lo agrega, confirmar falla con "agotado" y el menú se recarga.

### Zonas de envío con costo, calculado en la base
Tabla `zonas_envio` (nombre, costo, activa), con FK compuesta desde `pedidos`. El cajero elige la zona en un delivery y `confirmar_pedido` suma el costo leído de la base: igual que los precios, nunca viene del navegador ni de la IA. El pedido guarda `zona_id`, `envio_centavos` y el nombre de la zona en `entrega.zona` (snapshot); borrar o cambiar la zona no altera pedidos viejos. `total_centavos` = items + envío. Si el local tiene zonas activas, **todo delivery necesita zona** (que no se olvide cobrar el envío); un local sin zonas sigue igual. La IA no elige zonas: sin geocodificación, "por la terminal" lo resuelve una persona. Cocina no ve zonas.

## Panel del operador

### Administra locales, no lo que pasa adentro
`/operador` reemplaza el SQL a mano del operador: códigos de alta (generar, mandar por WhatsApp, anular), IA por local (`ia_permitida`) y suspender o reactivar locales. De cada local muestra solo números (personas, pedidos e IA de los últimos 30 días); nunca pedidos, productos, clientes ni conversaciones. Si roban la cuenta del operador, no se filtran datos de clientes. Va dentro de la misma app y no como página aparte: un solo login, una sola base de reglas y el mismo CI.

### Operador = tabla + segundo factor, verificados por la base
Quién es operador lo dice la tabla `operadores`, que la web no puede escribir (el primero se carga una vez con SQL). Cada función del panel exige además, en el JWT, `aal2` **y** `amr` con `totp`: que en esta sesión se haya verificado el código de 6 dígitos de la app del celular. `aal2` solo dice "algún segundo factor"; si algún día se habilita otro (SMS, llaves), no sirve para el panel sin cambiarlo a propósito (revisión). Ningún *Custom Access Token Hook* debe estar configurado: podría escribir esas claims (checklist de deploy). Con solo la contraseña, el panel no responde. Se descartó "una clave del panel": sería la llave de todo, sin forma de saber quién la usa ni de cortarla rápido. Cada acción queda en `registro_operador`.

### Suspender: un solo lugar
`negocios.activo` ya existía y la web nunca lo pudo editar. `es_miembro` y `tiene_rol` ahora exigen local activo, y como todas las policies y RPC del local pasan por ellas, la suspensión corta todo de una vez (pantallas, RPC, Realtime, `parse-order`). `mis_locales_suspendidos()` le dice a su gente por qué no entra. Lo que leía la membresía directo eran las invitaciones: ahora las de un local suspendido no se ven, no se aceptan y no sirven para crear cuentas. Al aceptar, se bloquea la fila del local con `for share` (choca con el update de la suspensión) y se vuelve a mirar `activo`: una aceptación y una suspensión simultáneas no pueden sumar a alguien a un local ya suspendido (revisión; reproducido con dos sesiones). Una tablet de cocina ya suscripta a Realtime puede seguir conectada hasta renovar el token, pero no recibe nada: en un local suspendido no se puede crear ni mover pedidos, y la lista se lee por una RPC que ya lo rechaza.

## Fase 5

### Webhook: guardar primero, contestar 200, interpretar después
`whatsapp-webhook` no pide sesión (la llama Meta): se autentica con la firma `X-Hub-Signature-256`, un HMAC-SHA256 del cuerpo **crudo** con el App Secret, comparado en tiempo constante. Sin firma válida, 401 sin leer nada; sin `WA_APP_SECRET`, 503 (falla cerrado). Cada mensaje se guarda con `recibir_mensaje_wa` **antes** de contestar: si la base falla, 500 y Meta reintenta. La IA corre después con `EdgeRuntime.waitUntil`, así Meta no espera una IA lenta ni reintenta por eso. Si la IA no corre (apagada, límite, falla), los mensajes igual aparecen en el mostrador. Esta fase no usa el token de acceso de Meta (solo recibe), así que los únicos secrets nuevos son `WA_APP_SECRET` y `WA_VERIFY_TOKEN`.

### Dedupe y orden por cliente
`mensajes.wa_message_id` ya era único. `recibir_mensaje_wa` hace upsert del cliente (`negocio_id`, `telefono`), que **bloquea su fila**: dos mensajes simultáneos del mismo cliente se guardan de a uno y no abren dos conversaciones; un reintento de Meta en paralelo vuelve a mirar el `wa_message_id` con el cliente bloqueado. Reproducido con dos sesiones en paralelo. El local sale del `phone_number_id` que recibió el mensaje; un número sin local o un local suspendido se descarta con 200. El nombre del perfil de WhatsApp no pisa el que haya cargado el local.

### Cuándo empieza otra conversación
Al confirmar o descartar, como antes. Además, si la conversación abierta lleva **30 minutos** sin mensajes, el siguiente abre una nueva (el plan decía 3 h; es mucho: el cliente que vuelve a la noche es otro pedido). Excepción: si tiene un pedido armado sin confirmar, aguanta hasta 3 h, porque cerrarla lo haría desaparecer del mostrador. Se resuelve al recibir el mensaje, sin cron.

### La IA interpreta ráfagas, con un turno por conversación
Los clientes escriben de a pedacitos ("hola" / "2 completas" / "a Blandengues 450"). El intérprete (`_shared/interpretar-whatsapp.ts`) toma un **turno** (`conversaciones.interpretando_hasta`, vence solo a los 90 s si el proceso muere), espera 2,5 s y junta todos los mensajes sin interpretar en una sola llamada. `guardar_interpretacion_wa` marca como interpretados **solo** los que leyó la IA: uno que llegó mientras tanto queda para la vuelta siguiente, y al soltar el turno se vuelve a mirar (nadie más lo habría tomado). El turno no hace falta para la integridad (eso lo da la versión), sino para no pagar dos veces lo mismo. Probado: tres mensajes seguidos, una llamada.

### Audios, fotos y ubicaciones: marcados, no interpretados
Se guardan como `[Audio]`, `[Foto] <texto>`, `[Ubicación] … <link al mapa>` con su `tipo`, y la tarjeta los marca en amarillo. La IA no los interpreta pero los ve como contexto. Escucharlos o verlos necesita el token de Meta, Storage y (para audios) transcripción paga: queda para después. Ojo: con la Cloud API el número no está en un celular, así que hoy el cajero no puede escuchar un audio en otro lado ni contestarle al cliente (eso es Fase 6). Las reacciones y avisos del sistema no se guardan.

### Lo que edita el cajero se guarda solo
Antes las ediciones quedaban en la pantalla hasta confirmar; con mensajes que llegan solos, la IA pisaría lo corregido. `guardar_borrador` (dueño o cajero, con versión) guarda a los 800 ms de dejar de tocar. La IA siempre parte del borrador guardado: si el cajero editó mientras interpretaba, `guardar_interpretacion_wa` da 40001 y el intérprete vuelve a empezar sobre lo nuevo. Si la IA ganó, la pantalla recibe 40001, adopta lo del servidor y avisa "revisá tu último cambio". La zona y las notas no se guardan (no van al borrador). Valida forma, largos y que los productos sean del negocio (`exigir_borrador_valido`); activos lo exige recién `confirmar_pedido`.

### Confirmar con lo que se ve en pantalla
`confirmar_conversacion` exige la versión del borrador **y** el último mensaje que muestra la pantalla (no la cantidad: la pantalla carga con tope, y si cortara se cortan los viejos): si hay uno posterior, por ejemplo el cliente mandó "agregame una coca" justo cuando el cajero tocaba Confirmar, no se confirma y la tarjeta se actualiza. Por dentro llama a `confirmar_pedido` en la misma transacción (rol, productos activos, total recalculado, zona, cierre).

### Límites de IA para WhatsApp
Además del límite por negocio (60 por minuto, compartido con `parse-order`), 10 por minuto **por cliente**: alguien que manda spam no gasta la cuota del local. Pasado el límite, el mensaje queda sin interpretar y el cajero puede tocar "Interpretar" (cuenta como un intento suyo).

### Realtime de conversaciones solo para dueño y cajero
Canal privado `negocio:<id>:conversaciones`, con policy que exige `tiene_rol(dueno, cajero)`: cocina no se entera de conversaciones. El aviso lleva solo `conversacion_id`; la pantalla relee por RLS, con las mismas recargas de seguridad que la cocina (reconexión, volver a la pestaña, cada 30 s). Tomar o soltar el turno de la IA no avisa.

### Orden de llegada, no hora (revisión)
Confirmar comparaba contra la **hora** del último mensaje visto. El revisor marcó los empates, pero había algo peor. `created_at` es la hora en que **empieza** la transacción, así que un mensaje que esperó el bloqueo del cliente quedaba con una hora *anterior* a otro guardado antes que él. Si la pantalla leía en el medio, confirmar no lo veía. Reproducido con dos sesiones: "y una coca" se guardó después de "2 completas" con una hora anterior, y la confirmación pasó. Ahora `mensajes.orden` (identity) se toma al insertar. Como los mensajes de una conversación se insertan de a uno (bloqueo del cliente en el webhook, de la conversación en `guardar_interpretacion`), el orden sigue al real y no hay empates. Confirmar, el intérprete y la pantalla ordenan por `orden`. Repetida la carrera: confirmar la frena.

### Solo se marcan mensajes pendientes de esa conversación (revisión)
`guardar_interpretacion_wa` exige que **todos** los ids recibidos sean mensajes de texto del cliente, de esa conversación y todavía sin interpretar. Si alguno no cumple, 22023 y no marca nada. Antes ignoraba en silencio los que no correspondían. Hay tests de permisos declarados: las funciones del webhook, solo `service_role`; las del mostrador, `authenticated` (y después validan el rol); `anon`, ninguna.

### Límite de recepción (revisión, segunda y tercera vuelta, hechas por Codex)
Cualquiera puede escribirle al número del local, y cada mensaje es una fila: sin límite, alguien podía llenar la base. `recibir_mensaje_wa` cuenta por minuto en `limites_ia` (claves `recibir:…`):
- **Por número del local, 300.** Se cuenta **antes** de crear el cliente, así miles de teléfonos distintos no inflan `clientes`. Pasado el tope **no se descarta**: error `AN429`, el webhook responde 503 y Meta reintenta más tarde. Lo ya guardado no se duplica, y como el error deshace la transacción, los rechazados no suman. Así, alguien que satura el tope no hace perder mensajes legítimos (tercera vuelta).
- **Por cliente, 20.** Pasado el tope, el mensaje no se guarda y Meta recibe 200: afecta solo a quien manda de más. Un cliente real no manda 20 mensajes por minuto.

Los reintentos de Meta no cuentan: salen antes, por el dedupe. Dos entregas simultáneas del mismo mensaje tampoco suman: un bloqueo por `wa_message_id` las hace pasar de a una (cuarta vuelta).

**Riesgo aceptado (quinta vuelta):** unos 15 números de WhatsApp reales y coordinados, mandando 20 por minuto cada uno, agotan el tope del local y **demoran** (no pierden: Meta reintenta) los mensajes de los demás hasta el minuto siguiente. Las alternativas son peores: sin tope global vuelve el problema de llenar `clientes`, y no hay forma de reservar cupo "para legítimos" sin distinguir a un cliente nuevo de uno falso. Si pasa, queda en los logs del webhook. **Pendiente de decidir:** retención (borrar mensajes de conversaciones cerradas después de N días; el pedido conserva su copia en `mensaje_original`).

### El operador conecta el número
`negocios.wa_phone_number_id` ya existía y no está en el GRANT de update: lo carga el operador desde el panel (`operador_conectar_whatsapp`, con TOTP y registro). El phone number ID no es secreto; la firma del webhook es la que autentica.

## Fase 6: el bot responde, y la demo pública

### El bot contesta con plantillas, no con la IA
Lo que le llega al cliente se arma con el borrador (`shared/bot.ts`), que ya está validado contra el menú: qué se anotó, la entrega y lo que falta. La IA nunca escribe texto libre para el cliente. Así no puede inventar precios, promociones ni prometer nada, aunque alguien intente manipularla desde el chat. La excepción son las preguntas de aclaración ("¿la coca es de 1,5 o de 2,25?"): pasan por un filtro estricto (cortas, terminan en "?", sin plata, links, pagos, pedidos de datos personales ni números largos) y si no lo pasan se reemplazan por una genérica. Lo que el bot cita del cliente (notas, dirección, lo que no quedó claro) pasa por el mismo filtro: si no lo pasa, no se repite (revisión). Las preguntas de la IA tampoco pueden pedir datos de contacto ni de ubicación (número, dirección, barrio, calle, dónde…): la dirección la pide la plantilla. Es una lista de palabras, de mejor esfuerzo. Tras cuatro vueltas de Codex, lo que puede escaparse es que la IA le pregunte un dato al **mismo** cliente en su chat, que puede no contestar. Se cerró ahí. El total lo manda la base al confirmar, nunca el bot.

### Cuándo contesta
- **Después de interpretar**, solo si cambió algo o hay algo que aclarar: un "gracias" no se contesta. La respuesta se guarda en la misma transacción que la interpretación: un reintento por versión no la duplica.
- **Al confirmar**: número y total (con envío).
- **Retiro**: cuando está listo. **Delivery**: cuando sale (entregado al cadete). **Cancelado**: sin el motivo, que es interno.
Los avisos de estado salen una sola vez por pedido (`mensajes.clave`): deshacer y volver a avanzar no los repite. Las preguntas que ya hizo el bot no quedan como tarea del cajero ("Preguntale al cliente"); los dudosos sí, porque los resuelve el cajero.

### Mandarlo por WhatsApp de verdad queda pendiente
Las respuestas son mensajes con rol `asistente`. Falta el paso que las manda por la Cloud API de Meta (necesita el token de la app y la ventana de 24 h). Nunca se mandan las de un local de demo.

### La demo: un local compartido, cuentas que crea el servidor
`/demo` abre la pantalla del simulador (el teléfono del cliente, el mostrador y la cocina) sin registrarse. Decisión de Fran: un local compartido, no uno por visitante. Los visitantes ven lo de los demás; la pantalla lo avisa.
- **No es login anónimo de Supabase**: con el registro público apagado, Auth también lo bloquea (probado), y prenderlo dejaría crear cuentas con cualquier mail. La Edge Function `demo-entrar` crea la cuenta con la API de administración (mail inventado en `.invalid`, `app_metadata.demo`), la suma como cajero y devuelve un token de un solo uso, sin mandar mails.
- **Límites**: 3 cuentas por minuto por IP, 30 en total y hasta 500 vivas. 300 interpretaciones de IA y 3000 mensajes por día en la demo, más los límites por minuto de siempre. Encima, la key de OpenRouter tiene un tope de US$ 3 por mes.
- **Encierro**: una cuenta de demo solo puede ser miembro de locales de demo (no acepta invitaciones ni crea locales) y no cambia su mail. En la demo, el cajero también mueve la cocina: si no, una sola persona no puede hacer todo el recorrido.
- **Limpieza**: todas las noches (pg_cron, 5:00 de Uruguay) se borran los pedidos, chats y clientes de la demo, se vuelve a ofrecer lo agotado y se borran las cuentas de demo de más de un día (solo las marcadas por `demo-entrar`). Lo agotado además vuelve cada hora: si un visitante marca todo agotado, el siguiente no espera a la noche.
- **Topes diarios no atómicos (aceptado, revisión)**: se cuenta y después se registra el uso, en transacciones distintas. Varios pedidos simultáneos justo en el límite lo pueden pasar por unos pocos. Lo acotan los límites por minuto (60 interpretaciones por minuto por local) y el tope de la key.
- **Simulador**: el mensaje entra por `recibir_mensaje_wa` y el mismo intérprete que el webhook. No hay un camino aparte para la demo. Cada visitante es siempre el mismo cliente, con un teléfono de mentira que empieza con 00.

### Riesgo aceptado: el mail de cambio de mail
Una cuenta de demo puede pedir cambiar su mail. La base no deja que el cambio se complete, pero Auth manda el mail de confirmación **antes** de escribir en la base (probado). Alguien podría usar la demo para que el SMTP del proyecto le mande ese mail a terceros. Lo acotan: Auth deja un pedido por minuto por cuenta, el límite de cuentas de demo y el tope de mails por hora del proyecto. La solución de fondo es un *Send Email Hook* que filtre las cuentas de demo, pero obliga a mandar todos los mails desde una función propia. Queda para si alguna vez pasa.

## Pendiente de decidir

- **Clave de idempotencia para tarjetas nuevas de WhatsApp** (Fase 2). No bloquea.
