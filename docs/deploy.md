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

4. **Secrets de la IA.** Creá en OpenRouter una key **nueva para producción, con límite de
   crédito** (*Keys → Create key → Credit limit*). Revisá el saldo antes. Copiá
   `supabase/functions/.env.example` a `supabase/functions/.env.nube` (ignorado por git),
   completá `IA_API_KEY` y:

   ```bash
   pnpm supabase secrets set --env-file supabase/functions/.env.nube
   ```

5. **Edge Function:**

   ```bash
   pnpm supabase functions deploy parse-order
   ```

   En la salida tienen que aparecer archivos de `packages/shared/src/` entre los subidos.
   Prueba rápida: `curl -i -X POST https://<ref>.supabase.co/functions/v1/parse-order` tiene
   que responder **401** (la función arrancó y pide sesión). Si da **503 / BOOT_ERROR**, el
   paquete no incluyó `packages/shared`: avisá y se pasa al plan B (copiar `shared` a
   `supabase/functions/_shared` antes del deploy).

6. **Auth** (*Authentication*):
   - *Sign In / Providers → Email*: desactivar **Allow new users to sign up**. Los usuarios
     los crea el operador.
   - *URL Configuration*: **Site URL** = el dominio de Vercel (paso 2). Agregalo también en
     *Redirect URLs*.
7. **Realtime** (*Realtime → Settings*): desactivar **Allow public access**. Así solo
   funcionan los canales privados, que la base autoriza por negocio.
8. **Local de demo:**
   1. *Authentication → Users → Add user → Create new user*, con **Auto Confirm User**, tres
      veces: dueño, cajero y cocina. Contraseñas fuertes, nada de `anotado123`.
   2. Abrí `supabase/demo/negocio-demo.sql`, poné los tres mails arriba y corrélo en el
      *SQL Editor*. Crea *Rotisería El Ceibo* (`/el-ceibo`) con el menú y la IA habilitada.

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

**Cambios posteriores:**

| Cambió | Comando |
|---|---|
| `supabase/migrations/` | `pnpm supabase db push` |
| `supabase/functions/` o `packages/shared/` (lo usa la función) | `pnpm supabase functions deploy parse-order` |
| Secrets de la IA | `pnpm supabase secrets set --env-file supabase/functions/.env.nube` |
| `apps/web/` | Automático: Vercel deploya cada push a `main` |
