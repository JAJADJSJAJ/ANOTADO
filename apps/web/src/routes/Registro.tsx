import { CodigoAltaSchema, NombreLocalSchema } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BotonPrincipal, Campo, MailEnviado, PantallaCuenta, TituloCuenta } from '../components/Cuenta.tsx';
import { Cargando, MensajeError, Nota } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { pedirCuenta } from '../lib/funciones.ts';
import { supabase } from '../lib/supabase.ts';

/** El nombre del local se recuerda mientras la persona va y vuelve del mail (mismo navegador). */
const claveNombre = (codigo: string) => `anotado:nombre-local:${codigo}`;
function leerNombre(codigo: string): string {
  try {
    return localStorage.getItem(claveNombre(codigo)) ?? '';
  } catch {
    return '';
  }
}
function guardarNombre(codigo: string, nombre: string | null) {
  try {
    if (nombre) localStorage.setItem(claveNombre(codigo), nombre);
    else localStorage.removeItem(claveNombre(codigo));
  } catch {
    // Sin almacenamiento (modo privado): la persona vuelve a escribir el nombre.
  }
}

/**
 * Alta de un local con el código que da el operador de Anotado. Sin sesión, primero pide la
 * cuenta del dueño: llega un mail, la persona elige su contraseña en /bienvenida y vuelve acá
 * ya con sesión, a terminar el alta. El código puede venir en el link: /registro?codigo=…
 */
export function Registro() {
  const sesion = useSesion();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const codigoInicial = params.get('codigo') ?? '';
  const [codigo, setCodigo] = useState(codigoInicial);
  const [nombre, setNombre] = useState(() => leerNombre(CodigoAltaSchema.safeParse(codigoInicial).data ?? ''));
  const [email, setEmail] = useState('');
  const [mailEnviado, setMailEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (sesion === undefined) return <Cargando />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cod = CodigoAltaSchema.safeParse(codigo);
    if (!cod.success) return setError('Revisá el código: son 16 letras y números, como K7Q2-M9XP-4T8R-WN3H.');
    const nom = NombreLocalSchema.safeParse(nombre);
    if (!nom.success) return setError(nom.error.issues[0]?.message ?? 'Revisá el nombre del local.');

    setEnviando(true);
    if (!sesion) {
      const err = await pedirCuenta({ email: email.trim(), codigo: cod.data });
      setEnviando(false);
      if (err) return setError(err);
      guardarNombre(cod.data, nom.data);
      return setMailEnviado(true);
    }
    const { data, error } = await supabase.rpc('crear_negocio', { p_codigo: cod.data, p_nombre: nom.data });
    setEnviando(false);
    if (error) return setError(error.message);
    guardarNombre(cod.data, null);
    // Lo primero que necesita un local nuevo es su menú.
    navigate(`/${(data as { slug: string }).slug}/admin/menu`, { replace: true });
  }

  if (mailEnviado) {
    return (
      <PantallaCuenta>
        <MailEnviado email={email.trim()} onOtroMail={() => setMailEnviado(false)} />
      </PantallaCuenta>
    );
  }

  return (
    <PantallaCuenta>
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <TituloCuenta titulo="Dar de alta tu local">Necesitás el código que te dio Anotado.</TituloCuenta>
        <Campo
          etiqueta="Código"
          required
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="K7Q2-M9XP-4T8R-WN3H"
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
          <Nota>
            El local queda a nombre de <strong className="font-semibold text-tinta">{sesion.user.email}</strong>.{' '}
            <button type="button" onClick={() => void supabase.auth.signOut()} className="enlace">
              Salir
            </button>
          </Nota>
        ) : (
          <Campo
            etiqueta="Tu email"
            type="email"
            autoComplete="email"
            required
            ayuda="Te mandamos un link para confirmarlo y elegir tu contraseña."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {error && <MensajeError>{error}</MensajeError>}
        <BotonPrincipal disabled={enviando}>
          {enviando ? 'Enviando…' : sesion ? 'Crear mi local' : 'Seguir'}
        </BotonPrincipal>
      </form>
      {!sesion && (
        <p className="border-t border-linea pt-5 text-center text-sm text-tinta-2">
          ¿Ya tenés cuenta?{' '}
          <Link
            to="/login"
            state={{ desde: `/registro${codigo ? `?codigo=${encodeURIComponent(codigo)}` : ''}` }}
            className="enlace"
          >
            Entrá
          </Link>{' '}
          y volvé acá.
        </p>
      )}
    </PantallaCuenta>
  );
}
