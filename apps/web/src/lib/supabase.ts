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

// Supabase/PostgREST limita cada consulta a 1000 filas. Para tablas grandes
// (p. ej. attendance con meses de histórico) se pagina con .range() hasta traer
// todo. `make` debe devolver una consulta NUEVA (select + filtros, sin range).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(make: () => any): Promise<T[]> {
  const out: T[] = []
  const step = 1000
  for (let from = 0; ; from += step) {
    const { data, error } = await make().range(from, from + step - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < step) break
  }
  return out
}
