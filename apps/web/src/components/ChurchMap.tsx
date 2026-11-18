import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../lib/supabase'
import { readAgeRanges, type AgeRangeDef } from '../lib/member'
import { readAudience, audienceIsEmpty } from '../lib/activity'
import { flockMemberIds, memberAgeKey, FLOCK_ROLE_KEYS, type Flock, type FlockMember } from '../lib/flock'

// Sección MAPA DE LA IGLESIA. Auditorio tipo mapa de asientos: cada asiento = un
// miembro activo. Los bloques = rangos de edad (compactos, mismo ancho y mismo
// orden de color; el más numeroso al centro y al frente, pegado al altar; el
// resto a los lados equilibrados). Tres modos:
//  · EQUIPOS    → color = equipo; aro = miembro de un equipo sin asistir ≥1 mes.
//  · COBERTURA  → color = líder cercano (líderes de equipo + ovejas).
//  · ASISTENCIA → elige una actividad; presente (relleno) vs ausente (tenue).
// En equipos/cobertura: 2+ grupos = "Varios"; ninguno = gris. Seleccionar un
// grupo atenúa los demás y deja ver su proporción por edades.

const PALETTE = ['#2a78d6', '#1baf7a', '#eb6834', '#e34949', '#eda100', '#6250d6', '#0f8a8a', '#b5651d', '#c2185b', '#558b2f', '#7b5e57', '#00897b']
const VARIOS = '#8e7cc3'
const SIN = '#c7c9cd'
const PRESENT = '#1baf7a'
const ABSENT = '#d9dbde'
const INACTIVE_MS = 30 * 24 * 60 * 60 * 1000

interface M { id: string; ageKey: string | null; sex: string | null; baptized: boolean }
interface Group { key: string; name: string; color: string; count: number }
interface Occ { id: string; label: string; at: number }
type Mode = 'equipos' | 'cobertura' | 'asistencia' | 'bautismo' | 'sexo' | 'edad'

