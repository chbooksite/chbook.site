import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../lib/supabase'
import { readAssignees, readAudience, audienceIsEmpty } from '../lib/activity'
import { flockMemberIds, type Flock, type FlockMember } from '../lib/flock'
import { readAgeRanges, type AgeRangeDef } from '../lib/member'
import Insight from './Insight'
import RangeControl, { DEFAULT_RANGE, bucketKey, cutoff, type Range } from './RangeControl'

// Sección LÍDERES. Los roles son las CABEZAS de la iglesia: toda persona con un
// rol (pastor principal/afiliado, líder general, líder de equipo, predicador) se
// evalúa aquí. A cada una se le atribuyen los números de la iglesia desde su
// óptica: a quién lidera (alcance), qué actividades tiene a su cargo, su
// asistencia y —lo clave— su asistencia los días en que era responsable
// ("¿aparece cuando le toca?"), más el desempeño del área a su cargo. Un líder de
// equipo tiene rol de líder activo aunque no se lo hayan etiquetado explícito.
// Jerarquía: pastor principal → afiliado → líder de equipo → líder → predicador.

const PASTOR_P = 'pastor_principal', PASTOR_A = 'pastor_afiliado', LIDER = 'lider', PRED = 'predicador', ADMIN = 'administrador'
const sev = (v: number | null) => (v == null ? '#B9BBB6' : v >= 75 ? '#5CA27B' : v >= 50 ? '#B9A36B' : '#C2919E')
const groupLabel = (tier: number) => (tier <= 1 ? 'Pastorado' : tier === 2 ? 'Líderes de equipo' : tier === 3 ? 'Líderes' : 'Predicadores')

interface Svc { id: string; at: Date; scheduleId: string | null }
interface Data {
  activeIds: Set<string>
  memberName: Map<string, string>
  memberRoleKeys: Map<string, Set<string>>
  teamName: Map<string, string>
  teamMembers: Map<string, Set<string>>
  memberLedTeams: Map<string, string[]>
  scheduleResponsible: Map<string, Set<string>>
  schedulePred: Map<string, Set<string>>
  scheduleTeams: Map<string, Set<string>>
  svcs: Svc[]
  attBySvc: Map<string, Set<string>>
  ranges: AgeRangeDef[]
  universe: FlockMember[]
  flockByLeader: Map<string, Flock>
}
interface LeaderRow {
  id: string; name: string; label: string; badges: string[]; tier: number
  scope: Set<string> | null; scopeKind: 'congregacion' | 'equipo' | 'pendiente' | 'predicador' | 'rebaño'
  scheduleIds: Set<string>; predScheduleIds: Set<string>; isPred: boolean
}
type SortKey = 'tier' | 'scopeN' | 'acts' | 'propia' | 'asignada' | 'area'

