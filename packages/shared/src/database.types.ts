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
      mensajes: {
        Row: {
          contenido: string
          conversacion_id: string
          created_at: string
          id: string
          negocio_id: string
          rol: Database["public"]["Enums"]["rol_mensaje"]
          wa_message_id: string | null
        }
        Insert: {
          contenido: string
          conversacion_id: string
          created_at?: string
          id?: string
          negocio_id: string
          rol: Database["public"]["Enums"]["rol_mensaje"]
          wa_message_id?: string | null
        }
        Update: {
          contenido?: string
          conversacion_id?: string
          created_at?: string
          id?: string
          negocio_id?: string
          rol?: Database["public"]["Enums"]["rol_mensaje"]
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
          id?: string
          nombre?: string
          slug?: string
          wa_phone_number_id?: string | null
          zona_horaria?: string
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
          cliente_id: string | null
          conversacion_id: string | null
          creado_por: string | null
          created_at: string
          entrega: Json | null
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
        }
        Insert: {
          cliente_id?: string | null
          conversacion_id?: string | null
          creado_por?: string | null
          created_at?: string
          entrega?: Json | null
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
        }
        Update: {
          cliente_id?: string | null
          conversacion_id?: string | null
          creado_por?: string | null
          created_at?: string
          entrega?: Json | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      alias_validos: { Args: { alias: string[] }; Returns: boolean }
      avanzar_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_pedido_id: string
        }
        Returns: Json
      }
      cerrar_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: undefined
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
      es_miembro: { Args: { n: string }; Returns: boolean }
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
      mover_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_hacia: Database["public"]["Enums"]["estado_pedido"]
          p_pedido_id: string
        }
        Returns: Json
      }
      negocio_de_topic: { Args: { p_topic: string }; Returns: string }
      pedidos_cocina: { Args: { p_negocio_id: string }; Returns: Json }
      puede_mover_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_hacia: Database["public"]["Enums"]["estado_pedido"]
          p_negocio_id: string
        }
        Returns: boolean
      }
      retroceder_estado: {
        Args: {
          p_desde: Database["public"]["Enums"]["estado_pedido"]
          p_pedido_id: string
        }
        Returns: Json
      }
      tiene_rol: {
        Args: { n: string; roles: Database["public"]["Enums"]["rol_miembro"][] }
        Returns: boolean
      }
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

