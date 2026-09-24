import { supabase } from '../lib/supabase.ts';

export function BotonSalir({ className = 'text-stone-600' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => void supabase.auth.signOut()}
      className={`rounded-lg px-3 py-2 font-medium underline ${className}`}
    >
      Salir
    </button>
  );
}
