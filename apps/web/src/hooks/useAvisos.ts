import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aviso } from '../components/Avisos.tsx';

const DURACION: Record<Aviso['tipo'], number> = { info: 5000, ok: 5000, error: 8000, cancelado: 20000, deshacer: 10000 };
/** Lo que dura la animación de salida antes de sacarlo de la lista. */
const SALIDA_MS = 200;

let siguienteId = 0;

/** Avisos flotantes que se van solos. El de "deshacer" dura 10 s. */
export function useAvisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const quitar = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    setAvisos((as) => as.map((a) => (a.id === id ? { ...a, saliendo: true } : a)));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setAvisos((as) => as.filter((a) => a.id !== id));
      }, SALIDA_MS),
    );
  }, []);

  const avisar = useCallback(
    (aviso: Omit<Aviso, 'id'>) => {
      const id = ++siguienteId;
      // Un aviso nuevo con la misma clave (p. ej. el mismo pedido) reemplaza al anterior.
      setAvisos((as) => [...as.filter((a) => !aviso.clave || a.clave !== aviso.clave).slice(-3), { ...aviso, id }]);
      timers.current.set(id, setTimeout(() => quitar(id), DURACION[aviso.tipo]));
    },
    [quitar],
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  return { avisos, avisar, quitar };
}
