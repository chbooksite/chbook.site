import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import Insight from './Insight'

// Sección 3 · EQUIPOS Y ROLES. Evalúa cada grupo por la PRESENCIA de sus
// integrantes en los encuentros, NORMALIZADA por el tamaño del grupo (presentes
// ÷ integrantes), para que un equipo grande no "gane" solo por tamaño. Compara
// grupos entre sí y muestra la tendencia del grupo seleccionado a lo largo de los
// últimos encuentros. Lógica del modelo (nivel 3): equipo vs sí mismo y vs otros
// en la misma métrica normalizada.

const GREEN = '#5CA27B'
const WINDOW = 8 // últimos encuentros considerados

interface Grp { id: string; name: string; members: Set<string>; size: number }
interface Svc { id: string; at: Date; present: Map<string, number>; teams: Set<string> } // teams = equipos participantes del encuentro

function LineTrend({ points }: { points: { label: string; value: number }[] }) {
  if (points.length < 2) return <p className="py-6 text-center text-xs text-graysage/60">Se necesitan 2+ encuentros para la tendencia.</p>
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={points} margin={{ left: -22, right: 8, top: 6, bottom: 0 }}>
        <defs><linearGradient id="teamFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.22} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeOpacity={0.06} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7E807B' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#7E807B' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
        <Tooltip formatter={(v: number) => [`${v} presentes`, '']} />
        <Area type="monotone" dataKey="value" stroke={GREEN} strokeWidth={2.5} fill="url(#teamFill)" dot={{ r: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function TeamRoleMetrics({ churchId }: { churchId: string }) {
  const [mode, setMode] = useState<'teams' | 'roles'>('teams')
  const [teams, setTeams] = useState<Grp[]>([])
  const [roles, setRoles] = useState<Grp[]>([])
  const [svcs, setSvcs] = useState<Svc[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [teamRes, roleRes, mtRes, mrRes, svcRes, attRes, schRes] = await Promise.all([
        supabase.from('teams').select('id, name').order('name'),
        supabase.from('roles').select('id, name').order('name'),
        supabase.from('member_teams').select('member_id, team_id'),
        supabase.from('member_roles').select('member_id, role_id'),
        supabase.from('service_attendance').select('service_id, starts_at, schedule_id').order('starts_at', { ascending: false }).limit(WINDOW),
        supabase.from('attendance').select('member_id, service_id'),
        supabase.from('schedule_teams').select('schedule_id, team_id'),
      ])
      if (!alive) return
      const teamMembers = new Map<string, Set<string>>()
      for (const r of (mtRes.data ?? []) as { member_id: string; team_id: string }[]) { const s = teamMembers.get(r.team_id) ?? new Set(); s.add(r.member_id); teamMembers.set(r.team_id, s) }
      const roleMembers = new Map<string, Set<string>>()
      for (const r of (mrRes.data ?? []) as { member_id: string; role_id: string }[]) { const s = roleMembers.get(r.role_id) ?? new Set(); s.add(r.member_id); roleMembers.set(r.role_id, s) }
      const mkGrp = (rows: { id: string; name: string }[], mm: Map<string, Set<string>>): Grp[] =>
        rows.map((g) => ({ id: g.id, name: g.name, members: mm.get(g.id) ?? new Set(), size: (mm.get(g.id) ?? new Set()).size })).filter((g) => g.size > 0)
      const tms = mkGrp((teamRes.data ?? []) as { id: string; name: string }[], teamMembers)
      const rls = mkGrp((roleRes.data ?? []) as { id: string; name: string }[], roleMembers)

      // Equipos participantes por actividad (cumplimiento = presencia donde el equipo sirve).
      const scheduleTeams = new Map<string, Set<string>>()
      for (const r of (schRes.data ?? []) as { schedule_id: string; team_id: string }[]) { const s = scheduleTeams.get(r.schedule_id) ?? new Set<string>(); s.add(r.team_id); scheduleTeams.set(r.schedule_id, s) }

      // Asistentes por encuentro
      const attBySvc = new Map<string, Set<string>>()
      for (const a of (attRes.data ?? []) as { member_id: string; service_id: string }[]) { const s = attBySvc.get(a.service_id) ?? new Set(); s.add(a.member_id); attBySvc.set(a.service_id, s) }
      const services = ((svcRes.data ?? []) as { service_id: string; starts_at: string | null; schedule_id: string | null }[])
        .filter((s) => s.starts_at)
        .map((s) => {
          const attendees = attBySvc.get(s.service_id) ?? new Set<string>()
          const present = new Map<string, number>()
          for (const g of [...tms, ...rls]) { let c = 0; for (const m of g.members) if (attendees.has(m)) c++; present.set(g.id, c) }
          return { id: s.service_id, at: new Date(s.starts_at as string), present, teams: s.schedule_id ? (scheduleTeams.get(s.schedule_id) ?? new Set<string>()) : new Set<string>() }
        })
        .sort((a, b) => a.at.getTime() - b.at.getTime()) // asc para la tendencia
      setTeams(tms); setRoles(rls); setSvcs(services)
    })()
    return () => { alive = false }
  }, [churchId])

  const groups = mode === 'teams' ? teams : roles

  // Tasa media normalizada por grupo (presentes ÷ tamaño, promediado sobre los encuentros).
  const ranking = useMemo(() => {
    if (!svcs || !svcs.length) return groups.map((g) => ({ ...g, rate: 0, avgPresent: 0, cumpl: null as number | null, nResp: 0 }))
    return groups.map((g) => {
      const rates = svcs.map((s) => (s.present.get(g.id) ?? 0) / g.size)
      const pres = svcs.map((s) => s.present.get(g.id) ?? 0)
      // Cumplimiento: solo encuentros donde este EQUIPO fue el encargado (su gente debía servir).
      const resp = mode === 'teams' ? svcs.filter((s) => s.teams.has(g.id)) : []
      const cumpl = resp.length ? Math.round((resp.reduce((a, s) => a + (s.present.get(g.id) ?? 0) / g.size, 0) / resp.length) * 100) : null
      return { ...g, rate: Math.round((rates.reduce((a, x) => a + x, 0) / rates.length) * 100), avgPresent: Math.round((pres.reduce((a, x) => a + x, 0) / pres.length) * 10) / 10, cumpl, nResp: resp.length }
    }).sort((a, b) => b.rate - a.rate)
  }, [groups, svcs, mode])

  useEffect(() => { if (ranking.length && (!sel || !ranking.find((g) => g.id === sel))) setSel(ranking[0].id) }, [ranking, sel])

  const selGrp = ranking.find((g) => g.id === sel) ?? null
  const trend = useMemo(() => {
    if (!svcs || !selGrp) return []
    return svcs.map((s) => ({ label: s.at.toLocaleDateString('es', { day: 'numeric', month: 'short' }), value: s.present.get(selGrp.id) ?? 0 }))
  }, [svcs, selGrp])

  if (svcs === null) return <p className="py-8 text-center text-sm text-graysage">Cargando equipos…</p>

  const maxRate = Math.max(1, ...ranking.map((g) => g.rate))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Equipos y roles</h3>
          <p className="text-sm text-graysage">Presencia de cada grupo en los encuentros, normalizada por su tamaño (últimos {WINDOW}).</p>
        </div>
        <div className="flex rounded-full bg-cream p-0.5 text-xs">
          {(['teams', 'roles'] as const).map((m) => (
            <button key={m} onClick={() => { setSel(null); setMode(m) }} className={`rounded-full px-3 py-1.5 font-medium transition ${mode === m ? 'bg-white text-charcoal shadow-sm' : 'text-graysage hover:text-charcoal'}`}>
              {m === 'teams' ? 'Equipos' : 'Roles'}
            </button>
          ))}
        </div>
      </div>

      {ranking.length >= 2 && ranking[0].rate > 0 && (
        <Insight tone="info">
          {ranking[0].name} lidera con {ranking[0].rate}% de participación; {ranking[ranking.length - 1].name} es el más bajo ({ranking[ranking.length - 1].rate}%).
        </Insight>
      )}

      {ranking.length === 0 ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay {mode === 'teams' ? 'equipos' : 'roles'} con integrantes.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {/* Ranking normalizado */}
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

          {/* Detalle del grupo seleccionado */}
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
                {mode === 'teams' && (
                  selGrp.cumpl != null
                    ? <span className="rounded-full bg-sage-light px-2.5 py-1 font-medium text-sage-dark" title="Presencia del equipo en los servicios donde participa/sirve">Cumplimiento {selGrp.cumpl}% · sirve en {selGrp.nResp}</span>
                    : <span className="rounded-full bg-cream px-2.5 py-1 text-graysage/70">Sin servicios asignados</span>
                )}
              </div>
              <p className="mt-4 mb-1 text-xs font-medium text-graysage">Presencia por encuentro</p>
              <LineTrend points={trend} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
