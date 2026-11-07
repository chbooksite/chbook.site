import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import PageShell, { PageLoading } from '../components/PageShell'
import Avatar from '../components/Avatar'
import { Icon } from '../components/DashKit'

interface Svc {
  id: string
  name: string
  starts_at: string | null
  ended_at: string | null
  status: string | null
}
interface Att {
  service_id: string | null
  type: string | null
}
interface Attendee {
  id: string
  type: string | null
  checked_at: string | null
  members: { id: string; full_name: string } | null
}

const DATE = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' })
const MONTH = new Intl.DateTimeFormat('es', { month: 'long' })
const STATUS: Record<string, string> = { ended: 'Finalizado', active: 'En curso', scheduled: 'Programado' }

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const t = DATE.format(new Date(iso)).replace(/\./g, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

// Historial de cultos (REQ-23) y métricas de asistencia (REQ-24):
// /culto/historial lista todos los cultos; /culto/historial/:id muestra quién vino.
export default function ServiceHistory() {
  const { id } = useParams()
  return id ? <ServiceDetail id={id} /> : <HistoryList />
}

function HistoryList() {
  const { membership, membershipLoading } = useAuth()
  const [data, setData] = useState<{ services: Svc[]; att: Att[]; capacity: number | null } | null>(null)

  useEffect(() => {
    if (!membership) return
    const cid = membership.churchId
    Promise.all([
      supabase.from('services').select('id, name, starts_at, ended_at, status').eq('church_id', cid).order('starts_at', { ascending: false }).limit(200),
      supabase.from('attendance').select('service_id, type').eq('church_id', cid),
      supabase.from('churches').select('capacity').eq('id', cid).maybeSingle(),
    ]).then(([s, a, c]) => setData({ services: s.data ?? [], att: a.data ?? [], capacity: c.data?.capacity ?? null }))
  }, [membership])

  const view = useMemo(() => {
    if (!data) return null
    const by = new Map<string, { total: number; online: number }>()
    for (const a of data.att) {
      if (!a.service_id) continue
      const r = by.get(a.service_id) ?? { total: 0, online: 0 }
      r.total++
      if (a.type === 'online') r.online++
      by.set(a.service_id, r)
    }
    const rows = data.services.map((s) => ({ ...s, ...(by.get(s.id) ?? { total: 0, online: 0 }) }))
    const done = rows.filter((r) => r.status !== 'active' && r.starts_at)
    // Promedio mensual (este mes y el anterior) y comparativa semanal.
    const now = new Date()
    const inMonth = (d: Date, off: number) => {
      const m = new Date(now.getFullYear(), now.getMonth() + off, 1)
      return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()
    }
    const thisMonth = done.filter((r) => inMonth(new Date(r.starts_at!), 0)).map((r) => r.total)
    const lastMonth = done.filter((r) => inMonth(new Date(r.starts_at!), -1)).map((r) => r.total)
    const ago = (days: number) => now.getTime() - days * 86400000
    const thisWeek = done.filter((r) => new Date(r.starts_at!).getTime() >= ago(7)).map((r) => r.total)
    const lastWeek = done.filter((r) => { const t = new Date(r.starts_at!).getTime(); return t >= ago(14) && t < ago(7) }).map((r) => r.total)
    const occ = data.capacity ? done.slice(0, 4).map((r) => (r.total - r.online) / data.capacity!) : []
    return {
      rows,
      monthAvg: avg(thisMonth),
      monthPrev: lastMonth.length ? avg(lastMonth) : null,
      weekAvg: thisWeek.length ? avg(thisWeek) : null,
      weekPrev: lastWeek.length ? avg(lastWeek) : null,
      occupancy: occ.length ? Math.round(avg(occ.map((o) => o * 100))) : null,
    }
  }, [data])

  if (membershipLoading) return <PageLoading />
  if (!membership) return <Navigate to="/onboarding" replace />

  const now = new Date()
  const diff = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null)
  const wDiff = diff(view?.weekAvg ?? null, view?.weekPrev ?? null)
  const mDiff = diff(view?.monthAvg ?? null, view?.monthPrev ?? null)

  return (
    <PageShell back={{ to: '/culto', label: 'Culto' }} title="Historial de cultos" subtitle="Cada culto con su asistencia. Toca uno para ver quién vino." width="mid">
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label={`Promedio de ${MONTH.format(now)}`} value={view ? String(view.monthAvg) : '—'} note={mDiff == null ? 'asistentes por culto' : `${mDiff >= 0 ? '+' : ''}${mDiff} vs. mes anterior`} />
        <Metric label="Esta semana" value={view?.weekAvg != null ? String(view.weekAvg) : '0'} note={wDiff == null ? 'sin culto la semana pasada' : `${wDiff >= 0 ? '+' : ''}${wDiff} vs. semana pasada`} />
        <Metric label="Ocupación" value={view?.occupancy != null ? `${view.occupancy}%` : '—'} note={data?.capacity ? `presencial, últimos 4 · ${data.capacity} sillas` : 'Registra la capacidad en Ajustes'} className="col-span-2 sm:col-span-1" />
      </div>

      {!view ? (
        <div className="h-64 animate-pulse rounded-2xl bg-white/50" />
      ) : view.rows.length === 0 ? (
        <p className="vidrio px-4 py-10 text-center text-sm text-graysage">Aún no hay cultos. Cuando inicies y finalices uno, aparecerá aquí.</p>
      ) : (
        <ul className="vidrio divide-y divide-charcoal/[0.06] overflow-hidden">
          {view.rows.map((s) => (
            <li key={s.id}>
              <Link to={`/culto/historial/${s.id}`} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-white/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-charcoal">{s.name}</p>
                  <p className="text-xs text-graysage">
                    {fmtDate(s.starts_at)}{s.starts_at && ` · ${TIME.format(new Date(s.starts_at))}`}
                  </p>
                </div>
                <span className={`hidden rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline ${s.status === 'active' ? 'bg-gold/20 text-clay' : 'bg-charcoal/[0.06] text-graysage'}`}>{STATUS[s.status ?? ''] ?? s.status}</span>
                <p className="w-20 text-right">
                  <span className="text-2xl font-bold tracking-tight tabular-nums text-charcoal">{s.total}</span>
                  <span className="block text-xs text-graysage">{s.online ? `${s.online} en línea` : 'asistentes'}</span>
                </p>
                <Icon className="h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-sage-dark"><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  )
}

function Metric({ label, value, note, className = '' }: { label: string; value: string; note: string; className?: string }) {
  return (
    <div className={`vidrio p-4 ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-graysage">{label}</p>
      <p className="mt-2 text-3xl font-bold leading-none tracking-[-0.03em] tabular-nums text-charcoal">{value}</p>
      <p className="mt-1.5 text-xs text-graysage">{note}</p>
    </div>
  )
}

function ServiceDetail({ id }: { id: string }) {
  const { membership, membershipLoading } = useAuth()
  const [svc, setSvc] = useState<Svc | null | undefined>(undefined)
  const [people, setPeople] = useState<Attendee[]>([])
  const [capacity, setCapacity] = useState<number | null>(null)

  useEffect(() => {
    if (!membership) return
    Promise.all([
      supabase.from('services').select('id, name, starts_at, ended_at, status').eq('id', id).maybeSingle(),
      supabase.from('attendance').select('id, type, checked_at, members(id, full_name)').eq('service_id', id).order('checked_at'),
      supabase.from('churches').select('capacity').eq('id', membership.churchId).maybeSingle(),
    ]).then(([s, a, c]) => {
      setSvc(s.data ?? null)
      setPeople((a.data ?? []) as unknown as Attendee[])
      setCapacity(c.data?.capacity ?? null)
    })
  }, [membership, id])

  if (membershipLoading || svc === undefined) return <PageLoading />
  if (!membership) return <Navigate to="/onboarding" replace />
  if (!svc) {
    return (
      <PageShell back={{ to: '/culto/historial', label: 'Historial' }} title="No encontramos este culto" width="mid">
        <p className="text-graysage">Puede que el enlace sea antiguo.</p>
      </PageShell>
    )
  }

  const online = people.filter((p) => p.type === 'online').length
  const presential = people.length - online
  const mins = svc.starts_at && svc.ended_at ? Math.round((new Date(svc.ended_at).getTime() - new Date(svc.starts_at).getTime()) / 60000) : null

  return (
    <PageShell
      back={{ to: '/culto/historial', label: 'Historial' }}
      title={svc.name}
      subtitle={
        <span>
          {fmtDate(svc.starts_at)}
          {svc.starts_at && ` · ${TIME.format(new Date(svc.starts_at))}`}
          {svc.ended_at && ` – ${TIME.format(new Date(svc.ended_at))}`}
          {mins != null && ` · ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}`}
        </span>
      }
      width="mid"
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Asistentes" value={String(people.length)} note={STATUS[svc.status ?? ''] ?? ''} />
        <Metric label="Presencial" value={String(presential)} note="Check-in en el templo" />
        <Metric label="En línea" value={String(online)} note="Con el código del culto" />
        <Metric label="Ocupación" value={capacity ? `${Math.round((presential * 100) / capacity)}%` : '—'} note={capacity ? `de ${capacity} sillas` : 'Sin capacidad registrada'} />
      </div>

      {people.length === 0 ? (
        <p className="vidrio px-4 py-10 text-center text-sm text-graysage">Nadie registró asistencia en este culto.</p>
      ) : (
        <ul className="vidrio divide-y divide-charcoal/[0.06] overflow-hidden">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              {p.members ? (
                <Link to={`/miembros/${p.members.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={p.members.full_name} size={34} />
                  <span className="truncate text-sm font-medium text-charcoal hover:underline">{p.members.full_name}</span>
                </Link>
              ) : (
                <span className="flex-1 text-sm text-graysage">Persona eliminada</span>
              )}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.type === 'online' ? 'bg-vela-light text-clay' : 'bg-sage-light text-sage-dark'}`}>
                {p.type === 'online' ? 'En línea' : 'Presencial'}
              </span>
              <span className="w-16 text-right font-mono text-xs text-graysage">{p.checked_at ? TIME.format(new Date(p.checked_at)) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  )
}
