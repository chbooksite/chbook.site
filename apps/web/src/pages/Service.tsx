import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { occursOn, SCHEDULE_SUMMARY_COLUMNS, summaryRules, type ScheduleSummaryRow } from '../lib/activity'
import { countByType, elapsedLabel, formatOnlineCode, generateOnlineCode, type LiveAttendance } from '../lib/service'
import { btnPrimary, btnSecondary, fieldCls } from '../lib/ui'
import PageShell, { PageLoading } from '../components/PageShell'
import Avatar from '../components/Avatar'

interface ServiceRow {
  id: string
  name: string
  starts_at: string | null
  ended_at: string | null
  status: string | null
  online_code: string | null
}

interface Person {
  id: string
  full_name: string
  status: string | null
}

interface Snapshot {
  capacity: number | null
  services: ServiceRow[]
  counts: Map<string, number> // asistentes por culto terminado
  people: Person[]
  suggestedName: string
  attendance: LiveAttendance[] // del culto en curso
}

const TIME = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' })
const DATE = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' })
const POLL_MS = 15000 // respaldo por si Realtime no llega

function Icon({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

// Carga todo lo que la pantalla necesita de una vez.
async function fetchSnapshot(churchId: string): Promise<Snapshot> {
  const [churchRes, svcRes, peopleRes, schRes] = await Promise.all([
    supabase.from('churches').select('capacity').eq('id', churchId).maybeSingle(),
    supabase.from('services').select('id, name, starts_at, ended_at, status, online_code').eq('church_id', churchId).order('starts_at', { ascending: false }).limit(8),
    supabase.from('members').select('id, full_name, status').eq('church_id', churchId).order('full_name'),
    supabase.from('activity_schedules').select(SCHEDULE_SUMMARY_COLUMNS).eq('church_id', churchId),
  ])
  const services: ServiceRow[] = svcRes.data ?? []
  const active = services.find((s) => s.status === 'active')
  const ended = services.filter((s) => s.status === 'ended')

  const ids = [...ended.map((s) => s.id), ...(active ? [active.id] : [])]
  const attRes = ids.length
    ? await supabase.from('attendance').select('id, member_id, type, checked_at, service_id').in('service_id', ids)
    : { data: [] as (LiveAttendance & { service_id: string | null })[] }
  const rows = attRes.data ?? []
  const counts = new Map<string, number>()
  for (const r of rows) if (r.service_id) counts.set(r.service_id, (counts.get(r.service_id) ?? 0) + 1)

  // Nombre sugerido: la primera actividad de hoy en el calendario (p. ej. "Culto dominical").
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todays = summaryRules((schRes.data ?? []) as ScheduleSummaryRow[])
    .filter((s) => occursOn(s, today))
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  return {
    capacity: churchRes.data?.capacity ?? null,
    services,
    counts,
    people: (peopleRes.data ?? []).filter((p) => p.status !== 'archived'),
    suggestedName: todays[0]?.name ?? 'Culto',
    attendance: active ? rows.filter((r) => r.service_id === active.id) : [],
  }
}

// Iniciar culto: el pastor abre el servicio, comparte el código para asistir
// en línea y ve llegar a la gente. Quien no tiene la app se registra a mano.
export default function Service() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [name, setName] = useState<string | null>(null) // null = usar el sugerido
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    if (!churchId) return
    const s = await fetchSnapshot(churchId)
    setSnap(s)
  }, [churchId])

  useEffect(() => {
    if (!churchId) return
    fetchSnapshot(churchId).then(setSnap)
  }, [churchId])

  const active = snap?.services.find((s) => s.status === 'active') ?? null
  const activeId = active?.id

  // Lista en vivo: Realtime + sondeo de respaldo + reloj del contador.
  useEffect(() => {
    if (!activeId) return
    const channel = supabase
      .channel(`asistencia-${activeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `service_id=eq.${activeId}` }, () => { refresh() })
      .subscribe()
    const poll = setInterval(() => { refresh() }, POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [activeId, refresh])

  const attendance = useMemo(() => snap?.attendance ?? [], [snap])
  const present = useMemo(() => new Set(attendance.map((a) => a.member_id)), [attendance])
  const nameOf = useMemo(() => new Map((snap?.people ?? []).map((p) => [p.id, p.full_name])), [snap])

  if (membershipLoading || (churchId && !snap)) return <PageLoading />
  if (!membership || !snap) return <Navigate to="/onboarding" replace />

  const start = async () => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('services').insert({
      church_id: membership.churchId,
      name: (name ?? snap.suggestedName).trim() || 'Culto',
      starts_at: new Date().toISOString(),
      status: 'active',
      online_code: generateOnlineCode(),
    })
    if (error) {
      console.error('services.insert', error)
      setError(
        error.code === '23505'
          ? 'Ya hay un culto en curso.'
          : error.code === '42501'
            ? 'La base de datos aún no permite registrar cultos: falta aplicar la migración services_live en Supabase.'
            : `No se pudo iniciar el culto (${error.message}).`,
      )
    }
    setNow(Date.now())
    await refresh()
    setBusy(false)
  }

  const end = async () => {
    if (!active) return
    setBusy(true)
    const { error } = await supabase.from('services').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', active.id)
    if (error) setError('No se pudo terminar el culto.')
    setConfirmEnd(false)
    setName(null)
    await refresh()
    setBusy(false)
  }

  const mark = async (memberId: string) => {
    if (!active || present.has(memberId)) return
    // Optimista: aparece ya en la lista; la recarga trae el id real.
    setSnap((s) => s && { ...s, attendance: [{ id: `tmp-${memberId}`, member_id: memberId, type: 'presential', checked_at: new Date().toISOString() }, ...s.attendance] })
    const { error } = await supabase.from('attendance').insert({ member_id: memberId, church_id: membership.churchId, service_id: active.id, type: 'presential' })
    if (error && error.code !== '23505') setError('No se pudo registrar la asistencia.')
    refresh()
  }

  const unmark = async (row: LiveAttendance) => {
    setSnap((s) => s && { ...s, attendance: s.attendance.filter((a) => a.id !== row.id) })
    if (!row.id.startsWith('tmp-')) await supabase.from('attendance').delete().eq('id', row.id)
    refresh()
  }

  const errorBox = error && (
    <p className="mb-5 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">{error}</p>
  )

  // ── Sin culto en curso ──────────────────────────────────────────────
  if (!active) {
    const history = snap.services.filter((s) => s.status === 'ended')
    return (
      <PageShell title="Culto" subtitle="Abre la asistencia del culto y mira quién llega, sin pasar lista." width="mid">
        {errorBox}
        <section className="subir tarjeta p-6 sm:p-8">
          <label htmlFor="svc-name" className="text-[0.7rem] font-semibold uppercase tracking-wider text-graysage">Nombre del servicio</label>
          <input id="svc-name" className={`${fieldCls} mt-2`} value={name ?? snap.suggestedName} onChange={(e) => setName(e.target.value)} />
          <button type="button" onClick={start} disabled={busy} className={`${btnPrimary} mt-5 h-14 w-full text-base`}>
            <Icon><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></Icon>
            {busy ? 'Iniciando…' : 'Iniciar servicio'}
          </button>
          <p className="mt-3 text-center text-sm text-graysage">Se genera un código para quien asiste en línea.</p>
        </section>

        <section className="subir mt-8" style={{ animationDelay: '60ms' }}>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="font-serif text-2xl text-charcoal">Últimos cultos</h2>
            <Link to="/culto/historial" className="text-sm font-semibold text-sage-dark hover:underline">Ver historial →</Link>
          </div>
          {history.length === 0 ? (
            <p className="tarjeta px-4 py-8 text-center text-sm text-graysage">Aún no hay cultos registrados. El primero aparecerá aquí al terminarlo.</p>
          ) : (
            <ul className="tarjeta divide-y divide-clay-light/70">
              {history.map((s) => {
                const n = snap.counts.get(s.id) ?? 0
                return (
                  <li key={s.id}>
                    <Link to={`/culto/historial/${s.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-charcoal">{s.name}</p>
                      <p className="text-xs capitalize text-graysage">{s.starts_at ? `${DATE.format(new Date(s.starts_at))} · ${TIME.format(new Date(s.starts_at))}` : '—'}</p>
                    </div>
                    <p className="text-right">
                      <span className="text-2xl font-bold tracking-tight tabular-nums text-sage-dark">{n}</span>
                      <span className="block text-xs text-graysage">{snap.capacity ? `${Math.round((n * 100) / snap.capacity)}% ocupación` : 'asistentes'}</span>
                    </p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </PageShell>
    )
  }

  // ── Culto en curso ──────────────────────────────────────────────────
  const totals = countByType(attendance)
  const q = search.trim().toLowerCase()
  const missing = snap.people.filter((p) => !present.has(p.id) && (!q || p.full_name.toLowerCase().includes(q)))
  const sorted = [...attendance].sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))

  return (
    <PageShell
      title={active.name}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sage-dark" />
          </span>
          En curso · desde {active.starts_at ? TIME.format(new Date(active.starts_at)) : '—'} ({active.starts_at ? elapsedLabel(active.starts_at, now) : '—'})
        </span>
      }
      actions={
        confirmEnd ? (
          <>
            <span className="text-sm text-graysage">¿Terminar el culto?</span>
            <button type="button" onClick={() => setConfirmEnd(false)} className={btnSecondary}>No</button>
            <button type="button" onClick={end} disabled={busy} className={btnPrimary}>Sí, terminar</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmEnd(true)} className={btnSecondary}>Terminar culto</button>
        )
      }
    >
      {errorBox}
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="subir tarjeta flex flex-col justify-between p-6">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-graysage">Asistentes</p>
          <p className="mt-2 text-7xl font-bold leading-none tracking-[-0.04em] tabular-nums text-sage-dark" aria-live="polite">{totals.total}</p>
          <p className="mt-3 text-sm text-graysage">
            {totals.presential} presenciales · {totals.online} en línea
            {snap.capacity ? <> · <span className="font-semibold text-charcoal">{Math.round((totals.total * 100) / snap.capacity)}%</span> de {snap.capacity} sillas</> : null}
          </p>
        </section>
        <section className="subir tarjeta p-6" style={{ animationDelay: '60ms' }}>
          <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-graysage">Código para asistir en línea</p>
          <p className="mt-3 select-all font-mono text-5xl tracking-wider text-charcoal">{formatOnlineCode(active.online_code)}</p>
          <p className="mt-3 text-sm text-graysage">Compártelo en la transmisión. Quien lo ingrese en la app queda como asistente en línea.</p>
        </section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="subir" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 font-serif text-2xl text-charcoal">Llegaron</h2>
          {sorted.length === 0 ? (
            <p className="tarjeta px-4 py-8 text-center text-sm text-graysage">Todavía nadie. Aparecerán aquí al hacer check-in, o márcalos a mano.</p>
          ) : (
            <ul className="tarjeta divide-y divide-clay-light/70">
              {sorted.map((a) => {
                const who = (a.member_id && nameOf.get(a.member_id)) || 'Persona'
                return (
                  <li key={a.id} className="group flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={who} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-charcoal">{who}</p>
                      <p className="text-xs text-graysage">
                        {a.type === 'online' ? 'En línea' : 'Presencial'}
                        {a.checked_at && ` · ${TIME.format(new Date(a.checked_at))}`}
                      </p>
                    </div>
                    <button type="button" onClick={() => unmark(a)} className="rounded-lg px-2 py-1 text-xs text-graysage transition hover:bg-cream hover:text-danger" aria-label={`Quitar a ${who}`}>
                      Quitar
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="subir" style={{ animationDelay: '180ms' }}>
          <h2 className="mb-3 font-serif text-2xl text-charcoal">Registrar a mano</h2>
          <div className="relative mb-3">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"><Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar persona…" className={`${fieldCls} pl-11`} aria-label="Buscar persona" />
          </div>
          {missing.length === 0 ? (
            <p className="tarjeta px-4 py-8 text-center text-sm text-graysage">{q ? 'Nadie coincide con la búsqueda.' : 'Todos ya están registrados.'}</p>
          ) : (
            <ul className="tarjeta max-h-[28rem] divide-y divide-clay-light/70 overflow-y-auto">
              {missing.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => mark(p.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-cream">
                    <Avatar name={p.full_name} size={34} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-charcoal">{p.full_name}</span>
                    <span className="shrink-0 rounded-full bg-sage-light px-2.5 py-1 text-xs font-semibold text-sage-dark">+ Llegó</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  )
}
