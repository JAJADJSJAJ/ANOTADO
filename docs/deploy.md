# Deploy

Web en Vercel, base y Edge Function en Supabase cloud. Las cuentas y las claves las crea y
carga el operador; ninguna clave va al repo ni al chat.

## 1. Supabase

1. **Crear el proyecto** en [supabase.com](https://supabase.com/dashboard), región
   **South America (São Paulo)**. Guardá la contraseña de la base en tu gestor de contraseñas.
2. **Claves de firma JWT nuevas.** En *Project Settings → JWT Keys* la clave en uso tiene que
   ser asimétrica (ECC P-256 o RSA), no *Legacy JWT secret*. `parse-order` usa
   `@supabase/server`, que rechaza los tokens HS256 viejos. Si figura la legacy, usá
   *Rotate keys* para pasar a la nueva.
3. **Vincular y subir las migraciones** (desde la raíz del repo, en tu compu):

   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <ref>     # el ref está en la URL del dashboard
   pnpm supabase db push                     # aplica supabase/migrations (el seed NO se sube)
   ```

   - Antes de cada comando contra la nube, `pnpm supabase projects list` tiene que marcar
     tu proyecto como vinculado (●).
   - **Nunca `db push --include-seed`**: el seed es de desarrollo (usuarios con
     `anotado123`).

4. **Secrets de la IA.** Creá en OpenRouter una key **nueva para producción, con límite de
   crédito** (*Keys → Create key → Credit limit*). Revisá el saldo antes. Copiá
   `supabase/functions/.env.example` a `supabase/functions/.env.nube` (ignorado por git),
   completá `IA_API_KEY` y:

   ```bash
   pnpm supabase secrets set --env-file supabase/functions/.env.nube
   pnpm supabase secrets list      # tienen que aparecer IA_BASE_URL, IA_API_KEY, IA_MODELO…
   ```

   Los secrets **no viajan con la función**: `functions deploy` no lee ningún `.env`. Si
   cambiás la key, se vuelve a correr `secrets set`.

5. **Edge Functions:**

   ```bash
   pnpm supabase functions deploy parse-order
   pnpm supabase functions deploy registro
   ```

   En la salida tienen que aparecer archivos de `packages/shared/src/` entre los subidos.
   La verificación de `parse-order` va después de crear los usuarios (paso 9): un `curl` sin
   sesión no sirve, porque el 401 lo da el gateway sin arrancar la función.

   `registro` crea cuentas con un código de alta o una invitación y **no pide sesión**:
   `config.toml` le pone `verify_jwt = false`. En *Edge Functions → registro → Details*,
   **Enforce JWT verification** tiene que figurar apagado. Prueba rápida (no crea nada):

   ```bash
   curl -s -X POST https://<ref>.supabase.co/functions/v1/registro \
     -H "apikey: <publishable key>" -H "content-type: application/json" \
     -d '{"email":"x@x.uy","codigo":"AAAA-BBBB-CCCC-DDDD"}'
   ```

   Tiene que responder `403` con *El código no es válido…* (sin `apikey`, `401`).

   `registro` arma el link del mail con el secret `SITIO_URL`, **obligatorio**: el dominio de
   Vercel con `https://` y sin barra final. Va en `.env.nube` junto con los de la IA. Sin él la
   función responde 503 y no da altas. Solo en local se arregla con el *Origin* (localhost).

6. **Auth** (*Authentication*). Se configura en el dashboard. **No corras
   `supabase config push`**: subiría `supabase/config.toml`, que es la config local (Site URL
   en localhost).
   - *Sign In / Providers → Email*: desactivar **Allow new users to sign up**. Las cuentas
     las crea solo la función `registro`, con código o invitación.
   - *URL Configuration*: **Site URL** = el dominio de Vercel (paso 2). En *Redirect URLs*
     agregá `https://<dominio>/**` (con los dos asteriscos): los mails vuelven a
     `/bienvenida?siguiente=…`.
   - **SMTP propio** (*Project Settings → Authentication → SMTP Settings*). Sin esto no
     llegan los mails de alta ni de contraseña olvidada: el SMTP de Supabase solo manda a los
     mails del equipo del proyecto. Con Brevo (gratis, 300 mails por día):
     1. Creá la cuenta en brevo.com y verificá un remitente (*Senders*), por ejemplo tu
        Gmail o uno del dominio si tenés.
     2. *SMTP & API → SMTP*: generá una **SMTP key**. Es una contraseña: va directo al
        dashboard de Supabase, ni al repo ni al chat.
     3. En Supabase: *Enable custom SMTP*, Host `smtp-relay.brevo.com`, Port `587`, User = el
        login SMTP que muestra Brevo, Password = la SMTP key, Sender email = el remitente
        verificado, Sender name `Anotado`.
     4. *Rate Limits*: **Rate limit for sending emails** en 30 por hora (sobra).
   - *Email Templates*: pegá los de `supabase/templates/` en **Invite user**
     (`invitacion.html`, asunto *Confirmá tu mail para entrar a Anotado*) y **Reset password**
     (`recuperar.html`, asunto *Elegí una contraseña nueva para Anotado*) y **Magic Link**
     (`entrar.html`, asunto *Tu link para entrar a Anotado*: le llega a quien se registra con un
     mail que ya tiene cuenta).
7. **Realtime** (*Realtime → Settings*): desactivar **Allow public access**. Así solo
   funcionan los canales privados, que la base autoriza por negocio.
8. **Local de demo:**
   1. *Authentication → Users → Add user → Create new user*, con **Auto Confirm User**, tres
      veces: dueño, cajero y cocina. Contraseñas fuertes, nada de `anotado123`.
   2. Abrí `supabase/demo/negocio-demo.sql`, poné los tres mails arriba y corrélo en el
      *SQL Editor*. Crea *Rotisería El Ceibo* (`/el-ceibo`) con el menú y la IA habilitada.
9. **Verificar la función** con sesiones reales. No gasta IA: prueba que arranca con
   `packages/shared`, que cocina recibe 403 y que con la IA apagada responde 403 sin
   registrar uso. Copiá `scripts/verificacion.env.example` a `scripts/.env.verificacion`
   (ignorado por git), completá URL, publishable key y los mails y contraseñas de dueño y
   cocina, y corré:

   ```bash
   node --env-file=scripts/.env.verificacion scripts/verificar-parse-order.mjs
   ```

   Tiene que terminar en **Todo OK**. Si la función no arranca (503 o *BOOT_ERROR*), el
   paquete no incluyó `packages/shared`: se pasa al plan B (copiar `shared` a
   `supabase/functions/_shared` antes del deploy). Para confirmar que tampoco se consumió
   el límite, corré `select * from limites_ia;` en el *SQL Editor* antes y después.
   Con `--con-ia` hace además una interpretación real (**llamada paga**: revisá el saldo).

### Checklist del dashboard (antes de dar la demo por lista)

- [ ] *Project Settings → JWT Keys*: la **Current key** es ECC (P-256) o RSA.
- [ ] *Authentication → Sign In / Providers → Email*: **Allow new users to sign up** apagado.
      El script de verificación lo comprueba (lee `disable_signup` sin crear cuentas).
- [ ] *Authentication → URL Configuration*: Site URL y Redirect URLs con el dominio de Vercel.
- [ ] *Realtime → Settings*: **Allow public access** apagado.
- [ ] `pnpm supabase secrets list` muestra los `IA_*`.
- [ ] *Edge Functions → registro*: **Enforce JWT verification** apagado.
- [ ] SMTP propio configurado y plantillas en español (paso 1.6). Probá *Me olvidé la contraseña* con tu mail.
- [ ] *Redirect URLs* incluye `https://<dominio>/**`.

## 2. Vercel

1. *Add New → Project → Import* el repo de GitHub.
2. **Root Directory:** `apps/web`. Dejá activado *Include files outside the root directory*
   (la web usa `packages/shared`).
3. **Environment Variables** (Production y Preview). Las dos son públicas por diseño: la
   seguridad la dan RLS y las RPC.
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = la *publishable key* (*Project Settings → API Keys*)
   - `ENABLE_EXPERIMENTAL_COREPACK` = `1` (usa el pnpm fijado en `package.json`)
4. *Settings → Build and Deployment → Node.js Version*: **24.x**.
5. Deploy. `apps/web/vercel.json` ya trae la redirección de rutas al SPA (sin eso,
   `/el-ceibo/cocina` daría 404) y los headers de seguridad (CSP, etc.).
6. Volvé a Supabase y poné el dominio final en *Site URL* (paso 1.6).

## 3. GitHub

*Settings → Secrets and variables → Actions → Variables* (variables, no secretos):
`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. Las usa `mantener-activo.yml`, que consulta
la API una vez por día para que el plan gratis no pause el proyecto.

## Operación

**IA por local** (*SQL Editor*). Solo el operador cambia `ia_permitida`; el dueño prende o
apaga `ia_activa` desde *Ajustes*.

```sql
update negocios set ia_permitida = false where slug = 'el-ceibo';  -- cortar la IA
update negocios set ia_permitida = true  where slug = 'el-ceibo';  -- habilitarla
```

Para cortar la IA de **todos** los locales a la vez, revocá la key en OpenRouter.

**Panel del operador** (`/operador`). Reemplaza el SQL de esta sección (IA, códigos) y suma suspender locales.
Una sola vez, para nombrarte operador (*SQL Editor*, con tu mail):

```sql
insert into operadores (user_id) select id from auth.users where email = '<tu mail>';
```

Además, *Authentication → Multi-Factor* (o *Sign In / Providers → Multi-Factor*): **TOTP**
habilitado (y solo TOTP: el panel exige ese método). En *Authentication → Hooks*, ningún
*Custom Access Token Hook* (podría escribir las claims que mira el panel). La primera vez que
entres a `/operador` te muestra un QR para la app de
contraseñas del iPhone (o Google Authenticator); desde ahí, cada vez te pide el código de 6
números. Sin ese código, las funciones del panel no responden.

**Alta de un local nuevo** (*SQL Editor*). Generá un código de un solo uso y pasáselo al dueño
(vence en 14 días; el segundo parámetro cambia los días, de 1 a 90):

```sql
select crear_codigo_alta('Pizzería Don José');   -- devuelve algo como K7Q2-M9XP-4T8R-WN3H
```

El dueño entra a `https://<dominio>/registro?codigo=K7Q2-M9XP-4T8R-WN3H`, crea su cuenta y su
local, carga el menú e invita a su equipo desde *Equipo*. El local arranca **sin IA**: se
habilita como arriba. Para ver los códigos y si se usaron:

```sql
select nota, vence_at, registros, usado_at, negocio_id from codigos_alta order by created_at desc;
```

**Contraseñas olvidadas.** Las resuelve cada persona con *Me olvidé la contraseña* en la
pantalla de entrar (necesita el SMTP del paso 1.6).

**Cambios posteriores:**

| Cambió | Comando |
|---|---|
| `supabase/migrations/` | `pnpm supabase db push` |
| `supabase/functions/` o `packages/shared/` (lo usan las funciones) | `pnpm supabase functions deploy parse-order` y `pnpm supabase functions deploy registro` |
| Secrets de la IA | `pnpm supabase secrets set --env-file supabase/functions/.env.nube` |
| `apps/web/` | Automático: Vercel deploya cada push a `main` |
