import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import {
  projectWeek, weekStart, addDays, formatTime, recurrenceLabel,
  readAudience, readAssignees, WEEKDAYS, WEEKDAYS_SHORT,
  type Schedule, type Freq,
} from '../lib/activity'
import { ymd } from '../lib/calendar'

// Captura de asistencia (Paso A del cimiento de dashboards). El pastor elige una
// actividad REALIZADA de la semana y registra quién asistió (presencial / online).
// Al guardar: crea/actualiza el `service` (encuentro) ligado a la actividad y
// reemplaza sus filas de `attendance`. Ese dato alimenta toda la analítica.

type Mem = { id: string; name: string; status: string | null }
type Channel = 'presencial' | 'online'

function mapSchedule(r: Record<string, unknown>): Schedule {
  return {
    id: r.id as string,
    parentId: (r.parent_id as string) ?? null,
    typeId: (r.type_id as string) ?? null,
    name: r.name as string,
    freq: (r.freq as Freq) ?? 'weekly',
    weekday: r.weekday as number,
    nth: (r.nth as number) ?? null,
    startTime: (r.start_time as string) ?? null,
    endTime: (r.end_time as string) ?? null,
    audience: readAudience(r.audience),
    location: (r.location as string) ?? null,
    responsibleTeamId: (r.responsible_team_id as string) ?? null,
    assignees: readAssignees(r.assignees),
    onDate: (r.on_date as string) ?? null,
    sortOrder: (r.sort_order as number) ?? 0,
    enabled: (r.enabled as boolean) ?? true,
  }
}

// Fecha + hora de la actividad → ISO (para services.starts_at).
function occurrenceStartsAt(date: Date, startTime: string | null): string {
  const d = new Date(date)
  if (startTime) { const [h, m] = startTime.split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0) }
  else d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

const keyOf = (scheduleId: string, date: Date) => `${scheduleId}|${ymd(date)}`

