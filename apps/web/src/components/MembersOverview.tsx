import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayAgeRange, readAgeRanges, DEFAULT_AGE_RANGES, type AgeRangeDef } from '../lib/member'

// Base de SEGMENTACIÓN de personas (Pilar A) para el panel: totales + desglose por
// estado, bautismo, género, edad, roles y equipos. Las personas son el "activo"
// central, así que el dashboard las mide y agrupa en lugar de ingresos/egresos.

interface Cat { id: string; name: string }
interface M {
  status: string
  sex: string | null
  isBaptized: boolean
  birthDate: string | null
  ageGroup: string | null
  roleIds: string[]
  teamIds: string[]
}
interface RawMember {
  status: string
  sex: string | null
  is_baptized: boolean
  birth_date: string | null
  age_group: string | null
  member_roles: { role_id: string }[] | null
  member_teams: { team_id: string }[] | null
}

// En las métricas no cuentan archivados ni los que están en cambio de membresía.
const counted = (s: string) => s !== 'archived' && s !== 'cambio_membresia'

// Una barra apilada (partes de un todo) + leyenda con conteo y %.
function SegBar({ title, parts }: { title: string; parts: { label: string; value: number; cls: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-2.5 text-sm font-medium text-charcoal">{title}</p>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-cream">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <div key={i} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {parts.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${p.cls}`} />
            <span className="truncate text-graysage">{p.label}</span>
            <span className="ml-auto font-medium tabular-nums text-charcoal">{p.value}</span>
            <span className="w-9 text-right tabular-nums text-graysage">{Math.round((p.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Orden categórico fijo (paleta de marca). Hex directo para el SVG y la leyenda,
// así no dependemos de que Tailwind genere clases stroke-*. Se asignan en orden,
// nunca se ciclan: una 7.ª categoría cae en "Otros".
const PIE = ['#5CA27B', '#B5897A', '#9DA99B', '#E0CCBE', '#88C0A4', '#7E807B']
const OTHER_COLOR = '#C4DFD2'

// Gráfico de TORTA (donut): proporción de cada categoría respecto a la iglesia.
// El ángulo va por el tamaño relativo entre categorías; la leyenda muestra el
// conteo y el % de la iglesia. `caption` añade la cobertura (p. ej. en equipos).
function Donut({ title, items, total, caption, empty = 'Sin datos' }: { title: string; items: { label: string; value: number }[]; total: number; caption?: string; empty?: string }) {
  let data = [...items].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  let otherColor = false
  if (data.length > 6) { const top = data.slice(0, 5); const rest = data.slice(5); top.push({ label: 'Otros', value: rest.reduce((a, x) => a + x.value, 0) }); data = top; otherColor = true }
  const sum = data.reduce((a, x) => a + x.value, 0) || 1
  const R = 42, SW = 15, C = 2 * Math.PI * R
  const colorAt = (i: number) => (otherColor && i === data.length - 1 ? OTHER_COLOR : PIE[i % PIE.length])
  let acc = 0
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-2.5 text-sm font-medium text-charcoal">{title}</p>
      {data.length === 0 ? (
        <p className="py-4 text-xs text-graysage/60">{empty}</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" stroke="#EFEFEE" strokeWidth={SW} />
            {data.map((d, i) => {
              const frac = d.value / sum
              const dash = Math.max(0, frac * C - 2) // 2px de separación entre porciones
              const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={colorAt(i)} strokeWidth={SW} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} strokeLinecap="butt" />
              acc += frac
              return el
            })}
          </svg>
          <div className="min-w-0 flex-1 space-y-1">
            {data.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorAt(i) }} />
                <span className="truncate text-graysage" title={d.label}>{d.label}</span>
                <span className="ml-auto font-medium tabular-nums text-charcoal">{d.value}</span>
                <span className="w-9 text-right tabular-nums text-graysage">{Math.round((d.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {caption && <p className="mt-2.5 text-xs text-graysage/80">{caption}</p>}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="font-serif text-3xl font-semibold text-sage-dark tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm text-graysage">{label}</p>
      {sub && <p className="text-xs text-graysage/70">{sub}</p>}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { active: 'Activos', inactive: 'Inactivos', prospect: 'Prospectos' }
const STATUS_CLS: Record<string, string> = { active: 'bg-sage-dark', inactive: 'bg-graysage/60', prospect: 'bg-gold' }
const SEX_LABEL: Record<string, string> = { M: 'Hombres', masculino: 'Hombres', F: 'Mujeres', femenino: 'Mujeres' }

export default function MembersOverview({ churchId, avgAttendance = 0 }: { churchId: string; avgAttendance?: number }) {
  const [members, setMembers] = useState<M[] | null>(null)
  const [roles, setRoles] = useState<Cat[]>([])
  const [teams, setTeams] = useState<Cat[]>([])
  const [ageRanges, setAgeRanges] = useState<AgeRangeDef[]>(DEFAULT_AGE_RANGES)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [rolesRes, teamsRes, membersRes, churchRes] = await Promise.all([
        supabase.from('roles').select('id, name').order('name'),
        supabase.from('teams').select('id, name').order('name'),
        supabase.from('members').select('status, sex, is_baptized, birth_date, age_group, member_roles(role_id), member_teams(team_id)'),
        supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
      ])
      if (!alive) return
      setRoles((rolesRes.data ?? []) as Cat[])
      setTeams((teamsRes.data ?? []) as Cat[])
      setAgeRanges(readAgeRanges(churchRes.data?.settings))
      setMembers(
        ((membersRes.data ?? []) as unknown as RawMember[]).map((m) => ({
          status: m.status,
          sex: m.sex,
          isBaptized: Boolean(m.is_baptized),
          birthDate: m.birth_date,
          ageGroup: m.age_group,
          roleIds: (m.member_roles ?? []).map((r) => r.role_id),
          teamIds: (m.member_teams ?? []).map((t) => t.team_id),
        })),
      )
    })()
    return () => { alive = false }
  }, [churchId])

  const seg = useMemo(() => {
    const list = (members ?? []).filter((m) => counted(m.status))
    const total = list.length
    const active = list.filter((m) => m.status === 'active').length
    const baptized = list.filter((m) => m.isBaptized).length

    const byStatus = ['active', 'inactive', 'prospect'].map((s) => ({ label: STATUS_LABEL[s], value: list.filter((m) => m.status === s).length, cls: STATUS_CLS[s] }))
    const baptism = [
      { label: 'Bautizados', value: baptized, cls: 'bg-sage-dark' },
      { label: 'No bautizados', value: total - baptized, cls: 'bg-sand' },
    ]
    const sexNorm = (s: string | null) => (s ? (SEX_LABEL[s] ?? SEX_LABEL[s.toLowerCase()] ?? null) : null)
    const men = list.filter((m) => sexNorm(m.sex) === 'Hombres').length
    const women = list.filter((m) => sexNorm(m.sex) === 'Mujeres').length
    const sex = [
      { label: 'Hombres', value: men, cls: 'bg-sage-dark' },
      { label: 'Mujeres', value: women, cls: 'bg-clay' },
      { label: 'Sin dato', value: total - men - women, cls: 'bg-graysage/40' },
    ]

    // Por edad: en el orden de los rangos configurados + "Sin dato".
    const ageCount = new Map<string, number>()
    for (const m of list) { const r = displayAgeRange(m.birthDate, m.ageGroup, ageRanges) ?? 'Sin dato'; ageCount.set(r, (ageCount.get(r) ?? 0) + 1) }
    const byAge = [...ageRanges.map((r) => ({ label: r.name, value: ageCount.get(r.name) ?? 0 })), { label: 'Sin dato', value: ageCount.get('Sin dato') ?? 0 }].filter((x) => x.value > 0)

    const byRole = roles
      .map((r) => ({ label: r.name, value: list.filter((m) => m.roleIds.includes(r.id)).length }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
    const byTeam = teams
      .map((t) => ({ label: t.name, value: list.filter((m) => m.teamIds.includes(t.id)).length }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)

    const inAnyTeam = list.filter((m) => m.teamIds.length > 0).length
    const inAnyRole = list.filter((m) => m.roleIds.length > 0).length

    return { total, active, baptized, byStatus, baptism, sex, byAge, byRole, byTeam, inAnyTeam, inAnyRole }
  }, [members, roles, teams, ageRanges])

  if (members === null) {
    return <p className="py-8 text-center text-sm text-graysage">Cargando personas…</p>
  }

  const pct = (n: number) => (seg.total ? Math.round((n / seg.total) * 100) : 0)

  return (
    <div className="space-y-4">
      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Miembros" value={seg.total} />
        <Kpi label="Activos" value={seg.active} sub={`${pct(seg.active)}% del total`} />
        <Kpi label="Bautizados" value={seg.baptized} sub={`${pct(seg.baptized)}% del total`} />
        <Kpi label="Asistencia prom." value={avgAttendance} sub="últimos 4 cultos" />
      </div>

      {/* Desglose */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SegBar title="Por estado" parts={seg.byStatus} />
        <SegBar title="Bautismo" parts={seg.baptism} />
        <SegBar title="Por género" parts={seg.sex} />
        <Donut title="Por edad" items={seg.byAge} total={seg.total} empty="Sin fechas de nacimiento" />
        <Donut title="Por equipo" items={seg.byTeam} total={seg.total} caption={`${seg.inAnyTeam} de ${seg.total} en algún equipo (${pct(seg.inAnyTeam)}%)`} empty="Nadie en equipos" />
        <Donut title="Por rol" items={seg.byRole} total={seg.total} caption={`${seg.inAnyRole} de ${seg.total} con algún rol (${pct(seg.inAnyRole)}%)`} empty="Nadie con rol asignado" />
      </div>
    </div>
  )
}
