import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readAgeRanges, type AgeRangeDef } from '../lib/member'
import { readAudience, audienceIsEmpty } from '../lib/activity'
import { flockMemberIds, memberAgeKey, FLOCK_ROLE_KEYS, type Flock, type FlockMember } from '../lib/flock'

// Sección MAPA DE LA IGLESIA. Auditorio tipo mapa de asientos: cada asiento = un
// miembro activo. Los bloques = rangos de edad (compactos, mismo ancho y mismo
// orden de color; el más numeroso al centro y al frente, pegado al altar; el
// resto a los lados equilibrados). Dos modos: EQUIPOS (color = equipo) y
// COBERTURA (color = líder cercano, derivado de líderes de equipo + ovejas). En
// ambos: pertenecer a 2+ grupos = "Varios"; a ninguno = gris. Seleccionar un
// grupo atenúa los demás y deja ver su proporción por edades.

const PALETTE = ['#2a78d6', '#1baf7a', '#eb6834', '#e34949', '#eda100', '#6250d6', '#0f8a8a', '#b5651d', '#c2185b', '#558b2f', '#7b5e57', '#00897b']
const VARIOS = '#8e7cc3'
const SIN = '#c7c9cd'

interface M { id: string; ageKey: string | null }
interface Group { key: string; name: string; color: string; count: number }

type Mode = 'equipos' | 'cobertura'

