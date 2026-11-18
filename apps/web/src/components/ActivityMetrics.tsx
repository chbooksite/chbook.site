import { useEffect, useMemo, useRef, useState, type ReactElement, type PointerEvent as RPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import { ymd } from '../lib/calendar'
import { occursOn, weekStart, addDays, readAudience, readAssignees, WEEKDAYS_SHORT, type Schedule, type Freq } from '../lib/activity'
import Insight from './Insight'
import RangeControl, { DEFAULT_RANGE, bucketKey, bucketLabel, cutoff, type Range } from './RangeControl'

// Sección 2 del panel · MÉTRICAS DE ACTIVIDADES. Calendario REDUCIDO en carrusel:
// proyecta las OCURRENCIAS de las actividades recurrentes (como la sección
// Calendario) y encima pinta las métricas donde ya hay asistencia registrada;
// las que faltan salen como "sin registrar". Al elegir un día se ven sus
// actividades DENTRO de la tarjeta; para la elegida: real vs esperada por canal,
// hora de llegada (check-in GPS), tendencia (área real + línea esperada) y un
// comparativo MULTILÍNEA entre actividades recurrentes.

const C = { green: '#5CA27B', slate: '#7E9AB8', rose: '#C2919E', gold: '#B9A36B', lilac: '#9E8FB5', gray: '#9A9C97' }
const WEEKS_BACK = 6 // ventana de proyección hacia atrás

// Una ocurrencia de actividad en un día (registrada o solo proyectada).
interface Occ {
  key: string            // id de selección: serviceId, o `scheduleId|ymd`
  serviceId: string | null
  scheduleId: string | null
  name: string
  at: Date
  registered: boolean
  total: number; online: number; presencial: number; gps: number
}
interface Row {
  service_id: string; schedule_id: string | null; activity_name: string | null; service_name: string | null
  starts_at: string | null; total: number; online: number; presencial: number; gps: number
}
// Contexto de equipos: asistentes por encuentro + integrantes/nombre por equipo +
// equipos participantes por actividad (schedule_teams).
interface TeamData {
  attendeesBySvc: Map<string, Set<string>>
  teamMembers: Map<string, Set<string>>
  teamName: Map<string, string>
  scheduleTeams: Map<string, string[]>
  encBySchedule: Map<string, { enc: string; pred: string | null }>
}

function mapSchedule(r: Record<string, unknown>): Schedule {
  return {
    id: r.id as string, parentId: (r.parent_id as string) ?? null, typeId: (r.type_id as string) ?? null,
    name: r.name as string, freq: (r.freq as Freq) ?? 'weekly', weekday: r.weekday as number, nth: (r.nth as number) ?? null,
    startTime: (r.start_time as string) ?? null, endTime: (r.end_time as string) ?? null, audience: readAudience(r.audience),
    location: (r.location as string) ?? null, responsibleTeamId: (r.responsible_team_id as string) ?? null,
    assignees: readAssignees(r.assignees), onDate: (r.on_date as string) ?? null, sortOrder: (r.sort_order as number) ?? 0,
    enabled: (r.enabled as boolean) ?? true,
  }
}

function fmtHour(h: number | null): string {
  if (h == null) return '—'
  const hh = Math.floor(h); const mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}
const axisTick = { fontSize: 11, fill: '#7E807B' }
function ChartCard({ children, h = 220 }: { children: ReactElement; h?: number }) {
  return <ResponsiveContainer width="100%" height={h}>{children}</ResponsiveContainer>
}

// Tira de días ARRASTRABLE (concepto heredado del calendario, AgendaView): paneo
// horizontal con inercia; al pasar el cursor la tarjeta se amplía; al seleccionar
// el día se despliegan sus actividades DENTRO de la tarjeta, seleccionables ahí.
function ActivityDayStrip({ days, selDay, selKey, today, onSelectDay, onSelectOcc }: {
  days: [string, Occ[]][]; selDay: string | null; selKey: string | null; today: Date
  onSelectDay: (k: string) => void; onSelectOcc: (key: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ sl: number; x: number; lastX: number; lastT: number; v: number } | null>(null)
  const momentum = useRef<number | null>(null)
  const moved = useRef(false)
  const [hover, setHover] = useState<string | null>(null)

  // Trae a la vista el día seleccionado SOLO si quedó fuera (sin mover si ya se ve).
  useEffect(() => {
    const el = scrollRef.current; if (!el || !selDay) return
    const card = el.querySelector(`[data-day="${selDay}"]`) as HTMLElement | null
    if (!card) return
    const left = card.offsetLeft, right = left + card.offsetWidth
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, left - (el.clientWidth - card.offsetWidth) / 2), behavior: 'smooth' })
    }
  }, [selDay])

  const release = () => {
    const p = pan.current; pan.current = null; const el = scrollRef.current; if (!p || !el) return
    let v = p.v * 0.45, pos = el.scrollLeft, last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(48, now - last); last = now; v *= Math.pow(0.9, dt / 16)
      if (Math.abs(v) < 0.02) { momentum.current = null; return }
      pos += v * dt; const max = el.scrollWidth - el.clientWidth
      if (pos <= 0 || pos >= max) { el.scrollLeft = Math.max(0, Math.min(max, pos)); momentum.current = null; return }
      el.scrollLeft = pos; momentum.current = requestAnimationFrame(step)
    }
    momentum.current = requestAnimationFrame(step)
  }
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current; if (!el) return
    if ((e.target as HTMLElement).closest('[data-act]')) return
    if (momentum.current) { cancelAnimationFrame(momentum.current); momentum.current = null }
    moved.current = false
    pan.current = { sl: el.scrollLeft, x: e.clientX, lastX: e.clientX, lastT: performance.now(), v: 0 }
    el.setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pan.current; if (!p) return
    if (e.buttons === 0) { release(); return }
    if (Math.abs(e.clientX - p.x) > 4) moved.current = true
    const el = scrollRef.current; if (el) el.scrollLeft = p.sl - (e.clientX - p.x)
    const now = performance.now(), dt = now - p.lastT
    if (dt > 0) { p.v = p.v * 0.7 + (-(e.clientX - p.lastX) / dt) * 0.3; p.lastX = e.clientX; p.lastT = now }
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const wasPan = !!pan.current, wasMoved = moved.current
    const el = scrollRef.current
    if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    release()
    if (wasPan && !wasMoved) {
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const d = under?.closest('[data-day]') as HTMLElement | null
      if (d?.dataset.day) onSelectDay(d.dataset.day)
    }
  }

  const dayLabel = (k: string) => { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo - 1, d) }

  return (
    <div
      ref={scrollRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      className="flex items-start cursor-grab touch-none select-none gap-3 overflow-x-auto pb-2 active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map(([k, list]) => {
        const d = dayLabel(k); const open = hover === k || selDay === k
        const regTotal = list.reduce((a, o) => a + (o.registered ? o.total : 0), 0)
        const regCount = list.filter((o) => o.registered).length
        const future = d.getTime() > today.getTime()
        return (
          <div
            key={k}
            data-day={k}
            onMouseEnter={() => setHover(k)}
            onMouseLeave={() => setHover((h) => (h === k ? null : h))}
            className={`shrink-0 overflow-hidden rounded-2xl border bg-white p-4 transition-[width,box-shadow,border-color] duration-300 ease-out ${open ? 'w-72 border-sage shadow-[0_14px_34px_-18px_rgba(0,0,0,0.3)]' : 'w-40 border-black/5'} ${selDay === k ? 'ring-2 ring-sage-dark' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[0.65rem] uppercase text-graysage">{WEEKDAYS_SHORT[d.getDay()]}</span>
                <span className="font-serif text-xl font-semibold leading-none text-charcoal">{d.getDate()}</span>
                <span className="text-[0.65rem] text-graysage">{d.toLocaleDateString('es', { month: 'short' })}</span>
              </div>
              {regCount > 0
                ? <span className="shrink-0 rounded-full bg-sage-light px-2 py-0.5 text-[0.65rem] font-semibold text-sage-dark">{regTotal} asist.</span>
                : <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-[0.65rem] text-graysage">{future ? 'próx.' : 'sin reg.'}</span>}
            </div>
            <p className="mt-1 text-[0.65rem] text-graysage">{list.length} {list.length === 1 ? 'actividad' : 'actividades'}</p>
            <div className={`grid transition-all duration-300 ease-out ${open ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-1 border-t border-black/5 pt-2">
                  {list.map((o) => (
                    <button
                      key={o.key}
                      data-act
                      onClick={() => onSelectOcc(o.key)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${selKey === o.key ? 'bg-sage-dark text-white' : 'bg-cream text-charcoal hover:bg-sage-light/60'}`}
                    >
                      <span className="truncate">{o.name}</span>
                      {o.registered
                        ? <span className={`shrink-0 tabular-nums ${selKey === o.key ? 'text-white/80' : 'text-graysage'}`}>{o.total}</span>
                        : <span className={`shrink-0 text-[0.65rem] ${selKey === o.key ? 'text-white/70' : 'text-graysage/70'}`}>sin reg.</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ActivityMetrics({ churchId, onOccurrence }: { churchId: string; onOccurrence?: (serviceId: string | null) => void }) {
  const [occs, setOccs] = useState<Occ[] | null>(null)
  const [arrival, setArrival] = useState<Map<string, number | null>>(new Map())
  const [teamData, setTeamData] = useState<TeamData | null>(null)
  const [selDay, setSelDay] = useState<string | null>(null)
  const [selKey, setSelKey] = useState<string | null>(null)
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [schRes, svcRes, mtRes, teamRes, stRes, roleRes, memRes] = await Promise.all([
        supabase.from('activity_schedules').select('*').eq('church_id', churchId),
        supabase.from('service_attendance').select('service_id, schedule_id, activity_name, service_name, starts_at, total, online, presencial, gps'),
        supabase.from('member_teams').select('member_id, team_id'),
        supabase.from('teams').select('id, name'),
        supabase.from('schedule_teams').select('schedule_id, team_id').eq('church_id', churchId),
        supabase.from('roles').select('id, name'),
        supabase.from('members').select('id, full_name'),
      ])
      const att = await fetchAll<{ service_id: string; checked_at: string | null; member_id: string | null }>(() => supabase.from('attendance').select('service_id, checked_at, member_id'))
      if (!alive) return

      // Contexto de equipos para "equipos en esta actividad".
      const attendeesBySvc = new Map<string, Set<string>>()
      const teamMembers = new Map<string, Set<string>>()
      const teamName = new Map<string, string>()
      const scheduleTeams = new Map<string, string[]>()
      for (const a of att) {
        if (!a.member_id) continue
        const s = attendeesBySvc.get(a.service_id) ?? new Set<string>(); s.add(a.member_id); attendeesBySvc.set(a.service_id, s)
      }
      for (const r of (mtRes.data ?? []) as { member_id: string; team_id: string }[]) {
        const s = teamMembers.get(r.team_id) ?? new Set<string>(); s.add(r.member_id); teamMembers.set(r.team_id, s)
      }
      for (const t of (teamRes.data ?? []) as { id: string; name: string }[]) teamName.set(t.id, t.name)
      for (const r of (stRes.data ?? []) as { schedule_id: string; team_id: string }[]) {
        const a = scheduleTeams.get(r.schedule_id) ?? []; if (!a.includes(r.team_id)) a.push(r.team_id); scheduleTeams.set(r.schedule_id, a)
      }
      // Encargado(s) y predicador por actividad (desde activity_schedules.assignees).
      const roleName = new Map(((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]))
      const memberName = new Map(((memRes.data ?? []) as { id: string; full_name: string }[]).map((m) => [m.id, m.full_name]))
      const isPred = (x: { kind: string; id: string }) => x.kind === 'role' && (roleName.get(x.id) ?? '').toLowerCase().includes('predicador')
      const resolveA = (a: { kind: string; id: string }) => a.kind === 'member' ? (memberName.get(a.id) ?? 'Persona') : a.kind === 'team' ? (teamName.get(a.id) ?? 'Equipo') : (roleName.get(a.id) ?? 'Rol')
      const encBySchedule = new Map<string, { enc: string; pred: string | null }>()
      for (const r of (schRes.data ?? []) as Record<string, unknown>[]) {
        const asg = readAssignees(r.assignees)
        if (!asg.length) continue
        const enc = asg.filter((x) => !isPred(x)).map(resolveA).join(' · ')
        const pa = asg.find(isPred)
        const pred = pa ? (pa.memberIds.map((id) => memberName.get(id)).filter(Boolean).join(', ') || 'Predicador') : null
        encBySchedule.set(r.id as string, { enc, pred })
      }
      setTeamData({ attendeesBySvc, teamMembers, teamName, scheduleTeams, encBySchedule })

      // Registrados (con asistencia). Clave de slot = scheduleId|ymd (o serviceId si no tiene schedule).
      const byKey = new Map<string, Occ>()
      for (const r of (svcRes.data ?? []) as unknown as Row[]) {
        if (!r.starts_at) continue
        const at = new Date(r.starts_at)
        const key = r.schedule_id ? `${r.schedule_id}|${ymd(at)}` : r.service_id
        byKey.set(key, {
          key, serviceId: r.service_id, scheduleId: r.schedule_id,
          name: r.activity_name ?? r.service_name ?? 'Actividad', at, registered: true,
          total: Number(r.total), online: Number(r.online), presencial: Number(r.presencial), gps: Number(r.gps),
        })
      }

      // Proyección de ocurrencias de las actividades recurrentes (ventana).
      const schedules = (schRes.data ?? []).map((r) => mapSchedule(r as Record<string, unknown>)).filter((s) => !s.parentId && s.enabled)
      const start = addDays(weekStart(today), -WEEKS_BACK * 7)
      const end = addDays(weekStart(today), 7) // incluye la semana actual
      for (let d = new Date(start); d < end; d = addDays(d, 1)) {
        for (const s of schedules) {
          if (!occursOn(s, d)) continue
          const key = `${s.id}|${ymd(d)}`
          if (byKey.has(key)) continue // ya registrado
          byKey.set(key, { key, serviceId: null, scheduleId: s.id, name: s.name, at: new Date(d), registered: false, total: 0, online: 0, presencial: 0, gps: 0 })
        }
      }

      // Hora de llegada por encuentro.
      const sums = new Map<string, { s: number; n: number }>()
      for (const a of att) {
        if (!a.checked_at) continue
        const dt = new Date(a.checked_at); const h = dt.getHours() + dt.getMinutes() / 60
        const cur = sums.get(a.service_id) ?? { s: 0, n: 0 }; cur.s += h; cur.n++; sums.set(a.service_id, cur)
      }
      const arr = new Map<string, number | null>()
      for (const [k, v] of sums) arr.set(k, v.n ? v.s / v.n : null)

      setArrival(arr)
      setOccs([...byKey.values()].sort((a, b) => b.at.getTime() - a.at.getTime()))
    })()
    return () => { alive = false }
  }, [churchId, today])

  // Días con actividad (desc), cada uno con sus ocurrencias (ordenadas por hora/nombre).
  const days = useMemo(() => {
    const m = new Map<string, Occ[]>()
    for (const o of occs ?? []) { const k = ymd(o.at); const a = m.get(k) ?? []; a.push(o); m.set(k, a) }
    for (const [, list] of m) list.sort((a, b) => a.at.getTime() - b.at.getTime() || a.name.localeCompare(b.name))
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [occs])

  useEffect(() => {
    if (!days.length) return
    if (!selDay || !days.find(([k]) => k === selDay)) {
      // Arranca en el día más reciente YA ocurrido (preferir uno con registro); si no, el primero.
      const pick = days.find(([, l]) => l.some((o) => o.registered)) ?? days.find(([, l]) => l[0].at.getTime() <= today.getTime()) ?? days[0]
      setSelDay(pick[0]); setSelKey((pick[1].find((o) => o.registered) ?? pick[1][0]).key)
    }
  }, [days, selDay, today])

  const sel = useMemo(() => (occs ?? []).find((o) => o.key === selKey) ?? null, [occs, selKey])
  // Refleja en el mapa lateral la asistencia de la ocurrencia elegida (si está registrada).
  useEffect(() => { onOccurrence?.(sel && sel.registered ? sel.serviceId : null) }, [sel, onOccurrence])

  // Equipos participantes en la actividad seleccionada y su presencia.
  const selTeams = useMemo(() => {
    if (!sel || !sel.registered || !sel.serviceId || !sel.scheduleId || !teamData) return [] as { name: string; present: number; size: number }[]
    const teamIds = teamData.scheduleTeams.get(sel.scheduleId) ?? []
    const attendees = teamData.attendeesBySvc.get(sel.serviceId) ?? new Set<string>()
    return teamIds.map((tid) => {
      const members = teamData.teamMembers.get(tid) ?? new Set<string>()
      let present = 0; for (const m of members) if (attendees.has(m)) present++
      return { name: teamData.teamName.get(tid) ?? 'Equipo', present, size: members.size }
    }).filter((t) => t.size > 0).sort((a, b) => b.present - a.present)
  }, [sel, teamData])
  const registered = useMemo(() => (occs ?? []).filter((o) => o.registered), [occs])

  const esperada = useMemo(() => {
    if (!sel || !sel.scheduleId) return null
    const prev = registered.filter((o) => o.scheduleId === sel.scheduleId && o.at < sel.at)
    if (!prev.length) return null
    return Math.round(prev.reduce((a, o) => a + o.total, 0) / prev.length)
  }, [sel, registered])

  // Tendencia de la actividad seleccionada vs su propio histórico, agrupada por el
  // rango elegido (semana/mes/año). esperada = media de los periodos anteriores.
  const history = useMemo(() => {
    if (!sel || !sel.scheduleId) return [] as { label: string; real: number; esp: number | null }[]
    const cut = cutoff(range)
    const occ = registered.filter((o) => o.scheduleId === sel.scheduleId && o.at >= cut).sort((a, b) => a.at.getTime() - b.at.getTime())
    const m = new Map<string, { sum: number; n: number; last: Date }>()
    for (const o of occ) { const k = bucketKey(o.at, range.unit); const e = m.get(k) ?? { sum: 0, n: 0, last: o.at }; e.sum += o.total; e.n++; e.last = o.at; m.set(k, e) }
    const keys = [...m.keys()].sort()
    return keys.map((k, i) => {
      const e = m.get(k)!
      const real = Math.round(e.sum / e.n)
      const prevAvg = keys.slice(0, i).map((pk) => { const pe = m.get(pk)!; return pe.sum / pe.n })
      const esp = prevAvg.length ? Math.round(prevAvg.reduce((a, x) => a + x, 0) / prevAvg.length) : null
      const label = range.unit === 'sem' ? e.last.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) : bucketLabel(k, range.unit)
      return { label, real, esp }
    })
  }, [sel, registered, range])

  if (occs === null) return <p className="py-8 text-center text-sm text-graysage">Cargando métricas…</p>

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <h3 className="font-serif text-lg font-semibold text-charcoal">Métricas de actividades</h3>
        <p className="text-sm text-graysage">Asistencia real y esperada por actividad. Elige un día con actividad para ver su detalle.</p>
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">
          No hay actividades definidas. Créalas en <Link to="/calendario" className="font-medium text-sage-dark underline-offset-2 hover:underline">Calendario</Link>.
        </p>
      ) : (
        <>
          <p className="text-xs text-graysage">Arrastra para moverte · pasa el cursor para ampliar · elige la actividad dentro de la tarjeta</p>
          <ActivityDayStrip
            days={days}
            selDay={selDay}
            selKey={selKey}
            today={today}
            onSelectDay={(k) => { setSelDay(k); const list = days.find(([d]) => d === k)?.[1]; if (list?.length) setSelKey(list[0].key) }}
            onSelectOcc={setSelKey}
          />

          {sel && sel.registered && esperada != null && (
            <Insight tone={sel.total >= esperada ? 'good' : 'warn'}>
              {sel.name} {sel.total >= esperada ? 'superó' : 'quedó por debajo de'} su asistencia esperada en {Math.round(Math.abs(sel.total - esperada) / Math.max(1, esperada) * 100)}% ({sel.total} vs {esperada} esperados).
            </Insight>
          )}

          {sel && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 md:col-span-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-serif text-base font-semibold text-charcoal">{sel.name}</p>
                    <p className="text-xs text-graysage">{sel.at.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    {(() => { const e = sel.scheduleId ? teamData?.encBySchedule.get(sel.scheduleId) : null; return e && (e.enc || e.pred) ? (
                      <p className="mt-1 text-xs text-graysage">
                        {e.enc && <>Encargado: <span className="font-medium text-charcoal">{e.enc}</span></>}
                        {e.enc && e.pred && <span className="text-graysage/50"> · </span>}
                        {e.pred && <>Predica: <span className="font-medium text-charcoal">{e.pred}</span></>}
                      </p>
                    ) : null })()}
                  </div>
                  {sel.registered && esperada != null && (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sel.total >= esperada ? 'bg-sage-light text-sage-dark' : 'bg-clay/15 text-clay'}`}>
                      {sel.total >= esperada ? 'Superada' : 'Por debajo'}
                    </span>
                  )}
                </div>

                {sel.registered ? (
                  <>
                    <div className="mt-3 flex items-end gap-5">
                      <div><p className="font-serif text-3xl font-semibold text-charcoal tabular-nums">{sel.total}</p><p className="text-xs text-graysage">asistentes (real)</p></div>
                      <div><p className="font-serif text-2xl font-semibold text-graysage tabular-nums">{esperada ?? '—'}</p><p className="text-xs text-graysage">esperada</p></div>
                    </div>
                    {esperada != null && (
                      <div className="relative mt-3 h-2.5 rounded-full bg-cream">
                        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (sel.total / Math.max(sel.total, esperada)) * 100)}%`, backgroundColor: sel.total >= esperada ? C.green : C.rose }} />
                        <span className="absolute top-[-3px] h-[17px] w-0.5 rounded bg-charcoal/55" style={{ left: `${Math.min(100, (esperada / Math.max(sel.total, esperada)) * 100)}%` }} />
                      </div>
                    )}
                    <div className="mt-4 flex gap-2 text-xs">
                      <span className="rounded-full bg-cream px-2.5 py-1 text-graysage">GPS {sel.gps}</span>
                      <span className="rounded-full bg-cream px-2.5 py-1 text-graysage">Presencial {sel.presencial}</span>
                      <span className="rounded-full bg-cream px-2.5 py-1 text-graysage">Online {sel.online}</span>
                    </div>
                  </>
                ) : (
                  <div className="mt-3">
                    <p className="text-sm text-graysage">
                      {sel.at.getTime() > today.getTime() ? 'Aún no ocurre.' : 'Sin asistencia registrada.'}
                      {esperada != null && <> Esperada ~<span className="font-semibold text-charcoal">{esperada}</span> según su historial.</>}
                    </p>
                    <Link to="/asistencia" className="mt-3 inline-block rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-95">Registrar asistencia →</Link>
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-sage-light/45 p-4 ring-1 ring-black/5">
                <p className="text-sm font-medium text-charcoal">Hora de llegada</p>
                <p className="mt-2 font-serif text-3xl font-semibold text-charcoal tabular-nums">{fmtHour(sel.serviceId ? arrival.get(sel.serviceId) ?? null : null)}</p>
                <p className="mt-1 text-xs text-graysage">Promedio de llegada (check-in). Útil para ajustar el horario de inicio.</p>
              </div>
            </div>
          )}

          {sel && sel.registered && selTeams.length > 0 && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <p className="text-sm font-medium text-charcoal">Equipos en esta actividad</p>
              <p className="mb-3 text-xs text-graysage">Presencia de cada equipo participante (presentes ÷ integrantes).</p>
              <div className="space-y-2">
                {selTeams.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 truncate text-graysage" title={t.name}>{t.name}</span>
                    <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-cream">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${t.size ? (t.present / t.size) * 100 : 0}%`, backgroundColor: C.green }} />
                    </span>
                    <span className="w-12 text-right font-semibold tabular-nums text-charcoal">{t.present}/{t.size}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sel && sel.scheduleId && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-charcoal">{sel.name}: asistencia real vs esperada</p>
                <RangeControl value={range} onChange={setRange} size="sm" />
              </div>
              {history.length >= 2 ? (
                <ChartCard h={200}>
                  <ComposedChart data={history} margin={{ left: -18, right: 8, top: 6, bottom: 0 }}>
                    <defs><linearGradient id="realFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green} stopOpacity={0.25} /><stop offset="100%" stopColor={C.green} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeOpacity={0.06} vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="real" name="Real" stroke={C.green} strokeWidth={2.5} fill="url(#realFill)" dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="esp" name="Esperada" stroke={C.gray} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </ComposedChart>
                </ChartCard>
              ) : (
                <p className="py-8 text-center text-xs text-graysage/60">Pocos datos de esta actividad en el rango elegido.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
