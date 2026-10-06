export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      categorias: {
        Row: {
          id: string
          negocio_id: string
          nombre: string
          orden: number
        }
        Insert: {
          id?: string
          negocio_id: string
          nombre: string
          orden?: number
        }
        Update: {
          id?: string
          negocio_id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "categorias_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          direcciones: Json
          id: string
          negocio_id: string
          nombre: string | null
          telefono: string
        }
        Insert: {
          direcciones?: Json
          id?: string
          negocio_id: string
          nombre?: string | null
          telefono: string
        }
        Update: {
          direcciones?: Json
          id?: string
          negocio_id?: string
          nombre?: string | null
          telefono?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      codigos_alta: {
        Row: {
          codigo_hash: string
          created_at: string
          id: string
          negocio_id: string | null
          nota: string | null
          usado_at: string | null
          usado_por: string | null
          vence_at: string
        }
        Insert: {
          codigo_hash: string
          created_at?: string
          id?: string
          negocio_id?: string | null
          nota?: string | null
          usado_at?: string | null
          usado_por?: string | null
          vence_at: string
        }
        Update: {
          codigo_hash?: string
          created_at?: string
          id?: string
          negocio_id?: string | null
          nota?: string | null
          usado_at?: string | null
          usado_por?: string | null
          vence_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "codigos_alta_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      contadores_pedidos: {
        Row: {
          jornada: string
          negocio_id: string
          ultimo: number
        }
        Insert: {
          jornada: string
          negocio_id: string
          ultimo: number
        }
        Update: {
          jornada?: string
          negocio_id?: string
          ultimo?: number
        }
        Relationships: [
          {
            foreignKeyName: "contadores_pedidos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      conversaciones: {
        Row: {
          borrador: Json
          cliente_id: string | null
          created_at: string
          estado: string
          etiqueta: string | null
          id: string
          interpretando_hasta: string | null
          negocio_id: string
          pendientes: Json
          ultimo_mensaje_at: string
          version: number
        }
        Insert: {
          borrador?: Json
          cliente_id?: string | null
          created_at?: string
          estado?: string
          etiqueta?: string | null
          id?: string
          interpretando_hasta?: string | null
          negocio_id: string
          pendientes?: Json
          ultimo_mensaje_at?: string
          version?: number
        }
        Update: {
          borrador?: Json
          cliente_id?: string | null
          created_at?: string
          estado?: string
          etiqueta?: string | null
          id?: string
          interpretando_hasta?: string | null
          negocio_id?: string
          pendientes?: Json
          ultimo_mensaje_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversaciones_cliente_id_negocio_id_fkey"
            columns: ["cliente_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "conversaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      invitaciones: {
        Row: {
          creada_por: string | null
          created_at: string
          id: string
          negocio_id: string
          revocada_at: string | null
          rol: Database["public"]["Enums"]["rol_miembro"]
          token_hash: string
          usada_at: string | null
          usada_por: string | null
          vence_at: string
        }
        Insert: {
          creada_por?: string | null
          created_at?: string
          id?: string
          negocio_id: string
          revocada_at?: string | null
          rol: Database["public"]["Enums"]["rol_miembro"]
          token_hash: string
          usada_at?: string | null
          usada_por?: string | null
          vence_at: string
        }
        Update: {
          creada_por?: string | null
          created_at?: string
          id?: string
          negocio_id?: string
          revocada_at?: string | null
          rol?: Database["public"]["Enums"]["rol_miembro"]
          token_hash?: string
          usada_at?: string | null
          usada_por?: string | null
          vence_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      limites_ia: {
        Row: {
          clave: string
          cuenta: number
          negocio_id: string
          ventana: string
        }
        Insert: {
          clave: string
          cuenta: number
          negocio_id: string
          ventana: string
        }
        Update: {
          clave?: string
          cuenta?: number
          negocio_id?: string
          ventana?: string
        }
        Relationships: [
          {
            foreignKeyName: "limites_ia_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      limites_registro: {
        Row: {
          clave: string
          cuenta: number
          ventana: string
        }
        Insert: {
          clave: string
          cuenta: number
          ventana: string
        }
        Update: {
          clave?: string
          cuenta?: number
          ventana?: string
        }
        Relationships: []
      }
      mensajes: {
        Row: {
          contenido: string
          conversacion_id: string
          created_at: string
          id: string
          interpretado: boolean
          negocio_id: string
          orden: number
          rol: Database["public"]["Enums"]["rol_mensaje"]
          tipo: string
          wa_message_id: string | null
        }
        Insert: {
          contenido: string
          conversacion_id: string
          created_at?: string
          id?: string
          interpretado?: boolean
          negocio_id: string
          orden?: never
          rol: Database["public"]["Enums"]["rol_mensaje"]
          tipo?: string
          wa_message_id?: string | null
        }
        Update: {
          contenido?: string
          conversacion_id?: string
          created_at?: string
          id?: string
          interpretado?: boolean
          negocio_id?: string
          orden?: never
          rol?: Database["public"]["Enums"]["rol_mensaje"]
          tipo?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_conversacion_id_negocio_id_fkey"
            columns: ["conversacion_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "mensajes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      miembros: {
        Row: {
          negocio_id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          user_id: string
        }
        Insert: {
          negocio_id: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          user_id: string
        }
        Update: {
          negocio_id?: string
          rol?: Database["public"]["Enums"]["rol_miembro"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "miembros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      negocios: {
        Row: {
          activo: boolean
          config: Json
          created_at: string
          hora_corte_jornada: string
          horarios: Json
          ia_activa: boolean
          ia_permitida: boolean
          id: string
          nombre: string
          slug: string
          wa_phone_number_id: string | null
          zona_horaria: string
        }
        Insert: {
          activo?: boolean
          config?: Json
          created_at?: string
          hora_corte_jornada?: string
          horarios?: Json
          ia_activa?: boolean
          ia_permitida?: boolean
          id?: string
          nombre: string
          slug: string
          wa_phone_number_id?: string | null
          zona_horaria?: string
        }
        Update: {
          activo?: boolean
          config?: Json
          created_at?: string
          hora_corte_jornada?: string
          horarios?: Json
          ia_activa?: boolean
          ia_permitida?: boolean
          id?: string
          nombre?: string
          slug?: string
          wa_phone_number_id?: string | null
          zona_horaria?: string
        }
        Relationships: []
      }
      operadores: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pedido_items: {
        Row: {
          cantidad: number
          id: string
          negocio_id: string
          nombre_snapshot: string
          notas: string | null
          pedido_id: string
          precio_unitario_centavos: number
          producto_id: string | null
        }
        Insert: {
          cantidad: number
          id?: string
          negocio_id: string
          nombre_snapshot: string
          notas?: string | null
          pedido_id: string
          precio_unitario_centavos: number
          producto_id?: string | null
        }
        Update: {
          cantidad?: number
          id?: string
          negocio_id?: string
          nombre_snapshot?: string
          notas?: string | null
          pedido_id?: string
          precio_unitario_centavos?: number
          producto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_items_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_pedido_id_negocio_id_fkey"
            columns: ["pedido_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "pedido_items_producto_id_negocio_id_fkey"
            columns: ["producto_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id", "negocio_id"]
          },
        ]
      }
      pedidos: {
        Row: {
          cancelado_motivo: string | null
          cancelado_por: string | null
          cliente_id: string | null
          conversacion_id: string | null
          creado_por: string | null
          created_at: string
          entrega: Json | null
          envio_centavos: number
          estado: Database["public"]["Enums"]["estado_pedido"]
          id: string
          jornada: string
          mensaje_original: string | null
          negocio_id: string
          notas: string | null
          numero: number
          origen: Database["public"]["Enums"]["origen_pedido"]
          total_centavos: number
          updated_at: string
          zona_id: string | null
        }
        Insert: {
          cancelado_motivo?: string | null
          cancelado_por?: string | null
          cliente_id?: string | null
          conversacion_id?: string | null
          creado_por?: string | null
          created_at?: string
          entrega?: Json | null
          envio_centavos?: number
          estado?: Database["public"]["Enums"]["estado_pedido"]
          id?: string
          jornada: string
          mensaje_original?: string | null
          negocio_id: string
          notas?: string | null
          numero: number
          origen: Database["public"]["Enums"]["origen_pedido"]
          total_centavos?: number
          updated_at?: string
          zona_id?: string | null
        }
        Update: {
          cancelado_motivo?: string | null
          cancelado_por?: string | null
          cliente_id?: string | null
          conversacion_id?: string | null
          creado_por?: string | null
          created_at?: string
          entrega?: Json | null
          envio_centavos?: number
          estado?: Database["public"]["Enums"]["estado_pedido"]
          id?: string
          jornada?: string
          mensaje_original?: string | null
          negocio_id?: string
          notas?: string | null
          numero?: number
          origen?: Database["public"]["Enums"]["origen_pedido"]
          total_centavos?: number
          updated_at?: string
          zona_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_cliente_id_negocio_id_fkey"
            columns: ["cliente_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "pedidos_conversacion_id_negocio_id_fkey"
            columns: ["conversacion_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "pedidos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_zona_id_negocio_id_fkey"
            columns: ["zona_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "zonas_envio"
            referencedColumns: ["id", "negocio_id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          alias: string[]
          categoria_id: string | null
          created_at: string
          id: string
          negocio_id: string
          nombre: string
          precio_centavos: number
        }
        Insert: {
          activo?: boolean
          alias?: string[]
          categoria_id?: string | null
          created_at?: string
          id?: string
          negocio_id: string
          nombre: string
          precio_centavos: number
        }
        Update: {
          activo?: boolean
          alias?: string[]
          categoria_id?: string | null
          created_at?: string
          id?: string
          negocio_id?: string
          nombre?: string
          precio_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "productos_categoria_id_negocio_id_fkey"
            columns: ["categoria_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "productos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      registro_operador: {
        Row: {
          accion: string
          created_at: string
          detalle: Json
          id: number
          negocio_id: string | null
          user_id: string | null
        }
        Insert: {
          accion: string
          created_at?: string
          detalle?: Json
          id?: never
          negocio_id?: string | null
          user_id?: string | null
        }
        Update: {
          accion?: string
          created_at?: string
          detalle?: Json
          id?: never
          negocio_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registro_operador_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_registro: {
        Row: {
          codigo_id: string | null
          created_at: string
          email_hash: string
          estado: string
          habia_cuenta: boolean
          id: string
          invitacion_id: string | null
          resuelta_at: string | null
        }
        Insert: {
          codigo_id?: string | null
          created_at?: string
          email_hash: string
          estado?: string
          habia_cuenta: boolean
          id?: string
          invitacion_id?: string | null
          resuelta_at?: string | null
        }
        Update: {
          codigo_id?: string | null
          created_at?: string
          email_hash?: string
          estado?: string
          habia_cuenta?: boolean
          id?: string
          invitacion_id?: string | null
          resuelta_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_registro_codigo_id_fkey"
            columns: ["codigo_id"]
            isOneToOne: false
            referencedRelation: "codigos_alta"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_registro_invitacion_id_fkey"
            columns: ["invitacion_id"]
            isOneToOne: false
            referencedRelation: "invitaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      uso_ia: {
        Row: {
          conversacion_id: string | null
          created_at: string
          id: number
          modelo: string
          negocio_id: string
          tokens_entrada: number
          tokens_salida: number
        }
        Insert: {
          conversacion_id?: string | null
          created_at?: string
          id?: never
          modelo: string
          negocio_id: string
          tokens_entrada: number
          tokens_salida: number
        }
        Update: {
          conversacion_id?: string | null
          created_at?: string
          id?: never
          modelo?: string
          negocio_id?: string
          tokens_entrada?: number
          tokens_salida?: number
        }
        Relationships: [
          {
            foreignKeyName: "uso_ia_conversacion_id_negocio_id_fkey"
            columns: ["conversacion_id", "negocio_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id", "negocio_id"]
          },
          {
            foreignKeyName: "uso_ia_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      zonas_envio: {
        Row: {
          activa: boolean
          costo_centavos: number
          created_at: string
          id: string
          negocio_id: string
          nombre: string
          orden: number
        }
        Insert: {
          activa?: boolean
          costo_centavos: number
          created_at?: string
          id?: string
          negocio_id: string
          nombre: string
          orden?: number
        }
        Update: {
          activa?: boolean
          costo_centavos?: number
          created_at?: string
          id?: string
          negocio_id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "zonas_envio_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aceptar_invitacion: { Args: { p_token: string }; Returns: Json }
      alias_validos: { Args: { alias: string[] }; Returns: boolean }
      anotar_operador: {
        Args: { p_accion: string; p_detalle?: Json; p_negocio_id: string }
        Returns: undefined
      }
      avanzar_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_pedido_id: string
        }
        Returns: Json
      }
      cambiar_rol: {
        Args: {
          p_negocio_id: string
          p_rol: Database["public"]["Enums"]["rol_miembro"]
          p_user_id: string
        }
        Returns: undefined
      }
      cancelar_pedido: {
        Args: { p_motivo?: string; p_pedido_id: string }
        Returns: Json
      }
      cerrar_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: undefined
      }
      confirmar_conversacion: {
        Args: {
          p_conversacion_id: string
          p_entrega?: Json
          p_items: Json
          p_negocio_id: string
          p_notas?: string
          p_ultimo_mensaje: string
          p_version: number
        }
        Returns: Json
      }
      confirmar_pedido: {
        Args: {
          p_conversacion_id?: string
          p_entrega?: Json
          p_items: Json
          p_negocio_id: string
          p_notas?: string
          p_origen: Database["public"]["Enums"]["origen_pedido"]
        }
        Returns: Json
      }
      consumir_limite_ia: {
        Args: {
          p_max_negocio: number
          p_max_usuario: number
          p_negocio_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      consumir_limite_ia_cliente: {
        Args: {
          p_cliente_id: string
          p_max_cliente: number
          p_max_negocio: number
          p_negocio_id: string
        }
        Returns: boolean
      }
      consumir_limite_registro: {
        Args: { p_ip_hash: string; p_max_ip: number; p_max_total: number }
        Returns: boolean
      }
      crear_codigo_alta: {
        Args: { p_dias?: number; p_nota?: string }
        Returns: string
      }
      crear_invitacion: {
        Args: {
          p_negocio_id: string
          p_rol: Database["public"]["Enums"]["rol_miembro"]
        }
        Returns: Json
      }
      crear_negocio: {
        Args: { p_codigo: string; p_nombre: string }
        Returns: Json
      }
      es_miembro: { Args: { n: string }; Returns: boolean }
      es_operador: { Args: never; Returns: boolean }
      es_ultimo_dueno: {
        Args: { p_negocio_id: string; p_user_id: string }
        Returns: boolean
      }
      exigir_borrador_valido: {
        Args: {
          p_borrador: Json
          p_negocio_id: string
          p_solo_activos: boolean
        }
        Returns: undefined
      }
      exigir_operador: { Args: never; Returns: undefined }
      exigir_pendientes_validos: {
        Args: { p_pendientes: Json }
        Returns: undefined
      }
      existe_cuenta: { Args: { p_email_hash: string }; Returns: boolean }
      guardar_borrador: {
        Args: {
          p_borrador: Json
          p_conversacion_id: string
          p_pendientes: Json
          p_version: number
        }
        Returns: number
      }
      guardar_interpretacion: {
        Args: {
          p_borrador: Json
          p_conversacion_id: string
          p_etiqueta: string
          p_mensaje: string
          p_modelo: string
          p_negocio_id: string
          p_pendientes: Json
          p_tokens_entrada: number
          p_tokens_salida: number
          p_version: number
        }
        Returns: {
          conversacion_id: string
          version: number
        }[]
      }
      guardar_interpretacion_wa: {
        Args: {
          p_borrador: Json
          p_conversacion_id: string
          p_mensajes: string[]
          p_modelo: string
          p_negocio_id: string
          p_pendientes: Json
          p_tokens_entrada: number
          p_tokens_salida: number
          p_version: number
        }
        Returns: number
      }
      hash_codigo: { Args: { p_codigo: string }; Returns: string }
      hash_email: { Args: { p_email: string }; Returns: string }
      horarios_validos: { Args: { h: Json }; Returns: boolean }
      invitacion_vigente: {
        Args: { p_token: string }
        Returns: {
          creada_por: string | null
          created_at: string
          id: string
          negocio_id: string
          revocada_at: string | null
          rol: Database["public"]["Enums"]["rol_miembro"]
          token_hash: string
          usada_at: string | null
          usada_por: string | null
          vence_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invitaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marcar_agotado: {
        Args: { p_agotado: boolean; p_producto_id: string }
        Returns: Json
      }
      mi_estado_operador: { Args: never; Returns: Json }
      miembros_negocio: {
        Args: { p_negocio_id: string }
        Returns: {
          email: string
          rol: Database["public"]["Enums"]["rol_miembro"]
          user_id: string
        }[]
      }
      mis_locales_suspendidos: {
        Args: never
        Returns: {
          nombre: string
        }[]
      }
      mover_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_hacia: Database["public"]["Enums"]["estado_pedido"]
          p_pedido_id: string
        }
        Returns: Json
      }
      negocio_de_topic: { Args: { p_topic: string }; Returns: string }
      negocio_de_topic_conversaciones: {
        Args: { p_topic: string }
        Returns: string
      }
      operador_anular_codigo: {
        Args: { p_codigo_id: string }
        Returns: undefined
      }
      operador_cambiar_activo: {
        Args: { p_activo: boolean; p_motivo?: string; p_negocio_id: string }
        Returns: undefined
      }
      operador_cambiar_ia: {
        Args: { p_negocio_id: string; p_permitida: boolean }
        Returns: undefined
      }
      operador_codigos: {
        Args: never
        Returns: {
          created_at: string
          estado: string
          id: string
          negocio: string
          nota: string
          usado_at: string
          vence_at: string
        }[]
      }
      operador_conectar_whatsapp: {
        Args: { p_negocio_id: string; p_phone_number_id: string }
        Returns: undefined
      }
      operador_crear_codigo: {
        Args: { p_dias?: number; p_nota?: string }
        Returns: string
      }
      operador_locales: {
        Args: never
        Returns: {
          activo: boolean
          created_at: string
          duenos: string[]
          ia_activa: boolean
          ia_permitida: boolean
          id: string
          miembros: number
          nombre: string
          pedidos_30d: number
          slug: string
          usos_ia_30d: number
          wa_phone_number_id: string
        }[]
      }
      pedidos_cocina: { Args: { p_negocio_id: string }; Returns: Json }
      ping: { Args: never; Returns: boolean }
      preparar_cambio_equipo: {
        Args: { p_negocio_id: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["rol_miembro"]
      }
      puede_mover_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_hacia: Database["public"]["Enums"]["estado_pedido"]
          p_negocio_id: string
        }
        Returns: boolean
      }
      quitar_miembro: {
        Args: { p_negocio_id: string; p_user_id: string }
        Returns: undefined
      }
      recibir_mensaje_wa: {
        Args: {
          p_contenido: string
          p_nombre: string
          p_phone_number_id: string
          p_telefono: string
          p_tipo: string
          p_wa_message_id: string
        }
        Returns: Json
      }
      reservar_registro: {
        Args: { p_codigo?: string; p_email: string; p_token?: string }
        Returns: string
      }
      resolver_reserva: { Args: { p_reserva: string }; Returns: string }
      retroceder_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_pedido_id: string
        }
        Returns: Json
      }
      revocar_invitacion: {
        Args: { p_invitacion_id: string }
        Returns: undefined
      }
      sesion_con_totp: { Args: never; Returns: boolean }
      slug_desde_nombre: { Args: { p_nombre: string }; Returns: string }
      soltar_conversacion_wa: {
        Args: { p_conversacion_id: string; p_negocio_id: string }
        Returns: boolean
      }
      tiene_rol: {
        Args: { n: string; roles: Database["public"]["Enums"]["rol_miembro"][] }
        Returns: boolean
      }
      token_aleatorio: { Args: { p_bytes: number }; Returns: string }
      tomar_conversacion_wa: {
        Args: {
          p_conversacion_id: string
          p_negocio_id: string
          p_segundos: number
        }
        Returns: boolean
      }
      ver_invitacion: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      estado_pedido:
        | "pendiente"
        | "en_cocina"
        | "listo"
        | "entregado"
        | "cancelado"
      origen_pedido: "whatsapp" | "mostrador" | "telefono" | "mesa"
      rol_mensaje: "cliente" | "asistente" | "sistema"
      rol_miembro: "dueno" | "cajero" | "cocina"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      estado_pedido: [
        "pendiente",
        "en_cocina",
        "listo",
        "entregado",
        "cancelado",
      ],
      origen_pedido: ["whatsapp", "mostrador", "telefono", "mesa"],
      rol_mensaje: ["cliente", "asistente", "sistema"],
      rol_miembro: ["dueno", "cajero", "cocina"],
    },
  },
} as const

