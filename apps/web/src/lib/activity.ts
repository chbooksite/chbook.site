// Actividades · Pilar B. El RITMO de la iglesia: definiciones recurrentes y la
// proyección de la semana. La iglesia piensa en ritmo, no en fechas.

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export type Freq = 'weekly' | 'monthly'
export type AudienceScope = 'all' | 'roles' | 'teams' | 'ages'

export interface Audience {
  scope: AudienceScope
  ids?: string[] // roles o teams
  keys?: string[] // rangos de edad
}

export interface ActivityType {
  id: string
  key: string
  name: string
  color: string
  isSystem: boolean
}

export interface Schedule {
  id: string
  parentId: string | null
  typeId: string | null
  name: string
  freq: Freq
  weekday: number // 0=domingo .. 6=sábado
  nth: number | null // solo monthly: 1..4 o -1 (último)
  startTime: string | null // 'HH:MM[:SS]'
  endTime: string | null
  audience: Audience
  location: string | null
  responsibleTeamId: string | null
  sortOrder: number
  enabled: boolean
}

export function readAudience(json: unknown): Audience {
  const a = (json ?? {}) as Partial<Audience>
  const scope: AudienceScope =
    a.scope === 'roles' || a.scope === 'teams' || a.scope === 'ages' ? a.scope : 'all'
  return { scope, ids: a.ids ?? [], keys: a.keys ?? [] }
}

// 'HH:MM:SS' → minutos desde medianoche (para ordenar). null = al final del día.
export function minutesOf(time: string | null): number {
  if (!time) return 24 * 60 + 1
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// '08:00:00' → '8:00'. null → ''.
export function formatTime(time: string | null): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  return `${h}:${String(m || 0).padStart(2, '0')}`
}

export function nthLabel(nth: number | null): string {
  if (nth == null) return ''
  if (nth === -1) return 'último'
  return `${nth}º`
}

// Qué ocurrencia (1-based) del día de semana es esta fecha dentro de su mes.
function nthOfMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1
}
function isLastWeekdayOfMonth(date: Date): boolean {
  const d = new Date(date)
  d.setDate(d.getDate() + 7)
  return d.getMonth() !== date.getMonth()
}

// ¿La actividad recurrente ocurre en esta fecha?
export function occursOn(s: Schedule, date: Date): boolean {
  if (!s.enabled) return false
  if (date.getDay() !== s.weekday) return false
  if (s.freq === 'weekly') return true
  // monthly: debe coincidir el ordinal
  if (s.nth === -1) return isLastWeekdayOfMonth(date)
  return nthOfMonth(date) === s.nth
}

export function recurrenceLabel(s: Schedule): string {
  if (s.freq === 'weekly') return `Cada ${WEEKDAYS[s.weekday].toLowerCase()}`
  return `${nthLabel(s.nth)} ${WEEKDAYS[s.weekday].toLowerCase()} del mes`
}

// Domingo de la semana que contiene `date` (inicio de semana).
export function weekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export interface DayPlan {
  date: Date
  weekday: number
  items: Schedule[] // solo actividades de nivel superior (sin parent), ordenadas por hora
}

// Proyecta 7 días desde `start` con las actividades que ocurren cada día.
export function projectWeek(schedules: Schedule[], start: Date): DayPlan[] {
  const top = schedules.filter((s) => !s.parentId)
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i)
    const items = top
      .filter((s) => occursOn(s, date))
      .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime) || a.sortOrder - b.sortOrder)
    return { date, weekday: date.getDay(), items }
  })
}
