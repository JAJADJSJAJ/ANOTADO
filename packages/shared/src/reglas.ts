// Límites del dominio. Espejados en la RPC confirmar_pedido y en el check de pedido_items:
// si cambiás uno, cambiá los tres.
export const MAX_CANTIDAD = 20;
export const MAX_ITEMS = 30;
export const MAX_NOTAS_ITEM = 200;
export const MAX_NOTAS = 500;
export const MAX_DIRECCION = 200;
export const MAX_MESA = 20;
/** Máximo de acciones que se aceptan de una sola respuesta de la IA. */
export const MAX_ACCIONES = 40;
