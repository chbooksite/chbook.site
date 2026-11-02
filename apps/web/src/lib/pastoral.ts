// "Esta semana": lo que un pastor quiere saber de su gente de un vistazo.
// Cálculo puro a partir de miembros y asistencias (sin consultas aquí).

export interface PastoralMember {
  id: string
  full_name: string
  birth_date: string | null
  status: string | null
  created_at: string | null
}

export interface PastoralAttendance {
  member_id: string | null
  checked_at: string | null
}

export interface WeekItem {
  id: string
  name: string
  note: string
}

export interface PastoralWeek {
  birthdays: WeekItem[]
  prospects: WeekItem[]
  absent: WeekItem[]
  // false si la iglesia aún no registra asistencia (no se puede saber quién falta)
  tracksAttendance: boolean
}

const DAY = 86400000
export const ABSENT_DAYS = 21 // tres semanas sin venir
export const ATTENDANCE_WINDOW_DAYS = 90 // ventana de asistencias que se consulta

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const WEEKDAY = new Intl.DateTimeFormat('es', { weekday: 'long' })

export function pastoralWeek(members: PastoralMember[], attendance: PastoralAttendance[], now = new Date()): PastoralWeek {
  const today = startOfDay(now)
  const present = members.filter((m) => m.status !== 'archived')

  // Cumpleaños en los próximos 7 días (hoy incluido).
  const birthdays: (WeekItem & { inDays: number })[] = []
  for (const m of present) {
    if (!m.birth_date) continue
    const [y, mo, d] = m.birth_date.split('-').map(Number)
    if (!y || !mo || !d) continue
    let next = new Date(today.getFullYear(), mo - 1, d)
    if (next < today) next = new Date(today.getFullYear() + 1, mo - 1, d)
    const inDays = Math.round((next.getTime() - today.getTime()) / DAY)
    if (inDays > 6) continue
    const turns = next.getFullYear() - y
    const when = inDays === 0 ? 'Hoy' : inDays === 1 ? 'Mañana' : WEEKDAY.format(next).replace(/^./, (c) => c.toUpperCase())
    birthdays.push({ id: m.id, name: m.full_name, note: `${when} · cumple ${turns}`, inDays })
  }
  birthdays.sort((a, b) => a.inDays - b.inDays)

  // Prospectos por aprobar (los más recientes primero).
  const prospects = present
    .filter((m) => m.status === 'prospect')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .map((m) => {
      const days = m.created_at ? Math.max(0, Math.round((today.getTime() - startOfDay(new Date(m.created_at)).getTime()) / DAY)) : null
      return { id: m.id, name: m.full_name, note: days == null ? 'Por aprobar' : days === 0 ? 'Llegó hoy' : `Hace ${days} ${days === 1 ? 'día' : 'días'}` }
    })

  // Hace tiempo sin venir: miembros activos que asistieron en la ventana pero
  // no en las últimas 3 semanas. Quien nunca asistió no se marca (sería ruido).
  const last = new Map<string, number>()
  for (const a of attendance) {
    if (!a.member_id || !a.checked_at) continue
    const t = new Date(a.checked_at).getTime()
    if (t > (last.get(a.member_id) ?? 0)) last.set(a.member_id, t)
  }
  const absent = present
    .filter((m) => (m.status ?? 'active') === 'active' && last.has(m.id))
    .map((m) => ({ m, days: Math.floor((now.getTime() - last.get(m.id)!) / DAY) }))
    .filter((x) => x.days >= ABSENT_DAYS)
    .sort((a, b) => b.days - a.days)
    .map(({ m, days }) => ({ id: m.id, name: m.full_name, note: `Hace ${Math.floor(days / 7)} semanas` }))

  return { birthdays, prospects, absent, tracksAttendance: attendance.length > 0 }
}
