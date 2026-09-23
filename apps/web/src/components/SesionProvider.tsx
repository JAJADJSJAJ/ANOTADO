import type { Session } from '@supabase/supabase-js';
import { type ReactNode, useEffect, useState } from 'react';
import { SesionContext } from '../lib/contextos.ts';
import { supabase } from '../lib/supabase.ts';

export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return <SesionContext value={sesion}>{children}</SesionContext>;
}
