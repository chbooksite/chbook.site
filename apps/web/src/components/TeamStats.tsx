import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import Insight from './Insight'
import RangeControl, { DEFAULT_RANGE, bucketKey, bucketLabel, cutoff, type Range } from './RangeControl'
import { entityColor } from '../lib/mapColors'

// Sección EQUIPOS. Evalúa cada equipo por la PRESENCIA de sus integrantes en los
// encuentros, NORMALIZADA por el tamaño del grupo (presentes ÷ integrantes), para
// que un equipo grande no "gane" solo por tamaño. Compara equipos entre sí y
// muestra la tendencia del equipo seleccionado. El cumplimiento = presencia del
// equipo en los servicios donde PARTICIPA/sirve (schedule_teams).

const GREEN = '#5CA27B'
const EMPTY = new Set<string>()

interface Svc { id: string; at: Date; scheduleId: string | null }
interface Data { teams: { id: string; name: string }[]; teamMembers: Map<string, Set<string>>; scheduleTeams: Map<string, Set<string>>; svcs: Svc[]; attBySvc: Map<string, Set<string>>; total: number }

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

export default function TeamStats({ churchId, onSelect }: { churchId: string; onSelect?: (teamId: string | null) => void }) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)
  const [raw, setRaw] = useState<Data | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  // Al hacer clic en un equipo se marca su gente en el mapa (no en la autoselección).
  const pick = (id: string) => { setSel(id); onSelect?.(id) }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [teamRes, mtRes, stRes, svcRes, memRes] = await Promise.all([
        supabase.from('teams').select('id, name').order('name'),
        supabase.from('member_teams').select('member_id, team_id'),
        supabase.from('schedule_teams').select('schedule_id, team_id'),
        supabase.from('service_attendance').select('service_id, starts_at, schedule_id'),
        supabase.from('members').select('status'),
      ])
      const att = await fetchAll<{ member_id: string; service_id: string }>(() => supabase.from('attendance').select('member_id, service_id'))
      if (!alive) return
      const total = ((memRes.data ?? []) as { status: string }[]).filter((m) => m.status !== 'archived' && m.status !== 'cambio_membresia').length
      const teamMembers = new Map<string, Set<string>>()
      for (const r of (mtRes.data ?? []) as { member_id: string; team_id: string }[]) { const s = teamMembers.get(r.team_id) ?? new Set<string>(); s.add(r.member_id); teamMembers.set(r.team_id, s) }
      const scheduleTeams = new Map<string, Set<string>>()
      for (const r of (stRes.data ?? []) as { schedule_id: string; team_id: string }[]) { const s = scheduleTeams.get(r.schedule_id) ?? new Set<string>(); s.add(r.team_id); scheduleTeams.set(r.schedule_id, s) }
      const attBySvc = new Map<string, Set<string>>()
      for (const a of att) { const s = attBySvc.get(a.service_id) ?? new Set<string>(); s.add(a.member_id); attBySvc.set(a.service_id, s) }
      const svcs = ((svcRes.data ?? []) as { service_id: string; starts_at: string | null; schedule_id: string | null }[])
        .filter((s) => s.starts_at)
        .map((s) => ({ id: s.service_id, at: new Date(s.starts_at as string), scheduleId: s.schedule_id }))
        .sort((a, b) => a.at.getTime() - b.at.getTime())
      setRaw({ teams: (teamRes.data ?? []) as { id: string; name: string }[], teamMembers, scheduleTeams, svcs, attBySvc, total })
    })()
    return () => { alive = false }
  }, [churchId])

  const groups = useMemo(() => (raw ? raw.teams.map((t) => { const m = raw.teamMembers.get(t.id) ?? new Set<string>(); return { id: t.id, name: t.name, members: m, size: m.size } }).filter((g) => g.size > 0) : []), [raw])
  const svcsInRange = useMemo(() => (raw ? raw.svcs.filter((s) => s.at >= cutoff(range)) : []), [raw, range])
  const teamsOf = (s: Svc) => (raw && s.scheduleId ? (raw.scheduleTeams.get(s.scheduleId) ?? EMPTY) : EMPTY)
  const count = (set: Set<string> | undefined, members: Set<string>) => { if (!set) return 0; let c = 0; for (const m of members) if (set.has(m)) c++; return c }

  const ranking = useMemo(() => {
    if (!raw) return []
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
    if (!raw || !selGrp) return [] as { label: string; value: number }[]
    const m = new Map<string, { members: Set<string>; last: Date }>()
    for (const s of svcsInRange) {
      const k = bucketKey(s.at, range.unit); const e = m.get(k) ?? { members: new Set<string>(), last: s.at }
      const pres = raw.attBySvc.get(s.id); if (pres) for (const mem of selGrp.members) if (pres.has(mem)) e.members.add(mem)
      e.last = s.at; m.set(k, e)
    }
    return [...m.keys()].sort().map((k) => { const e = m.get(k)!; const label = range.unit === 'sem' ? e.last.toLocaleDateString('es', { day: 'numeric', month: 'short' }) : bucketLabel(k, range.unit); return { label, value: selGrp.size ? Math.round((e.members.size / selGrp.size) * 100) : 0 } })
  }, [svcsInRange, selGrp, range, raw])

  const maxRate = Math.max(1, ...ranking.map((g) => g.rate))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Equipos</h3>
          <p className="text-sm text-graysage">Participación de cada equipo (presentes ÷ integrantes), normalizada por su tamaño.</p>
        </div>
        <RangeControl value={range} onChange={setRange} size="sm" />
      </div>

      {!raw ? (
        <p className="py-8 text-center text-sm text-graysage">Cargando equipos…</p>
      ) : ranking.length === 0 ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay equipos con integrantes.</p>
      ) : (
        <>
          {ranking.length >= 2 && ranking[0].rate > 0 && (
            <Insight tone="info" action={{ label: 'Ver el más bajo', onClick: () => pick(ranking[ranking.length - 1].id) }}>
              {ranking[0].name} lidera con {ranking[0].rate}% de participación; {ranking[ranking.length - 1].name} es el más bajo ({ranking[ranking.length - 1].rate}%).
            </Insight>
          )}
          <div className="grid gap-3 lg:grid-cols-5">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-2">
              <p className="mb-3 text-sm font-medium text-charcoal">Participación (presentes ÷ integrantes)</p>
              <div className="space-y-2">
                {ranking.map((g) => (
                  <button key={g.id} onClick={() => pick(g.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${sel === g.id ? 'bg-sage-light/60' : 'hover:bg-cream'}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entityColor(g.id) }} title="Color en el mapa" />
                    <span className="w-20 shrink-0 truncate text-charcoal" title={g.name}>{g.name}</span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-graysage">{g.size} · {raw.total ? Math.round((g.size / raw.total) * 100) : 0}%</span>
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
        </>
      )}
    </div>
  )
}
