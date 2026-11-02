// Culto en vivo (flujo #10): código para asistencia en línea y helpers puros.

// Sin caracteres que se confunden al dictarlos o leerlos en pantalla (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateOnlineCode(length = 6): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
}

// "K7P2QX" → "K7P 2QX", más fácil de leer en voz alta.
export function formatOnlineCode(code: string | null): string {
  if (!code) return '—'
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

// Minutos transcurridos → "Hace 5 min" / "1 h 20 min".
export function elapsedLabel(fromIso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

export type AttendanceType = 'presential' | 'online'

export interface LiveAttendance {
  id: string
  member_id: string | null
  type: string | null
  checked_at: string | null
}

export function countByType(rows: LiveAttendance[]): { total: number; presential: number; online: number } {
  const online = rows.filter((r) => r.type === 'online').length
  return { total: rows.length, presential: rows.length - online, online }
}
