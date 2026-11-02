// Indicadores del Dashboard: lo que de verdad le dice al pastor cómo está su
// iglesia. Cálculo puro (sin consultas) a partir de miembros, equipos y los
// últimos cultos con su asistencia.

export interface InsightMember {
  id: string
  status: string | null
  is_baptized: boolean | null
  created_at: string | null
}

export interface InsightService {
  id: string
  name: string
  starts_at: string | null
  attendance: { member_id: string | null; type: string | null }[]
}

export interface Insights {
  members: number // miembros (sin prospectos ni archivados)
  prospects: number
  newThisMonth: number
  growth: { label: string; value: number }[] // miembros al cierre de cada mes (6)
  last: { name: string; total: number; presential: number; online: number } | null
  avgPrev: number | null // promedio de los cultos anteriores al último
  deltaPct: number | null // último vs promedio anterior
  // Constancia: vinieron a la mitad o más de los últimos cultos (máx. 4).
  regular: { count: number; pct: number; window: number } | null
  baptized: { count: number; pct: number }
  serving: { count: number; pct: number }
  leaders: number
}

const MONTH_FMT = new Intl.DateTimeFormat('es', { month: 'short' })
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0)

export function churchInsights(
  members: InsightMember[],
  teams: { member_id: string; is_leader: boolean | null }[],
  services: InsightService[], // del más antiguo al más reciente
  now = new Date(),
): Insights {
  const base = members.filter((m) => m.status !== 'archived' && m.status !== 'prospect')
  const ids = new Set(base.map((m) => m.id))
  const prospects = members.filter((m) => m.status === 'prospect').length

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const newThisMonth = base.filter((m) => m.created_at && new Date(m.created_at) >= monthStart).length
  const growth = Array.from({ length: 6 }, (_, k) => {
    const end = new Date(now.getFullYear(), now.getMonth() - 4 + k, 1)
    return {
      label: MONTH_FMT.format(new Date(end.getFullYear(), end.getMonth() - 1, 1)).replace('.', ''),
      value: base.filter((m) => !m.created_at || new Date(m.created_at) < end).length,
    }
  })

  const totals = services.map((s) => s.attendance.length)
  const lastSvc = services.at(-1)
  const last = lastSvc
    ? (() => {
        const online = lastSvc.attendance.filter((a) => a.type === 'online').length
        return { name: lastSvc.name, total: lastSvc.attendance.length, presential: lastSvc.attendance.length - online, online }
      })()
    : null
  const prev = totals.slice(0, -1)
  const avgPrev = prev.length ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : null
  const deltaPct = last && avgPrev ? Math.round(((last.total - avgPrev) / avgPrev) * 100) : null

  // Constancia sobre los últimos 4 cultos (necesita al menos 2 para tener sentido).
  const recent = services.slice(-4)
  let regular: Insights['regular'] = null
  if (recent.length >= 2 && base.length) {
    const seen = new Map<string, number>()
    for (const s of recent) {
      for (const id of new Set(s.attendance.map((a) => a.member_id).filter((x): x is string => !!x && ids.has(x)))) {
        seen.set(id, (seen.get(id) ?? 0) + 1)
      }
    }
    const need = Math.ceil(recent.length / 2)
    const count = [...seen.values()].filter((n) => n >= need).length
    regular = { count, pct: pct(count, base.length), window: recent.length }
  }

  const servingIds = new Set(teams.filter((t) => ids.has(t.member_id)).map((t) => t.member_id))
  const leaderIds = new Set(teams.filter((t) => t.is_leader && ids.has(t.member_id)).map((t) => t.member_id))
  const baptized = base.filter((m) => m.is_baptized).length

  return {
    members: base.length,
    prospects,
    newThisMonth,
    growth,
    last,
    avgPrev,
    deltaPct,
    regular,
    baptized: { count: baptized, pct: pct(baptized, base.length) },
    serving: { count: servingIds.size, pct: pct(servingIds.size, base.length) },
    leaders: leaderIds.size,
  }
}
