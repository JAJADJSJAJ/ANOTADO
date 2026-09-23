/** Formatea centavos enteros como pesos uruguayos: 125000 → "$ 1.250", 12550 → "$ 125,50". */
export function formatearPrecio(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new Error(`centavos debe ser entero, llegó ${centavos}`);
  }
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = abs % 100;
  const decimales = resto === 0 ? '' : `,${resto.toString().padStart(2, '0')}`;
  return `${signo}$ ${pesos}${decimales}`;
}

/**
 * Lee un precio escrito a mano en formato uruguayo y lo devuelve en centavos.
 * "280" → 28000 · "1.250" → 125000 · "125,50" → 12550 · "$ 1.250,5" → 125050.
 * Devuelve null si no es un precio válido.
 */
export function parsearPrecio(texto: string): number | null {
  const limpio = texto.replace(/\$/g, '').replace(/\s/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/.exec(limpio);
  if (!m) return null;
  const pesos = Number(m[1]!.replace(/\./g, ''));
  const centavos = Number((m[2] ?? '').padEnd(2, '0'));
  const total = pesos * 100 + centavos;
  return total <= 2_000_000_000 ? total : null;
}
