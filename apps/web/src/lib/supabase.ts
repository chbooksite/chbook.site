import { createClient } from '@supabase/supabase-js'
import type { Database } from '@chbook/types'

// Cliente de Supabase para la web del pastor.
// Tipado con el esquema generado (@chbook/types) para autocompletado y seguridad
// en las consultas. Solo usa la ANON KEY pública — RLS protege los datos.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno de Supabase. Copia apps/web/.env.example a ' +
      '.env.local y define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