export default function ChurchMap({ churchId, mode: modeProp, occId: occIdProp, highlight }: { churchId: string; mode?: Mode; occId?: string | null; highlight?: string | null }) {
  const [mode, setMode] = useState<Mode>(modeProp ?? 'equipos')
  const [sel, setSel] = useState<string | null>(null)
  const [occId, setOccId] = useState<string>('')
  const [data, setData] = useState<{
    members: M[]
    ranges: AgeRangeDef[]
    teamName: Map<string, string>
    leaderName: Map<string, string>
    memberTeams: Map<string, string[]>
    memberLeaders: Map<string, string[]>
    inactive: Set<string>
    occurrences: Occ[]
    attBySvc: Map<string, Set<string>>
  } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [memRes, mtRes, teamRes, mrRes, roleRes, flockRes, churchRes, svcRes] = await Promise.all([
        supabase.from('members').select('id, full_name, status, sex, is_baptized, birth_date, age_group'),
        supabase.from('member_teams').select('member_id, team_id, is_leader'),
        supabase.from('teams').select('id, name'),
        supabase.from('member_roles').select('member_id, role_id'),
        supabase.from('roles').select('id, key'),
        supabase.from('leader_flock').select('member_id, audience, manual_member_ids'),
        supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
        supabase.from('service_attendance').select('service_id, starts_at, activity_name, service_name'),
      ])
      const att = await fetchAll<{ member_id: string; service_id: string }>(() => supabase.from('attendance').select('member_id, service_id'))
      if (!alive) return
      const ranges = readAgeRanges(churchRes.data?.settings)
      const roleKeyById = new Map(((roleRes.data ?? []) as { id: string; key: string }[]).map((r) => [r.id, r.key]))
      const teamName = new Map(((teamRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]))

      const memberName = new Map<string, string>()
      const universe: FlockMember[] = []
      const active = new Set<string>()
      const memberRoleIds = new Map<string, Set<string>>()
      const memberTeamsSet = new Map<string, Set<string>>()
      const memberTeams = new Map<string, string[]>()
      const teamMembers = new Map<string, Set<string>>()
      const memberLedTeams = new Map<string, string[]>()

      for (const m of (memRes.data ?? []) as { id: string; full_name: string; status: string; sex: string | null; is_baptized: boolean | null; birth_date: string | null; age_group: string | null }[]) {
        memberName.set(m.id, m.full_name)
        if (m.status === 'archived' || m.status === 'cambio_membresia') continue
        active.add(m.id)
        universe.push({ id: m.id, sex: m.sex, is_baptized: m.is_baptized, birth_date: m.birth_date, age_group: m.age_group, roleIds: new Set(), teamIds: new Set() })
      }
      for (const r of (mrRes.data ?? []) as { member_id: string; role_id: string }[]) {
        const s = memberRoleIds.get(r.member_id) ?? new Set<string>(); s.add(r.role_id); memberRoleIds.set(r.member_id, s)
      }
      for (const r of (mtRes.data ?? []) as { member_id: string; team_id: string; is_leader: boolean }[]) {
        const tm = teamMembers.get(r.team_id) ?? new Set<string>(); tm.add(r.member_id); teamMembers.set(r.team_id, tm)
        const ms = memberTeamsSet.get(r.member_id) ?? new Set<string>(); ms.add(r.team_id); memberTeamsSet.set(r.member_id, ms)
        if (r.is_leader) { const a = memberLedTeams.get(r.member_id) ?? []; a.push(r.team_id); memberLedTeams.set(r.member_id, a) }
      }
      for (const u of universe) { u.roleIds = memberRoleIds.get(u.id) ?? new Set(); u.teamIds = memberTeamsSet.get(u.id) ?? new Set() }
      for (const [mid, set] of memberTeamsSet) memberTeams.set(mid, [...set])

      // COBERTURA: líder cercano = líderes de equipo (sobre sus integrantes) ∪
      // líderes con ovejas explícitas (segmento no "toda la iglesia").
      const flockByLeader = new Map<string, Flock>()
      for (const r of (flockRes.data ?? []) as { member_id: string; audience: unknown; manual_member_ids: string[] | null }[]) {
        flockByLeader.set(r.member_id, { audience: readAudience(r.audience), manual: r.manual_member_ids ?? [] })
      }
      const leaderName = new Map<string, string>()
      const memberLeadersSet = new Map<string, Set<string>>()
      const addCover = (leaderId: string, memberId: string) => {
        if (memberId === leaderId || !active.has(memberId)) return
        leaderName.set(leaderId, memberName.get(leaderId) ?? 'Líder')
        const s = memberLeadersSet.get(memberId) ?? new Set<string>(); s.add(leaderId); memberLeadersSet.set(memberId, s)
      }
      for (const [leaderId, teamIds] of memberLedTeams) for (const t of teamIds) for (const m of teamMembers.get(t) ?? []) addCover(leaderId, m)
      for (const [leaderId, flock] of flockByLeader) {
        const roleKeys = new Set([...(memberRoleIds.get(leaderId) ?? [])].map((rid) => roleKeyById.get(rid)))
        if (!FLOCK_ROLE_KEYS.some((k) => roleKeys.has(k))) continue
        if (flock.audience.all || (audienceIsEmpty(flock.audience) && !flock.manual.length)) continue
        for (const m of flockMemberIds(leaderId, flock, universe, ranges)) addCover(leaderId, m)
      }
      const memberLeaders = new Map<string, string[]>()
      for (const [mid, set] of memberLeadersSet) memberLeaders.set(mid, [...set])

      // Asistencia por servicio + última asistencia por miembro.
      const svcDate = new Map<string, number>()
      const occurrences: Occ[] = []
      for (const s of (svcRes.data ?? []) as { service_id: string; starts_at: string | null; activity_name: string | null; service_name: string | null }[]) {
        if (!s.starts_at) continue
        const at = new Date(s.starts_at).getTime(); svcDate.set(s.service_id, at)
        occurrences.push({ id: s.service_id, at, label: `${s.activity_name ?? s.service_name ?? 'Actividad'} · ${new Date(s.starts_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}` })
      }
      occurrences.sort((a, b) => b.at - a.at)
      const attBySvc = new Map<string, Set<string>>()
      const lastAtt = new Map<string, number>()
      for (const a of att) {
        const set = attBySvc.get(a.service_id) ?? new Set<string>(); set.add(a.member_id); attBySvc.set(a.service_id, set)
        const d = svcDate.get(a.service_id); if (d && d > (lastAtt.get(a.member_id) ?? 0)) lastAtt.set(a.member_id, d)
      }
      const cutoff = Date.now() - INACTIVE_MS
      const inactive = new Set<string>()
      for (const [mid, teams] of memberTeams) if (teams.length && (lastAtt.get(mid) ?? 0) < cutoff) inactive.add(mid)

      const members: M[] = universe.map((u) => ({ id: u.id, ageKey: memberAgeKey(u, ranges), sex: u.sex, baptized: !!u.is_baptized }))
      setData({ members, ranges, teamName, leaderName, memberTeams, memberLeaders, inactive, occurrences, attBySvc })
      // Default: la ocurrencia más concurrida (más representativa que la más reciente).
      let bestId = occurrences[0]?.id ?? '', bestN = -1
      for (const o of occurrences) { const n = attBySvc.get(o.id)?.size ?? 0; if (n > bestN) { bestN = n; bestId = o.id } }
      setOccId((prev) => prev || bestId)
    })()
    return () => { alive = false }
  }, [churchId])

  // Modo controlado por la sección visible del panel (sticky). Un clic manual en el
  // toggle lo cambia hasta que el scroll lleve a otra sección.
  useEffect(() => { if (modeProp) { setMode(modeProp); setSel(null) } }, [modeProp])
  // Ocurrencia controlada por la actividad elegida en la sección Actividades.
  useEffect(() => { if (occIdProp) setOccId(occIdProp) }, [occIdProp])
  // Grupo aislado controlado desde fuera (equipo/líder seleccionado en su sección).
  useEffect(() => { setSel(highlight ?? null) }, [highlight])

  const present = useMemo(() => (data ? data.attBySvc.get(occId) ?? new Set<string>() : new Set<string>()), [data, occId])

  // Grupo de cada miembro según el modo.
  const groupOf = useMemo(() => {
    if (!data) return (_: string) => '__sin__'
    if (mode === 'asistencia') return (id: string) => (present.has(id) ? '__present__' : '__absent__')
    if (mode === 'bautismo' || mode === 'sexo' || mode === 'edad') {
      const attr = new Map(data.members.map((m) => [m.id, m]))
      if (mode === 'bautismo') return (id: string) => (attr.get(id)?.baptized ? '__bapt__' : '__nobapt__')
      if (mode === 'sexo') return (id: string) => { const s = attr.get(id)?.sex; return s === 'masculino' ? '__m__' : s === 'femenino' ? '__f__' : '__nosex__' }
      return (id: string) => attr.get(id)?.ageKey ?? '__noage__'
    }
    const src = mode === 'equipos' ? data.memberTeams : data.memberLeaders
    return (id: string) => { const g = src.get(id) ?? []; return g.length === 0 ? '__sin__' : g.length === 1 ? g[0] : '__varios__' }
  }, [data, mode, present])

  const { groups, colorOf } = useMemo(() => {
    const empty = { groups: [] as Group[], colorOf: (_: string) => SIN, rankOf: (_: string) => 999 }
    if (!data) return empty
    const counts = new Map<string, number>()
    for (const m of data.members) { const g = groupOf(m.id); counts.set(g, (counts.get(g) ?? 0) + 1) }
    const build = (defs: [string, string, string][]) => {
      const color = new Map<string, string>(), rank = new Map<string, number>()
      defs.forEach(([k, , c], i) => { color.set(k, c); rank.set(k, i) })
      const groups: Group[] = defs.filter(([k]) => counts.get(k)).map(([k, name]) => ({ key: k, name, color: color.get(k)!, count: counts.get(k)! }))
      return { groups, colorOf: (k: string) => color.get(k) ?? SIN, rankOf: (k: string) => rank.get(k) ?? 999 }
    }
    if (mode === 'asistencia') return build([['__present__', 'Presentes', PRESENT], ['__absent__', 'Ausentes', ABSENT]])
    if (mode === 'bautismo') return build([['__bapt__', 'Bautizados', '#1baf7a'], ['__nobapt__', 'No bautizados', '#eb6834']])
    if (mode === 'sexo') return build([['__m__', 'Hombres', '#2a78d6'], ['__f__', 'Mujeres', '#e87ba4'], ['__nosex__', 'Sin dato', SIN]])
    if (mode === 'edad') return build([...data.ranges.filter((r) => r.enabled).map((r) => [r.key, r.name, r.color] as [string, string, string]), ['__noage__', 'Sin edad', SIN]])
    const nameOf = mode === 'equipos' ? data.teamName : data.leaderName
    const real = [...counts.entries()].filter(([k]) => k !== '__varios__' && k !== '__sin__').sort((a, b) => b[1] - a[1])
    const color = new Map<string, string>(); const rank = new Map<string, number>()
    real.forEach(([k], i) => { color.set(k, PALETTE[i % PALETTE.length]); rank.set(k, i) })
    color.set('__varios__', VARIOS); color.set('__sin__', SIN)
    rank.set('__varios__', real.length); rank.set('__sin__', real.length + 1)
    const groups: Group[] = real.map(([k]) => ({ key: k, name: nameOf.get(k) ?? '—', color: color.get(k)!, count: counts.get(k)! }))
    if (counts.get('__varios__')) groups.push({ key: '__varios__', name: mode === 'equipos' ? 'Varios equipos' : 'Varios líderes', color: VARIOS, count: counts.get('__varios__')! })
    groups.push({ key: '__sin__', name: mode === 'equipos' ? 'Sin equipo' : 'Sin líder', color: SIN, count: counts.get('__sin__') ?? 0 })
    return { groups, colorOf: (k: string) => color.get(k) ?? SIN, rankOf: (k: string) => rank.get(k) ?? 999 }
  }, [data, groupOf, mode])

  // Geometría MEDIA LUNA: altar al centro-derecha; las cuñas (grupos) se reparten
  // radialmente hacia la izquierda; el anillo exterior es la dona de EDADES.
  const art = useMemo(() => {
    if (!data) return null
    const cx = 150, cy = 160, innerR = 28, outerR = 126, dR0 = 132, dR1 = 150
    const A0 = Math.PI / 2, A1 = Math.PI * 1.5, span = A1 - A0
    const total = data.members.length || 1
    const polar = (r: number, a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    const idsByGroup = new Map<string, string[]>()
    for (const m of data.members) { const g = groupOf(m.id); const a = idsByGroup.get(g) ?? []; a.push(m.id); idsByGroup.set(g, a) }
    const ordered = groups.map((g) => g.key).filter((k) => idsByGroup.get(k)?.length)
    const seats: { id: string; x: number; y: number; g: string }[] = []
    const dr = 15, arcStep = 13.5, pad = 0.02
    let accA = A0
    for (const key of ordered) {
      const ids = idsByGroup.get(key)!
      const w = (ids.length / total) * span
      const a0 = accA + pad, a1 = accA + w - pad; accA += w
      const aw = Math.max(0.0001, a1 - a0)
      const maxRing = Math.max(0, Math.floor((outerR - innerR) / dr))
      let placed = 0
      for (let ring = 0; ring <= maxRing && placed < ids.length; ring++) {
        const r = innerR + ring * dr
        const cap = Math.max(1, Math.floor((r * aw) / arcStep))
        const take = Math.min(cap, ids.length - placed)
        for (let i = 0; i < take; i++) { const a = take === 1 ? (a0 + a1) / 2 : a0 + (i / (take - 1)) * aw; const [x, y] = polar(r, a); seats.push({ id: ids[placed++], x, y, g: key }) }
      }
      if (placed < ids.length) { const leftN = ids.length - placed; for (let i = 0; i < leftN; i++) { const a = a0 + ((i + 0.5) / leftN) * aw; const [x, y] = polar(outerR, a); seats.push({ id: ids[placed++], x, y, g: key }) } }
    }
    const sector = (r0: number, r1: number, s0: number, s1: number) => {
      const [ax, ay] = polar(r0, s0), [bx, by] = polar(r0, s1), [cx2, cy2] = polar(r1, s1), [dx, dy] = polar(r1, s0)
      return `M ${ax} ${ay} A ${r0} ${r0} 0 0 1 ${bx} ${by} L ${cx2} ${cy2} A ${r1} ${r1} 0 0 0 ${dx} ${dy} Z`
    }
    const ageCount = new Map<string, number>()
    for (const m of data.members) { const k = m.ageKey ?? '__noage__'; ageCount.set(k, (ageCount.get(k) ?? 0) + 1) }
    const ageOrder = [...data.ranges.filter((r) => r.enabled).map((r) => r.key), '__noage__'].filter((k) => ageCount.get(k))
    const ageSegs: { key: string; name: string; color: string; d: string; count: number }[] = []
    let aAcc = A0
    for (const k of ageOrder) {
      const frac = (ageCount.get(k)! / total) * span
      const color = k === '__noage__' ? SIN : (data.ranges.find((r) => r.key === k)?.color ?? SIN)
      const name = k === '__noage__' ? 'Sin edad' : (data.ranges.find((r) => r.key === k)?.name ?? k)
      ageSegs.push({ key: k, name, color, count: ageCount.get(k)!, d: sector(dR0, dR1, aAcc + 0.012, aAcc + frac - 0.012) }); aAcc += frac
    }
    return { cx, cy, dR1, seats, ageSegs, vbW: cx + 16, vbH: cy * 2 }
  }, [data, groups, groupOf])

  if (!data) return <p className="py-8 text-center text-sm text-graysage">Cargando mapa…</p>

  const total = data.members.length
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  const inactiveCount = data.inactive.size

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Mapa de la iglesia</h3>
          <p className="text-sm text-graysage">
            Cada asiento es un miembro, por rango de edad. {mode === 'equipos' ? 'Color = su equipo.' : mode === 'cobertura' ? 'Color = su líder cercano.' : mode === 'asistencia' ? 'Presentes vs ausentes en la actividad elegida.' : mode === 'bautismo' ? 'Color = bautismo.' : mode === 'sexo' ? 'Color = sexo.' : 'Color = rango de edad.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'asistencia' && (
            <select value={occId} onChange={(e) => setOccId(e.target.value)} className="rounded-lg border border-graysage/25 bg-cream px-2 py-1 text-xs text-charcoal outline-none">
              {data.occurrences.slice(0, 40).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          <div className="flex rounded-full bg-cream p-0.5 text-xs">
            {(['equipos', 'cobertura', 'asistencia'] as Mode[]).map((m) => (
              <button key={m} onClick={() => { setSel(null); setMode(m) }} className={`rounded-full px-3 py-1.5 font-medium capitalize transition ${mode === m ? 'bg-white text-charcoal shadow-sm' : 'text-graysage hover:text-charcoal'}`}>{m}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* Roster (izquierda) */}
        <div className="order-2 w-full sm:order-1 sm:w-40">
          <div className="mb-2 flex items-center justify-between text-xs text-graysage">
            <span>{total} miembros</span>
            {sel && <button onClick={() => setSel(null)} className="font-medium text-sage-dark hover:underline">Ver todos</button>}
          </div>
          <div className="space-y-0.5">
            {groups.map((g) => (
              <button
                key={g.key}
                onClick={() => setSel((s) => (s === g.key ? null : g.key))}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${sel === g.key ? 'bg-sage-light/60' : 'hover:bg-cream'}`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                <span className={`flex-1 truncate ${g.key === '__sin__' || g.key === '__varios__' || g.key === '__absent__' ? 'font-medium text-charcoal' : 'text-charcoal'}`} title={g.name}>{g.name}</span>
                <span className="shrink-0 text-graysage">{g.count} · {pct(g.count)}%</span>
              </button>
            ))}
          </div>
          {mode === 'equipos' && inactiveCount > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-black/5 pt-2.5 text-[0.7rem] text-graysage">
              <span className="h-3 w-3 shrink-0 rounded-full border-2 border-graysage" />
              {inactiveCount} en equipo, sin asistir ≥1 mes
            </div>
          )}
        </div>

        {/* Auditorio en media luna (derecha): altar al centro, cuñas radiales, anillo de edades */}
        <div className="order-1 min-w-0 flex-1 rounded-2xl bg-white p-2 ring-1 ring-black/5 sm:order-2">
          {art && (
            <svg viewBox={`0 0 ${art.vbW} ${art.vbH}`} className="mx-auto block w-full max-w-[280px]" role="img" aria-label="Mapa de la iglesia en media luna">
              <line x1={art.cx} y1={art.cy - art.dR1 - 4} x2={art.cx} y2={art.cy + art.dR1 + 4} stroke="#E4E4E0" strokeWidth={1} />
              {art.ageSegs.map((s) => <path key={s.key} d={s.d} fill={s.color} opacity={0.9}><title>{s.name}: {s.count}</title></path>)}
              {art.seats.map((s) => {
                const dim = sel != null && s.g !== sel
                const ring = mode === 'equipos' && data.inactive.has(s.id)
                const col = colorOf(s.g)
                return <circle key={s.id} cx={s.x} cy={s.y} r={4.1} fill={dim ? '#e3e4e6' : ring ? '#ffffff' : col} stroke={!dim && ring ? col : 'none'} strokeWidth={ring ? 1.8 : 0} opacity={dim ? 0.5 : 1} />
              })}
              <circle cx={art.cx} cy={art.cy} r={16} fill="#CECBF6" />
              <rect x={art.cx - 1.5} y={art.cy - 8} width={3} height={16} rx={1} fill="#3C3489" />
              <rect x={art.cx - 6} y={art.cy - 2.5} width={12} height={3} rx={1} fill="#3C3489" />
              <text x={art.cx} y={art.cy + 30} textAnchor="middle" fontSize={11} fill="#6b6f6a">altar</text>
            </svg>
          )}
          <p className="mt-1 text-center text-[0.65rem] text-graysage/70">Anillo exterior = edades · cuñas = {mode === 'cobertura' ? 'líderes' : mode === 'equipos' ? 'equipos' : mode === 'asistencia' ? 'asistencia' : 'grupos'}</p>
        </div>
      </div>
    </div>
  )
}
