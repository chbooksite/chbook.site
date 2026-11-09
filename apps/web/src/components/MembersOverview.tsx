import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { displayAgeRange, readAgeRanges, DEFAULT_AGE_RANGES, type AgeRangeDef } from '../lib/member'

// Base de SEGMENTACIÓN de personas (Pilar A) para el panel: totales + desglose por
// estado, bautismo, género, edad, roles y equipos. Vista por defecto en BARRAS
// (simple de leer); al seleccionar una tarjeta se AMPLÍA y muestra un donut que
// compara cada sección con el TOTAL de la iglesia (p. ej. qué % está en Danza).

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
interface Item { label: string; value: number; color?: string }

// En las métricas no cuentan archivados ni los que están en cambio de membresía.
const counted = (s: string) => s !== 'archived' && s !== 'cambio_membresia'

// Paleta de DATOS: apagada y cohesionada (verde de marca + acentos suaves + grises).
// El color va en los datos, NO en los fondos de las tarjetas (que son neutros).
const C = {
  green: '#5CA27B', // marca / positivo
  slate: '#7E9AB8', // azul apagado
  rose:  '#C2919E', // rosa apagado
  gold:  '#B9A36B', // ocre apagado
  lilac: '#9E8FB5', // lila apagado
  gray:  '#9A9C97', // gris medio
  grayL: '#CFD0CC', // gris claro
}
// Orden categórico fijo para el donut (distinguible pero sin saturar).
const PIE = [C.green, C.slate, C.rose, C.gold, C.lilac, C.gray]
const OTHER_COLOR = C.grayL

// --- Vistas de contenido (sin tarjeta propia; la tarjeta la pone <Card>) ---

// Barra apilada (partes de un todo) + leyenda con conteo y %.
function Stacked({ parts, total }: { parts: Item[]; total: number }) {
  const sum = total || parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-cream">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <div key={i} style={{ width: `${(p.value / sum) * 100}%`, backgroundColor: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {parts.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="truncate text-graysage">{p.label}</span>
            <span className="ml-auto font-medium tabular-nums text-charcoal">{p.value}</span>
            <span className="w-9 text-right tabular-nums text-graysage">{Math.round((p.value / sum) * 100)}%</span>
          </div>
        ))}
      </div>
    </>
  )
}

// Lista de categorías con barra de magnitud. El `accent` lo decide la tarjeta (cada
// desglose tiene su propio color), así no todo es verde.
function Bars({ items, accent = '#5CA27B', empty = 'Sin datos' }: { items: Item[]; accent?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <p className="py-2 text-xs text-graysage/60">{empty}</p>
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-graysage" title={it.label}>{it.label}</span>
          <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-cream">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: accent }} />
          </span>
          <span className="w-7 text-right font-medium tabular-nums text-charcoal">{it.value}</span>
        </div>
      ))}
    </div>
  )
}

