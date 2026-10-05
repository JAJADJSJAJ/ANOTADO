import { CodigoAltaSchema, MIN_PASSWORD, NombreLocalSchema } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { BotonPrincipal, Campo, PantallaCuenta } from '../components/Cuenta.tsx';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { crearCuentaYEntrar } from '../lib/funciones.ts';
import { supabase } from '../lib/supabase.ts';

/**
 * Alta de un local con el código que da el operador de Anotado. Sin sesión, crea también la
 * cuenta del dueño; con sesión (alguien que ya trabaja en otro local), solo el local.
 * El código puede venir en el link: /registro?codigo=K7Q2-M9XP-4T8R
 */
export function Registro() {
  const sesion = useSesion();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [codigo, setCodigo] = useState(params.get('codigo') ?? '');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (sesion === undefined) return <Cargando />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cod = CodigoAltaSchema.safeParse(codigo);
    if (!cod.success) return setError('Revisá el código: son 12 letras y números, como K7Q2-M9XP-4T8R.');
    const nom = NombreLocalSchema.safeParse(nombre);
    if (!nom.success) return setError(nom.error.issues[0]?.message ?? 'Revisá el nombre del local.');

    setEnviando(true);
    if (!sesion) {
      const errCuenta = await crearCuentaYEntrar({ email: email.trim(), password, codigo: cod.data });
      if (errCuenta) {
        setEnviando(false);
        return setError(errCuenta);
      }
    }
    const { data, error } = await supabase.rpc('crear_negocio', { p_codigo: cod.data, p_nombre: nom.data });
    setEnviando(false);
    if (error) return setError(error.message);
    const { slug } = data as { slug: string };
    // Lo primero que necesita un local nuevo es su menú.
    navigate(`/${slug}/admin/menu`, { replace: true });
  }

  return (
    <PantallaCuenta>
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-black">Dar de alta tu local</h2>
          <p className="text-stone-600">Necesitás el código que te dio Anotado.</p>
        </div>
        <Campo
          etiqueta="Código"
          required
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="K7Q2-M9XP-4T8R"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
        <Campo
          etiqueta="Nombre del local"
          required
          maxLength={120}
          placeholder="Rotisería El Ceibo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        {sesion ? (
          <p className="rounded-xl bg-stone-100 p-3 text-stone-700">
            El local queda a nombre de <strong>{sesion.user.email}</strong>.
            <BotonSalir className="ml-1 px-0 py-0 text-stone-600" />
          </p>
        ) : (
          <>
            <Campo
              etiqueta="Tu email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Campo
              etiqueta="Elegí una contraseña"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              ayuda={`Al menos ${MIN_PASSWORD} caracteres.`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        {error && <MensajeError>{error}</MensajeError>}
        <BotonPrincipal disabled={enviando}>{enviando ? 'Creando…' : 'Crear mi local'}</BotonPrincipal>
      </form>
      {!sesion && (
        <p className="border-t border-stone-200 pt-4 text-center text-stone-600">
          ¿Ya tenés cuenta?{' '}
          <Link
            to="/login"
            state={{ desde: `/registro${codigo ? `?codigo=${encodeURIComponent(codigo)}` : ''}` }}
            className="font-bold text-indigo-700 underline"
          >
            Entrá
          </Link>{' '}
          y volvé acá.
        </p>
      )}
    </PantallaCuenta>
  );
}