export default function ChurchMap({ churchId }: { churchId: string }) {
  const [mode, setMode] = useState<Mode>('equipos')
  const [sel, setSel] = useState<string | null>(null)
  const [data, setData] = useState<{
    members: M[]
    ranges: AgeRangeDef[]
    teamName: Map<string, string>
    leaderName: Map<string, string>
    memberTeams: Map<string, string[]>
    memberLeaders: Map<string, string[]>
  } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [memRes, mtRes, teamRes, mrRes, roleRes, flockRes, churchRes] = await Promise.all([
        supabase.from('members').select('id, full_name, status, sex, is_baptized, birth_date, age_group'),
        supabase.from('member_teams').select('member_id, team_id, is_leader'),
        supabase.from('teams').select('id, name'),
        supabase.from('member_roles').select('member_id, role_id'),
        supabase.from('roles').select('id, key'),
        supabase.from('leader_flock').select('member_id, audience, manual_member_ids'),
        supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
      ])
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
      // Completa roleIds/teamIds del universo (para resolver segmentos de ovejas).
      for (const u of universe) { u.roleIds = memberRoleIds.get(u.id) ?? new Set(); u.teamIds = memberTeamsSet.get(u.id) ?? new Set() }
      for (const [mid, set] of memberTeamsSet) memberTeams.set(mid, [...set])

      // COBERTURA: líder cercano de cada miembro = líderes de equipo (sobre sus
      // integrantes) ∪ líderes con ovejas explícitas (segmento no "toda la iglesia").
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

      const members: M[] = universe.map((u) => ({ id: u.id, ageKey: memberAgeKey(u, ranges) }))
      setData({ members, ranges, teamName, leaderName, memberTeams, memberLeaders })
    })()
    return () => { alive = false }
  }, [churchId])

  // Grupo (equipo/líder) de cada miembro según el modo: id, '__varios__' o '__sin__'.
  const groupOf = useMemo(() => {
    if (!data) return (_: string) => '__sin__'
    const src = mode === 'equipos' ? data.memberTeams : data.memberLeaders
    return (id: string) => { const g = src.get(id) ?? []; return g.length === 0 ? '__sin__' : g.length === 1 ? g[0] : '__varios__' }
  }, [data, mode])

  // Grupos reales presentes + color estable + conteo; luego Varios y Sin.
  const { groups, colorOf, rankOf } = useMemo(() => {
    const empty = { groups: [] as Group[], colorOf: (_: string) => SIN, rankOf: (_: string) => 999 }
    if (!data) return empty
    const nameOf = mode === 'equipos' ? data.teamName : data.leaderName
    const counts = new Map<string, number>()
    for (const m of data.members) { const g = groupOf(m.id); counts.set(g, (counts.get(g) ?? 0) + 1) }
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

  // Bloques por edad, ordenados: el mayor al centro; el resto a los lados.
  const { left, center, right, total } = useMemo(() => {
    const none = { left: [] as AgeBlock[], center: null as AgeBlock | null, right: [] as AgeBlock[], total: 0 }
    if (!data) return none
    const byAge = new Map<string, string[]>()
    for (const m of data.members) { const k = m.ageKey ?? '__noage__'; const a = byAge.get(k) ?? []; a.push(m.id); byAge.set(k, a) }
    const order = [...data.ranges.filter((r) => r.enabled).map((r) => r.key), '__noage__']
    const blocks: AgeBlock[] = order
      .filter((k) => byAge.get(k)?.length)
      .map((k) => ({ key: k, name: k === '__noage__' ? 'Sin edad' : data.ranges.find((r) => r.key === k)?.name ?? k, ids: (byAge.get(k) ?? []).slice().sort((a, b) => rankOf(groupOf(a)) - rankOf(groupOf(b))) }))
    if (!blocks.length) return none
    let ci = 0; for (let i = 1; i < blocks.length; i++) if (blocks[i].ids.length > blocks[ci].ids.length) ci = i
    const center = blocks[ci]
    const rest = blocks.filter((_, i) => i !== ci).sort((a, b) => b.ids.length - a.ids.length)
    const left: AgeBlock[] = [], right: AgeBlock[] = []
    rest.forEach((b, i) => (i % 2 === 0 ? left : right).push(b))
    return { left, center, right, total: data.members.length }
  }, [data, groupOf, rankOf])

  if (!data) return <p className="py-8 text-center text-sm text-graysage">Cargando mapa…</p>

  const dimmed = (id: string) => sel != null && groupOf(id) !== sel
  const renderBlock = (b: AgeBlock) => (
    <div key={b.key} className="flex flex-col items-center gap-1.5">
      <p className="text-[0.65rem] leading-tight text-graysage">{b.name} · <span className="text-graysage/60">{b.ids.length}</span></p>
      <div className="flex w-[116px] flex-wrap justify-center gap-[3px]">
        {b.ids.map((id) => {
          const d = dimmed(id)
          return <span key={id} className="h-3 w-3 rounded-full" style={{ backgroundColor: d ? '#e3e4e6' : colorOf(groupOf(id)), opacity: d ? 0.45 : 1 }} />
        })}
      </div>
    </div>
  )

  const sinPct = (g: Group) => (total ? Math.round((g.count / total) * 100) : 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Mapa de la iglesia</h3>
          <p className="text-sm text-graysage">Cada asiento es un miembro, por rango de edad. {mode === 'equipos' ? 'Color = su equipo.' : 'Color = su líder cercano.'} Toca un grupo para aislarlo.</p>
        </div>
        <div className="flex rounded-full bg-cream p-0.5 text-xs">
          {(['equipos', 'cobertura'] as Mode[]).map((m) => (
            <button key={m} onClick={() => { setSel(null); setMode(m) }} className={`rounded-full px-3 py-1.5 font-medium capitalize transition ${mode === m ? 'bg-white text-charcoal shadow-sm' : 'text-graysage hover:text-charcoal'}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_210px]">
        <div className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
          {/* Altar */}
          <div className="mb-4 flex flex-col items-center">
            <div className="relative h-4 w-1.5 rounded-sm bg-graysage/70"><span className="absolute left-[-5px] top-1 h-1 w-3.5 rounded-sm bg-graysage/70" /></div>
            <div className="mt-1.5 w-32 rounded-lg bg-sage-light py-1 text-center text-[0.7rem] font-medium text-sage-dark">Pastor + afiliados · altar</div>
          </div>
          {/* Auditorio: mayor al centro, resto a los lados */}
          <div className="flex flex-wrap items-start justify-center gap-4">
            <div className="flex flex-col items-center gap-4">{left.map(renderBlock)}</div>
            {center && renderBlock(center)}
            <div className="flex flex-col items-center gap-4">{right.map(renderBlock)}</div>
          </div>
        </div>

        {/* Roster lateral */}
        <div>
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
                <span className={`flex-1 truncate ${g.key === '__sin__' || g.key === '__varios__' ? 'font-medium text-charcoal' : 'text-charcoal'}`} title={g.name}>{g.name}</span>
                <span className="shrink-0 text-graysage">{g.count} · {sinPct(g)}%</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface AgeBlock { key: string; name: string; ids: string[] }