// Donut: cada porción comparada con el TOTAL de la iglesia (leyenda = % de la iglesia).
function DonutView({ items, total }: { items: Item[]; total: number }) {
  let data = [...items].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  let otherColor = false
  if (data.length > 6) { const top = data.slice(0, 5); const rest = data.slice(5); top.push({ label: 'Otros', value: rest.reduce((a, x) => a + x.value, 0) }); data = top; otherColor = true }
  const sum = data.reduce((a, x) => a + x.value, 0) || 1
  const R = 42, SW = 15, C = 2 * Math.PI * R
  const colorAt = (i: number) => (otherColor && i === data.length - 1 ? OTHER_COLOR : PIE[i % PIE.length])
  let acc = 0
  if (data.length === 0) return <p className="py-2 text-xs text-graysage/60">Sin datos</p>
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#EFEFEE" strokeWidth={SW} />
        {data.map((d, i) => {
          const frac = d.value / sum
          const dash = Math.max(0, frac * C - 2)
          const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={colorAt(i)} strokeWidth={SW} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} />
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
  )
}

// Tarjeta de desglose: barras por defecto. Al pasar el cursor se AMPLÍA (con
// movimiento suave) y muestra el donut (% de cada sección respecto a la iglesia);
// al hacer clic queda SELECCIONADA (fijada) hasta tocar fuera. Mientras una está
// activa, las DEMÁS se reducen para dar foco. El alto del donut se anima con el
// truco de grid-rows 0fr↔1fr (suave tanto al ampliar como al reducir).
function Card({ id, title, items, total, caption, open, reduced, tint = 'bg-white', spanCls = '', onSelect, onHover, children }: { id: string; title: string; items: Item[]; total: number; caption?: string; open: boolean; reduced: boolean; tint?: string; spanCls?: string; onSelect: (id: string) => void; onHover: (id: string | null) => void; children: ReactNode }) {
  return (
    <div
      data-seg-card
      onClick={() => onSelect(id)}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      className={`${spanCls} cursor-pointer rounded-2xl p-4 shadow-[0_10px_26px_-16px_rgba(0,0,0,0.3)] ring-1 transition-all duration-300 ease-out ${tint} ${open ? 'shadow-xl ring-charcoal/15' : 'ring-black/5'} ${reduced ? 'scale-[0.97] opacity-55' : 'scale-100 opacity-100'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-charcoal">{title}</span>
        <span className={`shrink-0 text-xs text-charcoal/55 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}>% de la iglesia</span>
      </div>
      <div className="mt-2.5">{children}</div>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-black/5 pt-3"><DonutView items={items} total={total} /></div>
        </div>
      </div>
      {caption && <p className="mt-2.5 text-xs text-graysage/80">{caption}</p>}
    </div>
  )
}

// Tarjeta KPI. `strong` = relleno verde fuerte con acabado brillante (reflejo);
// `tint` = fondo pastel suave. Así las métricas no son todas iguales.
function Kpi({ label, value, sub, strong, tint }: { label: string; value: string | number; sub?: string; strong?: boolean; tint?: string }) {
  if (strong) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sage-dark to-sage p-5 shadow-[0_16px_34px_-14px_rgba(92,162,123,0.75)] ring-1 ring-white/20">
        <span className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/25 blur-xl" aria-hidden />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" aria-hidden />
        <div className="relative">
          <p className="font-serif text-4xl font-semibold text-white tabular-nums">{value}</p>
          <p className="mt-0.5 text-sm font-medium text-white/90">{label}</p>
          {sub && <p className="text-xs text-white/70">{sub}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className={`rounded-2xl p-5 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.22)] ring-1 ring-black/5 ${tint ?? 'bg-white'}`}>
      <p className="font-serif text-4xl font-semibold text-charcoal tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm text-graysage">{label}</p>
      {sub && <p className="text-xs text-graysage/70">{sub}</p>}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { active: 'Activos', inactive: 'Inactivos', prospect: 'Prospectos' }
const STATUS_COLOR: Record<string, string> = { active: C.green, inactive: C.gray, prospect: C.grayL }
const SEX_LABEL: Record<string, string> = { M: 'Hombres', masculino: 'Hombres', F: 'Mujeres', femenino: 'Mujeres' }

export default function MembersOverview({ churchId, avgAttendance = 0 }: { churchId: string; avgAttendance?: number }) {
  const [members, setMembers] = useState<M[] | null>(null)
  const [roles, setRoles] = useState<Cat[]>([])
  const [teams, setTeams] = useState<Cat[]>([])
  const [ageRanges, setAgeRanges] = useState<AgeRangeDef[]>(DEFAULT_AGE_RANGES)
  // Tarjeta fijada (clic) + tarjeta bajo el cursor. La activa se amplía; las demás
  // se reducen. Un clic fuera de cualquier tarjeta suelta la fijada.
  const [selected, setSelected] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-seg-card]')) setSelected(null) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

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

    const byStatus: Item[] = ['active', 'inactive', 'prospect'].map((s) => ({ label: STATUS_LABEL[s], value: list.filter((m) => m.status === s).length, color: STATUS_COLOR[s] }))
    const baptism: Item[] = [
      { label: 'Bautizados', value: baptized, color: C.green },
      { label: 'No bautizados', value: total - baptized, color: C.grayL },
    ]
    const sexNorm = (s: string | null) => (s ? (SEX_LABEL[s] ?? SEX_LABEL[s.toLowerCase()] ?? null) : null)
    const men = list.filter((m) => sexNorm(m.sex) === 'Hombres').length
    const women = list.filter((m) => sexNorm(m.sex) === 'Mujeres').length
    const sex: Item[] = [
      { label: 'Hombres', value: men, color: C.slate },
      { label: 'Mujeres', value: women, color: C.rose },
      { label: 'Sin dato', value: total - men - women, color: C.grayL },
    ]

    const ageCount = new Map<string, number>()
    for (const m of list) { const r = displayAgeRange(m.birthDate, m.ageGroup, ageRanges) ?? 'Sin dato'; ageCount.set(r, (ageCount.get(r) ?? 0) + 1) }
    const byAge: Item[] = [...ageRanges.map((r) => ({ label: r.name, value: ageCount.get(r.name) ?? 0 })), { label: 'Sin dato', value: ageCount.get('Sin dato') ?? 0 }].filter((x) => x.value > 0)

    const byRole: Item[] = roles.map((r) => ({ label: r.name, value: list.filter((m) => m.roleIds.includes(r.id)).length })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value)
    const byTeam: Item[] = teams.map((t) => ({ label: t.name, value: list.filter((m) => m.teamIds.includes(t.id)).length })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value)

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Miembros" value={seg.total} strong />
        <Kpi label="Activos" value={seg.active} sub={`${pct(seg.active)}% del total`} />
        <Kpi label="Bautizados" value={seg.baptized} sub={`${pct(seg.baptized)}% del total`} />
        <Kpi label="Asistencia prom." value={avgAttendance} sub="últimos 4 cultos" />
      </div>

      <div className="pt-1">
        <h3 className="font-serif text-lg font-semibold text-charcoal">Desglose de la congregación</h3>
        <p className="text-sm text-graysage">Pasa el cursor por una tarjeta para ver su proporción respecto a la iglesia.</p>
      </div>

      {/* Bento: tamaños variados (tercios · mitades · ancho completo) y un tinte
          pastel distinto por tarjeta, para dar personalidad sin perder la base. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        {([
          { id: 'estado', title: 'Por estado', items: seg.byStatus, tint: 'bg-white', span: 'md:col-span-2', body: <Stacked parts={seg.byStatus} total={seg.total} /> },
          { id: 'bautismo', title: 'Bautismo', items: seg.baptism, tint: 'bg-white', span: 'md:col-span-2', body: <Stacked parts={seg.baptism} total={seg.total} /> },
          { id: 'genero', title: 'Por género', items: seg.sex, tint: 'bg-white', span: 'md:col-span-2', body: <Stacked parts={seg.sex} total={seg.total} /> },
          { id: 'edad', title: 'Por edad', items: seg.byAge, tint: 'bg-sage-light/45', span: 'md:col-span-3', body: <Bars items={seg.byAge} accent={C.green} empty="Sin fechas de nacimiento" /> },
          { id: 'rol', title: 'Por rol', items: seg.byRole, tint: 'bg-sage-light/45', span: 'md:col-span-3', caption: `${seg.inAnyRole} de ${seg.total} con algún rol (${pct(seg.inAnyRole)}%)`, body: <Bars items={seg.byRole} accent={C.green} empty="Nadie con rol asignado" /> },
          { id: 'equipo', title: 'Por equipo', items: seg.byTeam, tint: 'bg-sage-light/55', span: 'md:col-span-6', caption: `${seg.inAnyTeam} de ${seg.total} en algún equipo (${pct(seg.inAnyTeam)}%)`, body: <Bars items={seg.byTeam} accent={C.green} empty="Nadie en equipos" /> },
        ] as { id: string; title: string; items: Item[]; tint: string; span: string; caption?: string; body: ReactNode }[]).map((c) => {
          const focused = hoverId === c.id || selected === c.id
          const reduced = (hoverId !== null || selected !== null) && !focused
          return <Card key={c.id} id={c.id} title={c.title} items={c.items} total={seg.total} caption={c.caption} tint={c.tint} spanCls={c.span} open={focused} reduced={reduced} onSelect={setSelected} onHover={setHoverId}>{c.body}</Card>
        })}
      </div>
    </div>
  )
}