export default function LeaderStats({ churchId, onSelect }: { churchId: string; onSelect?: (leaderId: string | null) => void }) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)
  const [raw, setRaw] = useState<Data | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('tier')
  const [selId, setSelId] = useState<string | null>(null)
  // Clic en una fila → aísla a ese líder (su gente a cargo) en el mapa.
  const pickLeader = (id: string) => { const n = selId === id ? null : id; setSelId(n); onSelect?.(n) }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [memRes, mrRes, roleRes, teamRes, mtRes, schRes, stRes, svcRes, flockRes, churchRes] = await Promise.all([
        supabase.from('members').select('id, full_name, status, sex, is_baptized, birth_date, age_group'),
        supabase.from('member_roles').select('member_id, role_id'),
        supabase.from('roles').select('id, key'),
        supabase.from('teams').select('id, name'),
        supabase.from('member_teams').select('member_id, team_id, is_leader'),
        supabase.from('activity_schedules').select('id, assignees').eq('church_id', churchId),
        supabase.from('schedule_teams').select('schedule_id, team_id'),
        supabase.from('service_attendance').select('service_id, starts_at, schedule_id'),
        supabase.from('leader_flock').select('member_id, audience, manual_member_ids'),
        supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
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
      const memberRoleIds = new Map<string, Set<string>>()
      const predMembersAll = new Set<string>()
      for (const r of (mrRes.data ?? []) as { member_id: string; role_id: string }[]) {
        const ri = memberRoleIds.get(r.member_id) ?? new Set<string>(); ri.add(r.role_id); memberRoleIds.set(r.member_id, ri)
        const k = roleKeyById.get(r.role_id); if (!k) continue
        const s = memberRoleKeys.get(r.member_id) ?? new Set<string>(); s.add(k); memberRoleKeys.set(r.member_id, s)
        if (k === PRED) predMembersAll.add(r.member_id)
      }
      const teamName = new Map(((teamRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]))
      const teamMembers = new Map<string, Set<string>>()
      const memberTeamIds = new Map<string, Set<string>>()
      const memberLedTeams = new Map<string, string[]>()
      for (const r of (mtRes.data ?? []) as { member_id: string; team_id: string; is_leader: boolean }[]) {
        const s = teamMembers.get(r.team_id) ?? new Set<string>(); s.add(r.member_id); teamMembers.set(r.team_id, s)
        const ti = memberTeamIds.get(r.member_id) ?? new Set<string>(); ti.add(r.team_id); memberTeamIds.set(r.member_id, ti)
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

      const ranges = readAgeRanges(churchRes.data?.settings)
      const universe: FlockMember[] = []
      for (const m of (memRes.data ?? []) as { id: string; status: string; sex: string | null; is_baptized: boolean | null; birth_date: string | null; age_group: string | null }[]) {
        if (m.status === 'archived' || m.status === 'cambio_membresia') continue
        universe.push({ id: m.id, sex: m.sex, is_baptized: m.is_baptized, birth_date: m.birth_date, age_group: m.age_group, roleIds: memberRoleIds.get(m.id) ?? new Set(), teamIds: memberTeamIds.get(m.id) ?? new Set() })
      }
      const flockByLeader = new Map<string, Flock>()
      for (const r of (flockRes.data ?? []) as { member_id: string; audience: unknown; manual_member_ids: string[] | null }[]) {
        flockByLeader.set(r.member_id, { audience: readAudience(r.audience), manual: r.manual_member_ids ?? [] })
      }

      setRaw({ activeIds, memberName, memberRoleKeys, teamName, teamMembers, memberLedTeams, scheduleResponsible, schedulePred, scheduleTeams, svcs, attBySvc, ranges, universe, flockByLeader })
    })()
    return () => { alive = false }
  }, [churchId])

  const leaders = useMemo<LeaderRow[]>(() => {
    if (!raw) return []
    const candidates = new Set<string>()
    for (const [id, keys] of raw.memberRoleKeys) if (keys.has(PASTOR_P) || keys.has(PASTOR_A) || keys.has(LIDER) || keys.has(PRED)) candidates.add(id)
    for (const id of raw.memberLedTeams.keys()) candidates.add(id)
    const out: LeaderRow[] = []
    for (const id of candidates) {
      if (!raw.activeIds.has(id)) continue
      const keys = raw.memberRoleKeys.get(id) ?? new Set<string>()
      const isPP = keys.has(PASTOR_P), isPA = keys.has(PASTOR_A), isL = keys.has(LIDER), isPred = keys.has(PRED)
      const led = raw.memberLedTeams.get(id) ?? []
      let tier = 4, label = 'Predicador'
      let scope: Set<string> | null = null
      let scopeKind: LeaderRow['scopeKind'] = 'predicador'
      if (isPP) { tier = 0; label = 'Pastor principal'; scope = raw.activeIds; scopeKind = 'congregacion' }
      else if (isPA) { tier = 1; label = 'Pastor afiliado'; scope = raw.activeIds; scopeKind = 'congregacion' }
      else if (led.length) {
        tier = 2
        const names = led.map((t) => raw.teamName.get(t) ?? 'equipo')
        label = 'Líder de ' + (names.length <= 2 ? names.join(' y ') : `${names[0]}, ${names[1]} +${names.length - 2}`)
        const s = new Set<string>(); for (const t of led) for (const m of raw.teamMembers.get(t) ?? []) s.add(m)
        scope = s; scopeKind = 'equipo'
      } else if (isL) { tier = 3; label = 'Líder'; scopeKind = 'pendiente' }

      // Rebaño explícito (ovejas asignadas) tiene prioridad sobre el alcance por defecto.
      const fl = raw.flockByLeader.get(id)
      if (fl && (fl.audience.all || !audienceIsEmpty(fl.audience) || fl.manual.length)) {
        scope = flockMemberIds(id, fl, raw.universe, raw.ranges)
        if (scopeKind === 'pendiente' || scopeKind === 'predicador') scopeKind = 'rebaño'
      }

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

  const rows = useMemo(() => {
    if (!raw) return []
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

  const accountable = rows.filter((r) => r.asignada != null && r.ownN >= 3)
  const weakest = accountable.length ? accountable.reduce((a, b) => (b.asignada! < a.asignada! ? b : a)) : null
  const strongest = accountable.length ? accountable.reduce((a, b) => (b.asignada! > a.asignada! ? b : a)) : null

  const SORTS: [SortKey, string][] = [['tier', 'Jerarquía'], ['asignada', 'Asist. asignada'], ['area', 'Desemp. área'], ['scopeN', 'A cargo'], ['acts', 'Actividades'], ['propia', 'Asist. propia']]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Líderes</h3>
          <p className="text-sm text-graysage">Cada persona con rol es una cabeza de la iglesia. Se evalúa a quién lidera, qué actividades tiene a su cargo y si aparece cuando le toca.</p>
        </div>
        <RangeControl value={range} onChange={setRange} size="sm" />
      </div>

      {!raw ? (
        <p className="py-8 text-center text-sm text-graysage">Cargando líderes…</p>
      ) : !rows.length ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay personas con rol de liderazgo asignado.</p>
      ) : (
        <>
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
                      <tr onClick={() => pickLeader(r.id)} className={`cursor-pointer border-b border-black/5 last:border-0 ${selId === r.id ? 'bg-sage-light/40' : 'hover:bg-cream/50'}`}>
                        <td className={`sticky left-0 z-10 px-4 py-2.5 ${selId === r.id ? 'bg-sage-light' : 'bg-white'}`}>
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
        </>
      )}
    </div>
  )
}
