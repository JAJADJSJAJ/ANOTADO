import { supabase } from '../lib/supabase.ts';
import { Icono } from './Icono.tsx';

export function BotonSalir({ className = 'btn-fantasma', conTexto = true }: { className?: string; conTexto?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => void supabase.auth.signOut()}
      aria-label={conTexto ? undefined : 'Salir'}
      title={conTexto ? undefined : 'Salir'}
      className={`btn ${conTexto ? '' : 'btn-icono'} ${className}`}
    >
      <Icono nombre="salir" />
      {conTexto && 'Salir'}
    </button>
  );
}