export default function Attendance() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [members, setMembers] = useState<Mem[]>([])
  const [loading, setLoading] = useState(true)
  const [weekStartDate, setWeekStartDate] = useState(() => weekStart(new Date()))
  // Totales ya registrados por ocurrencia: key -> { serviceId, total }
  const [registered, setRegistered] = useState<Map<string, { serviceId: string; total: number }>>(new Map())

  const [editing, setEditing] = useState<{ schedule: Schedule; date: Date } | null>(null)

  // Carga base: actividades + miembros.
  useEffect(() => {
    if (!churchId) return
    let alive = true
    ;(async () => {
      const [schRes, memRes] = await Promise.all([
        supabase.from('activity_schedules').select('*').eq('church_id', churchId),
        supabase.from('members').select('id, full_name, status').neq('status', 'archived').order('full_name'),
      ])
      if (!alive) return
      setSchedules((schRes.data ?? []).map((r) => mapSchedule(r as Record<string, unknown>)))
      setMembers((memRes.data ?? []).map((m) => ({ id: m.id, name: m.full_name, status: m.status })))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [churchId])

  // Totales registrados de la semana visible (vista service_attendance).
  const loadWeek = useCallback(async () => {
    if (!churchId) return
    const end = addDays(weekStartDate, 7)
    const { data } = await supabase
      .from('service_attendance')
      .select('service_id, schedule_id, starts_at, total')
      .gte('starts_at', weekStartDate.toISOString())
      .lt('starts_at', end.toISOString())
    const map = new Map<string, { serviceId: string; total: number }>()
    for (const r of (data ?? []) as { service_id: string; schedule_id: string | null; starts_at: string; total: number }[]) {
      if (!r.schedule_id) continue
      map.set(keyOf(r.schedule_id, new Date(r.starts_at)), { serviceId: r.service_id, total: Number(r.total) })
    }
    setRegistered(map)
  }, [churchId, weekStartDate])
  useEffect(() => { loadWeek() }, [loadWeek])

  const week = useMemo(() => projectWeek(schedules, weekStartDate), [schedules, weekStartDate])
  const hasAny = week.some((d) => d.items.length > 0)
  const weekLabel = `${weekStartDate.getDate()} ${weekStartDate.toLocaleDateString('es', { month: 'short' })} – ${addDays(weekStartDate, 6).getDate()} ${addDays(weekStartDate, 6).toLocaleDateString('es', { month: 'short' })}`

  if (membershipLoading) return <div className="flex min-h-screen items-center justify-center bg-white"><p className="text-sm text-graysage">Cargando…</p></div>
  if (!membership) return <Navigate to="/onboarding" replace />

  const today = new Date(); today.setHours(0, 0, 0, 0)

  return (
    <div className="min-h-screen bg-white">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-semibold text-charcoal sm:text-3xl">Registrar asistencia</h1>
          <p className="mt-1 text-sm text-graysage">Elige una actividad realizada y marca quién asistió. Así el panel puede medir participación, equipos y tendencias.</p>
        </div>

        {/* Navegación de semana */}
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-black/5 bg-cream/60 px-4 py-3">
          <button onClick={() => setWeekStartDate((d) => addDays(d, -7))} className="rounded-lg px-3 py-1.5 text-sm text-graysage transition hover:bg-sage-light/60 hover:text-sage-dark">‹ Semana anterior</button>
          <span className="text-sm font-medium text-charcoal">{weekLabel}</span>
          <button onClick={() => setWeekStartDate((d) => addDays(d, 7))} className="rounded-lg px-3 py-1.5 text-sm text-graysage transition hover:bg-sage-light/60 hover:text-sage-dark">Semana siguiente ›</button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-graysage">Cargando actividades…</p>
        ) : !hasAny ? (
          <p className="rounded-2xl bg-cream/60 py-10 text-center text-sm text-graysage">No hay actividades definidas esta semana.</p>
        ) : (
          <div className="space-y-5">
            {week.map((day) => day.items.length === 0 ? null : (
              <div key={day.date.toISOString()}>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="font-serif text-sm font-semibold text-charcoal">{WEEKDAYS[day.weekday]}</span>
                  <span className="text-xs text-graysage">{day.date.getDate()} {day.date.toLocaleDateString('es', { month: 'short' })}</span>
                  {day.date.getTime() === today.getTime() && <span className="rounded-full bg-sage-light px-2 py-0.5 text-[0.65rem] font-semibold text-sage-dark">Hoy</span>}
                </div>
                <div className="space-y-2">
                  {day.items.map((it) => {
                    const reg = registered.get(keyOf(it.id, day.date))
                    const future = day.date.getTime() > today.getTime()
                    return (
                      <div key={it.id} className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-[0_8px_24px_-18px_rgba(0,0,0,0.25)]">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-charcoal">{it.name}</p>
                          <p className="text-xs text-graysage">{it.startTime ? formatTime(it.startTime) : recurrenceLabel(it)}</p>
                        </div>
                        {reg ? (
                          <span className="shrink-0 rounded-full bg-sage-light px-3 py-1 text-xs font-semibold text-sage-dark">{reg.total} asistentes</span>
                        ) : future ? (
                          <span className="shrink-0 text-xs text-graysage/70">Aún no ocurre</span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-cream px-3 py-1 text-xs text-graysage">Pendiente</span>
                        )}
                        <button
                          onClick={() => setEditing({ schedule: it, date: day.date })}
                          className="shrink-0 rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-95"
                        >
                          {reg ? 'Editar' : 'Registrar'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {editing && churchId && (
        <RegisterModal
          churchId={churchId}
          schedule={editing.schedule}
          date={editing.date}
          members={members}
          existingServiceId={registered.get(keyOf(editing.schedule.id, editing.date))?.serviceId ?? null}
          onClose={() => setEditing(null)}
          onSaved={(res) => {
            setRegistered((prev) => new Map(prev).set(keyOf(editing.schedule.id, editing.date), res))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ---- Modal de registro ----
function RegisterModal({ churchId, schedule, date, members, existingServiceId, onClose, onSaved }: {
  churchId: string; schedule: Schedule; date: Date; members: Mem[]; existingServiceId: string | null
  onClose: () => void; onSaved: (res: { serviceId: string; total: number }) => void
}) {
  const [marks, setMarks] = useState<Map<string, Channel>>(new Map())
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!!existingServiceId)

  // Prefill con la asistencia ya registrada (si el encuentro existe).
  useEffect(() => {
    if (!existingServiceId) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('attendance').select('member_id, type').eq('service_id', existingServiceId)
      if (!alive) return
      const m = new Map<string, Channel>()
      for (const r of (data ?? []) as { member_id: string; type: string | null }[]) {
        m.set(r.member_id, r.type === 'online' ? 'online' : 'presencial')
      }
      setMarks(m); setLoading(false)
    })()
    return () => { alive = false }
  }, [existingServiceId])

  const set = (id: string, ch: Channel | null) => setMarks((prev) => {
    const next = new Map(prev)
    if (ch === null) next.delete(id); else next.set(id, ch)
    return next
  })

  const presencial = [...marks.values()].filter((c) => c === 'presencial').length
  const online = [...marks.values()].filter((c) => c === 'online').length
  const total = marks.size

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? members.filter((m) => m.name.toLowerCase().includes(s)) : members
  }, [members, q])

  async function save() {
    setSaving(true)
    let serviceId = existingServiceId
    if (!serviceId) {
      const { data, error } = await supabase.from('services').insert({
        church_id: churchId, name: schedule.name, starts_at: occurrenceStartsAt(date, schedule.startTime),
        status: 'ended', schedule_id: schedule.id,
      }).select('id').single()
      if (error || !data) { setSaving(false); alert('No se pudo crear el encuentro.'); return }
      serviceId = data.id as string
    } else {
      await supabase.from('services').update({ status: 'ended' }).eq('id', serviceId)
    }
    // Reemplaza la asistencia del encuentro.
    await supabase.from('attendance').delete().eq('service_id', serviceId)
    const rows = [...marks.entries()].map(([member_id, type]) => ({ church_id: churchId, service_id: serviceId, member_id, type }))
    if (rows.length) {
      const { error } = await supabase.from('attendance').insert(rows)
      if (error) { setSaving(false); alert('No se pudo guardar la asistencia.'); return }
    }
    setSaving(false)
    onSaved({ serviceId: serviceId as string, total: marks.size })
  }

  const Seg = ({ id }: { id: string }) => {
    const cur = marks.get(id) ?? null
    const btn = (label: string, val: Channel | null, on: boolean, onCls: string) => (
      <button onClick={() => set(id, on ? null : val)} className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${on ? onCls : 'text-graysage hover:bg-cream'}`}>{label}</button>
    )
    return (
      <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-cream/70 p-0.5">
        {btn('Presencial', 'presencial', cur === 'presencial', 'bg-sage-dark text-white')}
        {btn('Online', 'online', cur === 'online', 'bg-sage text-white')}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-black/5 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-lg font-semibold text-charcoal">{schedule.name}</h2>
              <p className="text-xs text-graysage">{WEEKDAYS_SHORT[date.getDay()]} {date.getDate()} {date.toLocaleDateString('es', { month: 'long' })}{schedule.startTime ? ` · ${formatTime(schedule.startTime)}` : ''}</p>
            </div>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-graysage hover:bg-cream">✕</button>
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            <span className="rounded-full bg-sage-light px-2.5 py-1 font-semibold text-sage-dark">{total} total</span>
            <span className="rounded-full bg-cream px-2.5 py-1 text-graysage">{presencial} presencial</span>
            <span className="rounded-full bg-cream px-2.5 py-1 text-graysage">{online} online</span>
          </div>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…"
            className="mt-3 w-full rounded-lg border border-black/10 bg-cream px-3 py-2 text-sm outline-none focus:border-sage"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-1">
          {loading ? (
            <p className="py-10 text-center text-sm text-graysage">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-graysage">Sin personas.</p>
          ) : filtered.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-cream/50">
              <span className="min-w-0 flex-1 truncate text-sm text-charcoal">{m.name}</span>
              <Seg id={m.id} />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-graysage transition hover:bg-cream">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60">
            {saving ? 'Guardando…' : 'Guardar asistencia'}
          </button>
        </div>
      </div>
    </div>
  )
}
