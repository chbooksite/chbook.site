import { Fragment, useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import { readAssignees } from '../lib/activity'
import Insight from './Insight'
import RangeControl, { DEFAULT_RANGE, bucketKey, bucketLabel, cutoff, type Range } from './RangeControl'

// Sección 3 · LIDERAZGO Y EQUIPOS. Los números de la iglesia vistos desde cada
// responsable (cabeza de la iglesia). No son números generales: a cada líder se
// le atribuye su alcance (la gente a su cargo), sus actividades semanales y, lo
// más importante, SU asistencia los días en que era responsable ("¿aparece
// cuando le toca?"). Jerarquía: pastor principal → afiliado → líder de equipo →
// líder → predicador. Permite ver si la iglesia está equilibrada y detectar
// eslabones débiles. Alcance derivado de lo que ya existe (sin asignación manual
// ni etiquetas de atributo todavía). La segunda vista (Equipos) evalúa cada
// equipo por la presencia de sus integrantes, normalizada por su tamaño.

const GREEN = '#5CA27B'
const PASTOR_P = 'pastor_principal', PASTOR_A = 'pastor_afiliado', LIDER = 'lider', PRED = 'predicador', ADMIN = 'administrador'
const EMPTY = new Set<string>()

// Severidad de un % de desempeño → color (verde bien · ámbar flojo · rosa débil).
const sev = (v: number | null) => (v == null ? '#B9BBB6' : v >= 75 ? '#5CA27B' : v >= 50 ? '#B9A36B' : '#C2919E')

const groupLabel = (tier: number) => (tier <= 1 ? 'Pastorado' : tier === 2 ? 'Líderes de equipo' : tier === 3 ? 'Líderes' : 'Predicadores')

interface Svc { id: string; at: Date; scheduleId: string | null }
interface Raw {
  activeIds: Set<string>
  memberName: Map<string, string>
  memberRoleKeys: Map<string, Set<string>>
  teams: { id: string; name: string }[]
  teamName: Map<string, string>
  teamMembers: Map<string, Set<string>>
  memberLedTeams: Map<string, string[]>
  scheduleResponsible: Map<string, Set<string>>
  schedulePred: Map<string, Set<string>>
  scheduleTeams: Map<string, Set<string>>
  svcs: Svc[]
  attBySvc: Map<string, Set<string>>
}

function LineTrend({ points }: { points: { label: string; value: number }[] }) {
  if (points.length < 2) return <p className="py-6 text-center text-xs text-graysage/60">Pocos datos en este rango para la tendencia.</p>
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={points} margin={{ left: -18, right: 8, top: 6, bottom: 0 }}>
        <defs><linearGradient id="teamFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.22} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeOpacity={0.06} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7E807B' }} axisLine={false} tickLine={false} minTickGap={14} />
        <YAxis tick={{ fontSize: 10, fill: '#7E807B' }} axisLine={false} tickLine={false} width={34} domain={[0, 100]} unit="%" />
        <Tooltip formatter={(v: number) => [`${v}%`, 'Participación']} />
        <Area type="monotone" dataKey="value" stroke={GREEN} strokeWidth={2.5} fill="url(#teamFill)" dot={{ r: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function TeamRoleMetrics({ churchId }: { churchId: string }) {
  const [mode, setMode] = useState<'leaders' | 'teams'>('leaders')
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)
  const [raw, setRaw] = useState<Raw | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [memRes, mrRes, roleRes, teamRes, mtRes, schRes, stRes, svcRes] = await Promise.all([
        supabase.from('members').select('id, full_name, status'),
        supabase.from('member_roles').select('member_id, role_id'),
        supabase.from('roles').select('id, key'),
        supabase.from('teams').select('id, name').order('name'),
        supabase.from('member_teams').select('member_id, team_id, is_leader'),
        supabase.from('activity_schedules').select('id, assignees').eq('church_id', churchId),
        supabase.from('schedule_teams').select('schedule_id, team_id'),
        supabase.from('service_attendance').select('service_id, starts_at, schedule_id'),
      ])
      const att = await fetchAll<{ member_id: string; service_id: string }>(() => supabase.from('attendance').select('member_id, service_id'))
      if (!alive) return

      const roleKeyById = new Map(((roleRes.data ?? []) as { id: string; key: string }[]).map((r) => [r.id, r.key]))
      const predRoleId = ((roleRes.data ?? []) as { id: string; key: string }[]).find((r) => r.key === PRED)?.id ?? null

      const memberName = new Map<string, string>()
      const activeIds = new Set<string>()
      for (const m of (memRes.data ?? []) as { id: string; full_name: string; status: string }[]) {
        memberName.set(m.id, m.full_name)
        if (m.status !== 'archived' && m.status !== 'cambio_membresia') activeIds.add(m.id)
      }
      const memberRoleKeys = new Map<string, Set<string>>()
      const predMembersAll = new Set<string>()
      for (const r of (mrRes.data ?? []) as { member_id: string; role_id: string }[]) {
        const k = roleKeyById.get(r.role_id); if (!k) continue
        const s = memberRoleKeys.get(r.member_id) ?? new Set<string>(); s.add(k); memberRoleKeys.set(r.member_id, s)
        if (k === PRED) predMembersAll.add(r.member_id)
      }
      const teams = (teamRes.data ?? []) as { id: string; name: string }[]
      const teamName = new Map(teams.map((t) => [t.id, t.name]))
      const teamMembers = new Map<string, Set<string>>()
      const memberLedTeams = new Map<string, string[]>()
      for (const r of (mtRes.data ?? []) as { member_id: string; team_id: string; is_leader: boolean }[]) {
        const s = teamMembers.get(r.team_id) ?? new Set<string>(); s.add(r.member_id); teamMembers.set(r.team_id, s)
        if (r.is_leader) { const a = memberLedTeams.get(r.member_id) ?? []; a.push(r.team_id); memberLedTeams.set(r.member_id, a) }
      }
      const scheduleResponsible = new Map<string, Set<string>>()
      const schedulePred = new Map<string, Set<string>>()
      for (const s of (schRes.data ?? []) as { id: string; assignees: unknown }[]) {
        const asg = readAssignees(s.assignees)
        const resp = new Set<string>(), pred = new Set<string>()
        for (const a of asg) {
          if (a.kind === 'member') resp.add(a.id)
          else if (a.kind === 'role' && predRoleId && a.id === predRoleId) {
            for (const id of a.memberIds.length ? a.memberIds : [...predMembersAll]) pred.add(id)
          }
        }
        if (resp.size) scheduleResponsible.set(s.id, resp)
        if (pred.size) schedulePred.set(s.id, pred)
      }
      const scheduleTeams = new Map<string, Set<string>>()
      for (const r of (stRes.data ?? []) as { schedule_id: string; team_id: string }[]) { const s = scheduleTeams.get(r.schedule_id) ?? new Set<string>(); s.add(r.team_id); scheduleTeams.set(r.schedule_id, s) }
      const attBySvc = new Map<string, Set<string>>()
      for (const a of att) { const s = attBySvc.get(a.service_id) ?? new Set<string>(); s.add(a.member_id); attBySvc.set(a.service_id, s) }
      const svcs = ((svcRes.data ?? []) as { service_id: string; starts_at: string | null; schedule_id: string | null }[])
        .filter((s) => s.starts_at)
        .map((s) => ({ id: s.service_id, at: new Date(s.starts_at as string), scheduleId: s.schedule_id }))
        .sort((a, b) => a.at.getTime() - b.at.getTime())

      setRaw({ activeIds, memberName, memberRoleKeys, teams, teamName, teamMembers, memberLedTeams, scheduleResponsible, schedulePred, scheduleTeams, svcs, attBySvc })
    })()
    return () => { alive = false }
  }, [churchId])

  if (!raw) return <p className="py-8 text-center text-sm text-graysage">Cargando liderazgo…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Liderazgo y equipos</h3>
          <p className="text-sm text-graysage">
            {mode === 'leaders'
              ? 'Los números de la iglesia vistos desde cada responsable: a quién lidera, qué actividades tiene a su cargo y si aparece cuando le toca.'
              : 'Participación de cada equipo (presentes ÷ integrantes), normalizada por su tamaño.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeControl value={range} onChange={setRange} size="sm" />
          <div className="flex rounded-full bg-cream p-0.5 text-xs">
            {([['leaders', 'Responsables'], ['teams', 'Equipos']] as const).map(([m, lab]) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1.5 font-medium transition ${mode === m ? 'bg-white text-charcoal shadow-sm' : 'text-graysage hover:text-charcoal'}`}>{lab}</button>
            ))}
          </div>
        </div>
      </div>

      {mode === 'leaders' ? <LeadersView raw={raw} range={range} /> : <TeamsView raw={raw} range={range} />}
    </div>
  )
}

// ─────────────────────────── VISTA RESPONSABLES ───────────────────────────

interface LeaderRow {
  id: string; name: string; label: string; badges: string[]; tier: number
  scope: Set<string> | null; scopeKind: 'congregacion' | 'equipo' | 'pendiente' | 'predicador'
  scheduleIds: Set<string>; predScheduleIds: Set<string>; isPred: boolean
}
type SortKey = 'tier' | 'scopeN' | 'acts' | 'propia' | 'asignada' | 'area'

function LeadersView({ raw, range }: { raw: Raw; range: Range }) {
  const [sortKey, setSortKey] = useState<SortKey>('tier')

  // Quién es "cabeza" y qué tiene a su cargo (no depende del rango).
  const leaders = useMemo<LeaderRow[]>(() => {
    const out: LeaderRow[] = []
    for (const [id, keys] of raw.memberRoleKeys) {
      if (!raw.activeIds.has(id)) continue
      const isPP = keys.has(PASTOR_P), isPA = keys.has(PASTOR_A), isL = keys.has(LIDER), isPred = keys.has(PRED)
      if (!isPP && !isPA && !isL && !isPred) continue
      const led = raw.memberLedTeams.get(id) ?? []
      let tier = 4, label = 'Predicador'
      let scope: Set<string> | null = null
      let scopeKind: LeaderRow['scopeKind'] = 'predicador'
      if (isPP) { tier = 0; label = 'Pastor principal'; scope = raw.activeIds; scopeKind = 'congregacion' }
      else if (isPA) { tier = 1; label = 'Pastor afiliado'; scope = raw.activeIds; scopeKind = 'congregacion' }
      else if (isL && led.length) {
        tier = 2
        const names = led.map((t) => raw.teamName.get(t) ?? 'equipo')
        label = 'Líder de ' + (names.length <= 2 ? names.join(' y ') : `${names[0]}, ${names[1]} +${names.length - 2}`)
        const s = new Set<string>(); for (const t of led) for (const m of raw.teamMembers.get(t) ?? []) s.add(m)
        scope = s; scopeKind = 'equipo'
      } else if (isL) { tier = 3; label = 'Líder'; scopeKind = 'pendiente' }

      const scheduleIds = new Set<string>()
      for (const [sid, resp] of raw.scheduleResponsible) if (resp.has(id)) scheduleIds.add(sid)
      const predScheduleIds = new Set<string>()
      if (isPred) for (const [sid, pred] of raw.schedulePred) if (pred.has(id)) { scheduleIds.add(sid); predScheduleIds.add(sid) }
      if (led.length) for (const [sid, ts] of raw.scheduleTeams) if (led.some((t) => ts.has(t))) scheduleIds.add(sid)

      const badges: string[] = []
      if (isPred && tier !== 4) badges.push('Predica')
      if (keys.has(ADMIN)) badges.push('Admin')
      out.push({ id, name: raw.memberName.get(id) ?? 'Responsable', label, badges, tier, scope, scopeKind, scheduleIds, predScheduleIds, isPred })
    }
    return out
  }, [raw])

  // Atribución de los números de la iglesia a cada responsable, dentro del rango.
  const rows = useMemo(() => {
    const rng = raw.svcs.filter((s) => s.at >= cutoff(range))
    const periods = new Set(rng.map((s) => bucketKey(s.at, range.unit)))
    return leaders.map((L) => {
      const own = rng.filter((s) => s.scheduleId && L.scheduleIds.has(s.scheduleId))
      const ownPresent = own.filter((s) => raw.attBySvc.get(s.id)?.has(L.id)).length
      const asignada = own.length ? Math.round((ownPresent / own.length) * 100) : null
      const periodsAtt = new Set(rng.filter((s) => raw.attBySvc.get(s.id)?.has(L.id)).map((s) => bucketKey(s.at, range.unit)))
      const propia = periods.size ? Math.round((periodsAtt.size / periods.size) * 100) : null
      let area: number | null = null
      if (L.scope && L.scope.size) {
        const byP = new Map<string, Set<string>>()
        for (const s of rng) {
          const pres = raw.attBySvc.get(s.id); if (!pres) continue
          const k = bucketKey(s.at, range.unit); const set = byP.get(k) ?? new Set<string>()
          for (const m of L.scope) if (pres.has(m)) set.add(m); byP.set(k, set)
        }
        if (byP.size) { let sum = 0; for (const set of byP.values()) sum += set.size / L.scope.size; area = Math.round((sum / byP.size) * 100) }
      }
      const pred = L.isPred ? rng.filter((s) => s.scheduleId && L.predScheduleIds.has(s.scheduleId) && raw.attBySvc.get(s.id)?.has(L.id)).length : null
      return { ...L, scopeN: L.scope ? L.scope.size : null, acts: L.scheduleIds.size, ownN: own.length, asignada, propia, area, pred }
    })
  }, [leaders, raw, range])

  const sorted = useMemo(() => {
    const r = [...rows]
    if (sortKey === 'tier') return r.sort((a, b) => a.tier - b.tier || (b.asignada ?? -1) - (a.asignada ?? -1) || a.name.localeCompare(b.name))
    const n = (v: number | null) => (v == null ? -1 : v)
    return r.sort((a, b) => n((b as Record<SortKey, number | null>)[sortKey]) - n((a as Record<SortKey, number | null>)[sortKey]))
  }, [rows, sortKey])

  // Eslabón débil / liderazgo constante por asistencia en días asignados.
  const accountable = rows.filter((r) => r.asignada != null && r.ownN >= 3)
  const weakest = accountable.length ? accountable.reduce((a, b) => (b.asignada! < a.asignada! ? b : a)) : null
  const strongest = accountable.length ? accountable.reduce((a, b) => (b.asignada! > a.asignada! ? b : a)) : null

  if (!rows.length) return <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay personas con rol de liderazgo asignado.</p>

  const SORTS: [SortKey, string][] = [['tier', 'Jerarquía'], ['asignada', 'Asist. asignada'], ['area', 'Desemp. área'], ['scopeN', 'A cargo'], ['acts', 'Actividades'], ['propia', 'Asist. propia']]

  return (
    <div className="space-y-4">
      {weakest && strongest && weakest.id !== strongest.id && (
        <Insight tone={weakest.asignada! < 70 ? 'warn' : 'good'}>
          {weakest.asignada! < 70
            ? <>Eslabón a reforzar: <b>{weakest.name}</b> ({weakest.label}) asistió al {weakest.asignada}% de las actividades que lideraba. El más constante es {strongest.name} ({strongest.asignada}%).</>
            : <>Liderazgo constante: todos superan el 70% de asistencia en sus actividades. El más alto es {strongest.name} ({strongest.asignada}%).</>}
        </Insight>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-graysage">Ordenar:</span>
        {SORTS.map(([k, lab]) => (
          <button key={k} onClick={() => setSortKey(k)} className={`rounded-full px-2.5 py-1 font-medium transition ${sortKey === k ? 'bg-white text-charcoal shadow-sm ring-1 ring-black/5' : 'text-graysage hover:text-charcoal'}`}>{lab}</button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-black/5">
        <table className="w-full min-w-[660px] text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs text-graysage">
              <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium">Responsable</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Personas a cargo">A cargo</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Actividades semanales de las que es responsable">Act./sem</th>
              <th className="px-3 py-2.5 text-right font-medium" title="En cuántos periodos del rango asistió a algún servicio">Asist. propia</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Presencia en las actividades que lideraba o servía: ¿aparece cuando le toca?">Asist. asignada</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Participación semanal de la gente a su cargo">Desemp. área</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const groupHdr = sortKey === 'tier' && (i === 0 || groupLabel(sorted[i - 1].tier) !== groupLabel(r.tier))
              return (
                <Fragment key={r.id}>
                  {groupHdr && <tr><td colSpan={6} className="bg-cream/50 px-4 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-graysage">{groupLabel(r.tier)}</td></tr>}
                  <tr className="border-b border-black/5 last:border-0">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                      <div className="font-medium text-charcoal">{r.name}</div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-graysage">
                        <span>{r.label}</span>
                        {r.pred != null && r.pred > 0 && <span className="rounded-full bg-sage-light px-1.5 py-0.5 text-[0.65rem] font-medium text-sage-dark">{r.pred} predic.</span>}
                        {r.badges.map((b) => <span key={b} className="rounded-full bg-cream px-1.5 py-0.5 text-[0.65rem]">{b}</span>)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-charcoal">
                      {r.scopeN != null ? r.scopeN : <span className="text-graysage/50" title={r.scopeKind === 'pendiente' ? 'Sin personas asignadas todavía' : 'No aplica a este rol'}>{r.scopeKind === 'pendiente' ? '—' : '·'}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-charcoal">{r.acts || <span className="text-graysage/40">·</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: sev(r.propia) }}>{r.propia == null ? '·' : `${r.propia}%`}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: sev(r.asignada) }}>{r.asignada == null ? '·' : `${r.asignada}%`}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: sev(r.area) }}>{r.area == null ? '·' : `${r.area}%`}</td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-graysage/70"><b>Asist. asignada</b>: presencia en las actividades que lideraba o servía (¿aparece cuando le toca?). <b>Desemp. área</b>: participación semanal de la gente a su cargo. <span title="pendiente de asignar">“—”</span> = alcance aún sin asignar · “·” = no aplica a ese rol.</p>
    </div>
  )
}

// ───────────────────────────── VISTA EQUIPOS ──────────────────────────────

function TeamsView({ raw, range }: { raw: Raw; range: Range }) {
  const [sel, setSel] = useState<string | null>(null)
  const groups = useMemo(() => raw.teams.map((t) => { const m = raw.teamMembers.get(t.id) ?? new Set<string>(); return { id: t.id, name: t.name, members: m, size: m.size } }).filter((g) => g.size > 0), [raw])
  const svcsInRange = useMemo(() => raw.svcs.filter((s) => s.at >= cutoff(range)), [raw, range])
  const teamsOf = (s: Svc) => (s.scheduleId ? (raw.scheduleTeams.get(s.scheduleId) ?? EMPTY) : EMPTY)
  const count = (set: Set<string> | undefined, members: Set<string>) => { if (!set) return 0; let c = 0; for (const m of members) if (set.has(m)) c++; return c }

  const ranking = useMemo(() => {
    if (!svcsInRange.length) return groups.map((g) => ({ ...g, rate: 0, avgPresent: 0, cumpl: null as number | null, nResp: 0 }))
    return groups.map((g) => {
      const pres = svcsInRange.map((s) => count(raw.attBySvc.get(s.id), g.members))
      const rates = pres.map((c) => c / g.size)
      const resp = svcsInRange.filter((s) => teamsOf(s).has(g.id))
      const cumpl = resp.length ? Math.round((resp.reduce((a, s) => a + count(raw.attBySvc.get(s.id), g.members) / g.size, 0) / resp.length) * 100) : null
      return { ...g, rate: Math.round((rates.reduce((a, x) => a + x, 0) / rates.length) * 100), avgPresent: Math.round((pres.reduce((a, x) => a + x, 0) / pres.length) * 10) / 10, cumpl, nResp: resp.length }
    }).sort((a, b) => b.rate - a.rate)
  }, [groups, svcsInRange, raw])

  useEffect(() => { if (ranking.length && (!sel || !ranking.find((g) => g.id === sel))) setSel(ranking[0].id) }, [ranking, sel])
  const selGrp = ranking.find((g) => g.id === sel) ?? null

  const trend = useMemo(() => {
    if (!selGrp) return [] as { label: string; value: number }[]
    const m = new Map<string, { members: Set<string>; last: Date }>()
    for (const s of svcsInRange) {
      const k = bucketKey(s.at, range.unit); const e = m.get(k) ?? { members: new Set<string>(), last: s.at }
      const pres = raw.attBySvc.get(s.id); if (pres) for (const mem of selGrp.members) if (pres.has(mem)) e.members.add(mem)
      e.last = s.at; m.set(k, e)
    }
    return [...m.keys()].sort().map((k) => { const e = m.get(k)!; const label = range.unit === 'sem' ? e.last.toLocaleDateString('es', { day: 'numeric', month: 'short' }) : bucketLabel(k, range.unit); return { label, value: selGrp.size ? Math.round((e.members.size / selGrp.size) * 100) : 0 } })
  }, [svcsInRange, selGrp, range, raw])

  if (ranking.length === 0) return <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay equipos con integrantes.</p>

  const maxRate = Math.max(1, ...ranking.map((g) => g.rate))

  return (
    <div className="space-y-4">
      {ranking.length >= 2 && ranking[0].rate > 0 && (
        <Insight tone="info" action={{ label: 'Ver el más bajo', onClick: () => setSel(ranking[ranking.length - 1].id) }}>
          {ranking[0].name} lidera con {ranking[0].rate}% de participación; {ranking[ranking.length - 1].name} es el más bajo ({ranking[ranking.length - 1].rate}%).
        </Insight>
      )}
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-2">
          <p className="mb-3 text-sm font-medium text-charcoal">Participación (presentes ÷ integrantes)</p>
          <div className="space-y-2">
            {ranking.map((g) => (
              <button key={g.id} onClick={() => setSel(g.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${sel === g.id ? 'bg-sage-light/60' : 'hover:bg-cream'}`}>
                <span className="w-24 shrink-0 truncate text-charcoal" title={g.name}>{g.name}</span>
                <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-cream">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(g.rate / maxRate) * 100}%`, backgroundColor: GREEN }} />
                </span>
                <span className="w-9 text-right font-semibold tabular-nums text-charcoal">{g.rate}%</span>
              </button>
            ))}
          </div>
        </div>
        {selGrp && (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-serif text-base font-semibold text-charcoal">{selGrp.name}</p>
                <p className="text-xs text-graysage">{selGrp.size} integrantes</p>
              </div>
              <div className="text-right">
                <p className="font-serif text-2xl font-semibold text-charcoal tabular-nums">{selGrp.rate}%</p>
                <p className="text-xs text-graysage">participación media</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-cream px-2.5 py-1 text-graysage">{selGrp.avgPresent} presentes/encuentro</span>
              {selGrp.cumpl != null
                ? <span className="rounded-full bg-sage-light px-2.5 py-1 font-medium text-sage-dark" title="Presencia del equipo en los servicios donde sirve">Cumplimiento {selGrp.cumpl}% · sirve en {selGrp.nResp}</span>
                : <span className="rounded-full bg-cream px-2.5 py-1 text-graysage/70">Sin servicios asignados</span>}
            </div>
            <p className="mt-4 mb-1 text-xs font-medium text-graysage">Participación por {range.unit === 'sem' ? 'semana' : range.unit === 'mes' ? 'mes' : 'año'}</p>
            <LineTrend points={trend} />
          </div>
        )}
      </div>
    </div>
  )
}
