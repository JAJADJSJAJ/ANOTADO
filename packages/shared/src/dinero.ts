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
