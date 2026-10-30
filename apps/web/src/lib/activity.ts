// Actividades · Pilar B. El RITMO de la iglesia: definiciones recurrentes y la
// proyección de la semana. La iglesia piensa en ritmo, no en fechas.

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export type Freq = 'weekly' | 'monthly'
export type AudienceScope = 'all' | 'roles' | 'teams' | 'ages' // legado (lectura de filas antiguas)

// A quién va dirigida la actividad. Combinable: puede ir a roles Y equipos Y
// rangos de edad a la vez. `all` (toda la iglesia) es excluyente.
export interface Audience {
  all: boolean
  roleIds: string[]
  teamIds: string[]
  ageKeys: string[]
}
export const AUDIENCE_ALL: Audience = { all: true, roleIds: [], teamIds: [], ageKeys: [] }
export function audienceIsEmpty(a: Audience): boolean {
  return !a.roleIds.length && !a.teamIds.length && !a.ageKeys.length
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
  assignees: Assignee[] // encargados de la actividad (Capa 2)
  onDate: string | null // 'YYYY-MM-DD' → actividad de una sola fecha (recurrencia apagada); null = recurrente
  sortOrder: number
  enabled: boolean
}

// Catálogo editable de actividades internas (reusa activity_tags).
export interface Tag {
  id: string
  name: string
  color: string | null
  defaultDurationMin: number | null
}

// Capa 1: equipo participante de todo el servicio.
export interface ScheduleTeam {
  teamId: string
  delegate: boolean
  memberIds: string[]
}

// Encargado: un equipo o un rol (con miembros específicos opcionales) o una
// persona concreta (kind 'member', id = id del miembro).
export type AssigneeKind = 'team' | 'role' | 'member'
export interface Assignee {
  kind: AssigneeKind
  id: string
  memberIds: string[]
}

export function readAssignees(json: unknown): Assignee[] {
  if (!Array.isArray(json)) return []
  return json
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter((a) => (a.kind === 'team' || a.kind === 'role' || a.kind === 'member') && typeof a.id === 'string')
    .map((a) => ({ kind: a.kind as AssigneeKind, id: a.id as string, memberIds: Array.isArray(a.memberIds) ? (a.memberIds as string[]) : [] }))
}

// Capa 2: segmento de la línea de tiempo (no se solapa, va en orden).
export interface Segment {
  id?: string
  tagId: string | null
  name: string
  durationMin: number | null
  assignees: Assignee[] // uno o varios encargados
  pinned: boolean // fijada: no se mueve al arrastrar/reordenar
  level: number // 1 = principal; 2 y 3 = barras paralelas (simultáneas)
  color: string | null // color propio; si null usa el del tipo/catálogo
  startOffset: number // minutos desde el inicio del servicio (solo niveles 2/3; puede ser negativo)
}

// 'HH:MM' (o null) → minutos desde medianoche, o null.
export function clockToMin(time: string | null): number | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h)) return null
  return h * 60 + (m || 0)
}

// minutos desde medianoche → 'H:MM'
export function minToClock(total: number): string {
  const t = ((total % 1440) + 1440) % 1440
  const h = Math.floor(t / 60)
  const m = t % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

// Minutos entre inicio y fin del servicio (null si falta alguno o no es válido).
export function serviceMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const d = minutesOf(end) - minutesOf(start)
  return d > 0 ? d : null
}

// Plantilla reutilizable del ARREGLO de un servicio: equipos participantes +
// la línea de tiempo (actividades con duración y encargados). El pastor la usa
// para cualquier servicio y puede partir de ella para crear nuevos.
export interface TemplateSegment {
  tagId: string | null
  name: string
  durationMin: number | null
  assignees: Assignee[]
  pinned: boolean
  level: number
  color: string | null
  startOffset: number
}
export interface ActivityTemplate {
  name: string // etiqueta de la plantilla
  typeId: string | null
  teamIds: string[]
  segments: TemplateSegment[]
}
export function readActivityTemplates(settings: unknown): ActivityTemplate[] {
  const s = (settings ?? {}) as { activity_templates?: unknown }
  if (!Array.isArray(s.activity_templates)) return []
  return s.activity_templates
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof t.name === 'string' && !!t.name)
    .map((t) => ({
      name: t.name as string,
      typeId: (t.typeId as string) ?? null,
      teamIds: Array.isArray(t.teamIds) ? (t.teamIds as string[]) : [],
      segments: Array.isArray(t.segments)
        ? (t.segments as Record<string, unknown>[]).map((s) => ({
            tagId: (s.tagId as string) ?? null,
            name: String(s.name ?? ''),
            durationMin: typeof s.durationMin === 'number' ? s.durationMin : null,
            assignees: readAssignees(s.assignees),
            pinned: !!s.pinned,
            level: typeof s.level === 'number' ? s.level : 1,
            color: typeof s.color === 'string' ? s.color : null,
            startOffset: typeof s.startOffset === 'number' ? s.startOffset : 0,
          }))
        : [],
    }))
}

// Lee la audiencia de una fila. Acepta el formato NUEVO (all/roleIds/teamIds/
// ageKeys) y el LEGADO (scope + ids/keys) de filas creadas antes.
export function readAudience(json: unknown): Audience {
  const a = (json ?? {}) as Record<string, unknown>
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [])
  if ('all' in a || 'roleIds' in a || 'teamIds' in a || 'ageKeys' in a) {
    const roleIds = arr(a.roleIds), teamIds = arr(a.teamIds), ageKeys = arr(a.ageKeys)
    const all = a.all === true || (!roleIds.length && !teamIds.length && !ageKeys.length)
    return { all, roleIds, teamIds, ageKeys }
  }
  // legado: scope único + ids/keys
  const ids = arr(a.ids), keys = arr(a.keys)
  if (a.scope === 'roles') return { all: false, roleIds: ids, teamIds: [], ageKeys: [] }
  if (a.scope === 'teams') return { all: false, roleIds: [], teamIds: ids, ageKeys: [] }
  if (a.scope === 'ages') return { all: false, roleIds: [], teamIds: [], ageKeys: keys }
  return { ...AUDIENCE_ALL }
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

// ¿La actividad ocurre en esta fecha? (una sola fecha si onDate; si no, recurrente)
export function occursOn(s: Schedule, date: Date): boolean {
  if (!s.enabled) return false
  if (s.onDate) {
    const [y, m, d] = s.onDate.split('-').map(Number)
    return date.getFullYear() === y && date.getMonth() === (m || 1) - 1 && date.getDate() === d
  }
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
