import { useEffect, useState } from 'react';

/** Hora del servidor estimada (Date.now() + desfase), refrescada cada `cadaMs`. */
export function useAhora(desfase: number, cadaMs = 10_000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora + desfase;
}
