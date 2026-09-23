-- Listados por negocio ordenados por fecha (cocina, historial).
create index pedidos_negocio_created on pedidos (negocio_id, created_at desc);
-- Últimos N mensajes de una conversación (contexto de la IA).
create index mensajes_conversacion_created on mensajes (conversacion_id, created_at desc);
create index mensajes_negocio_created on mensajes (negocio_id, created_at desc);

-- FKs y filtros frecuentes.
create index miembros_user on miembros (user_id);
create index categorias_negocio on categorias (negocio_id, orden);
create index productos_negocio on productos (negocio_id);
create index conversaciones_negocio on conversaciones (negocio_id, ultimo_mensaje_at desc);
create index pedido_items_pedido on pedido_items (pedido_id);
create index uso_ia_negocio_created on uso_ia (negocio_id, created_at);
