import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { formatTime, occursOn, SCHEDULE_SUMMARY_COLUMNS, summaryRules, type ScheduleSummaryRow } from '../lib/activity'
import { remember } from '../lib/remember'
import { ATTENDANCE_WINDOW_DAYS, pastoralWeek, type PastoralWeek, type WeekItem } from '../lib/pastoral'
import { churchInsights, type InsightMember, type InsightService } from '../lib/insights'
import PageShell, { PageLoading } from '../components/PageShell'
import Avatar from '../components/Avatar'
import WelcomeBand from '../components/WelcomeBand'
import { AttendanceColumns, Funnel, Legend, Meter, Segments, Sparkline, type ServicePoint } from '../components/charts'
import { SERIES } from '../lib/ui'

interface Church {
  name: string
  code: string
  plan: string | null
  country: string | null
  capacity: number | null
}

// Datos crudos para los indicadores (se recalculan al aprobar/rechazar).
interface Raw {
  members: (InsightMember & { full_name: string; birth_date: string | null })[]
  teams: { member_id: string; is_leader: boolean | null }[]
  services: InsightService[]
}

// Ocurrencia de una actividad en los próximos días.
interface Upcoming {
  key: string
  name: string
  date: Date
  start: string | null
  color: string
}

const SHORT_FMT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
const DAY_FMT = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric' })
const NUM = new Intl.NumberFormat('es')

function Icon({ children, className = 'h-[18px] w-[18px]' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

const I = {
  chart: <><path d="M3 20h18" /><path d="M6 16V9M11 16V5M16 16v-4M21 16V8" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" /></>,
  calendarCheck: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>,
  hands: <><path d="M7 11V7a5 5 0 0 1 10 0v4" /><path d="M4 11h16v4a8 8 0 0 1-16 0z" /></>,
  personPlus: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cake: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0" /><path d="M12 12V8" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
}

// Número que cuenta desde 0 al cargar (sin animación si se pidió menos movimiento).
function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const dur = reduce ? 0 : 800
    let raf = requestAnimationFrame(function tick(t) {
      const k = dur ? Math.min(1, (t - start) / dur) : 1
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{NUM.format(v)}{suffix}</>
}

// Tarjeta con título: todas las secciones usan la misma cabecera.
function Panel({ title, sub, action, className = '', delay = 0, children }: { title: string; sub?: string; action?: ReactNode; className?: string; delay?: number; children: ReactNode }) {
  return (
    <section className={`subir vidrio flex flex-col p-5 ${className}`} style={{ animationDelay: `${delay}ms` }} aria-label={title}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-xl leading-tight text-charcoal">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-graysage">{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

// Indicador pequeño: cabecera, número, contexto y mini gráfico a la misma altura.
// Sin datos muestra qué hacer (`empty`) en vez de un "—".
function Stat({ label, value, icon, chip, foot, viz, empty, className = '', delay = 0 }: { label: string; value: ReactNode; icon: ReactNode; chip?: ReactNode; foot: ReactNode; viz?: ReactNode; empty?: { text: string; to: string; cta: string } | null; className?: string; delay?: number }) {
  return (
    <div className={`subir vidrio group flex flex-col p-5 transition duration-300 hover:-translate-y-0.5 ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex h-9 items-center justify-between gap-3">
        <p className="line-clamp-2 text-xs font-semibold uppercase leading-tight tracking-wider text-graysage">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-dark/[0.08] text-sage-dark transition group-hover:bg-sage-dark group-hover:text-paper">
          <Icon>{icon}</Icon>
        </span>
      </div>
      {empty ? (
        <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
          <p className="text-sm leading-snug text-graysage">{empty.text}</p>
          <Link to={empty.to} className="inline-flex w-fit items-center gap-1 rounded-full bg-sage-dark px-3.5 py-1.5 text-xs font-semibold text-paper transition hover:bg-sage-deep">
            {empty.cta} →
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-3 flex h-10 items-end gap-2.5">
            <p className="text-[2.4rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-charcoal">{value}</p>
            {chip}
          </div>
          <p className="mt-2 line-clamp-2 h-8 text-xs leading-4 text-graysage">{foot}</p>
          <div className="mt-4 flex h-9 items-end">{viz ?? <div className="h-px w-full bg-charcoal/[0.08]" />}</div>
        </>
      )}
    </div>
  )
}

// Variación: verde si sube, neutra si baja o no cambia.
function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const up = value > 0
  return (
    <span className={`mb-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${up ? 'bg-sage-light text-sage-dark' : 'bg-charcoal/[0.06] text-graysage'}`}>
      {up ? '↑ +' : value < 0 ? '↓ ' : '· '}{value}{suffix}
    </span>
  )
}

// Lista corta de personas con cara y enlace a su perfil.
function PeopleList({ items, empty }: { items: WeekItem[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-graysage">{empty}</p>
  return (
    <ul className="space-y-0.5">
      {items.slice(0, 4).map((it) => (
        <li key={it.id}>
          <Link to={`/miembros/${it.id}`} className="-mx-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-white/70">
            <Avatar name={it.name} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-charcoal">{it.name}</span>
              <span className="block text-xs text-graysage">{it.note}</span>
            </span>
          </Link>
        </li>
      ))}
      {items.length > 4 && <li className="pt-1 text-xs text-graysage">y {items.length - 4} más</li>}
    </ul>
  )
}

// Fila de "Pendientes": un número con su acción.
function PendingRow({ icon, count, label, done, action }: { icon: ReactNode; count: number; label: string; done: string; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${count ? 'bg-vela-light text-clay' : 'bg-sage-light text-sage-dark'}`}>
        <Icon className="h-4 w-4">{icon}</Icon>
      </span>
      <span className="min-w-0 flex-1 text-sm leading-tight">
        {count ? (
          <><b className="tabular-nums text-charcoal">{count}</b> <span className="text-graysage">{label}</span></>
        ) : (
          <span className="text-graysage">{done}</span>
        )}
      </span>
      {count > 0 && action}
    </li>
  )
}

// Ventana para aprobar o rechazar prospectos sin salir del Dashboard.
function ApprovalsDialog({ items, onDecide, onClose }: { items: WeekItem[]; onDecide: (id: string, status: 'active' | 'archived') => void; onClose: () => void }) {
  const [rejecting, setRejecting] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/40 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Por aprobar" className="subir w-full max-w-lg overflow-hidden rounded-[1.5rem] bg-paper shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-clay-light px-5 py-4">
          <h2 className="font-serif text-xl text-charcoal">Por aprobar</h2>
          <span className="rounded-full bg-vela-light px-2 py-0.5 text-xs font-semibold text-clay">{items.length}</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-full p-1.5 text-graysage transition hover:bg-cream hover:text-charcoal" aria-label="Cerrar">
            <Icon><path d="M6 6l12 12M18 6 6 18" /></Icon>
          </button>
        </header>
        {items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-graysage">Listo: no queda nadie por aprobar.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-clay-light/70 overflow-y-auto">
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Link to={`/miembros/${p.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Avatar name={p.name} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-charcoal">{p.name}</span>
                    <span className="block text-xs text-graysage">{p.note}</span>
                  </span>
                </Link>
                {rejecting === p.id ? (
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-graysage">¿Rechazar?</span>
                    <button type="button" onClick={() => setRejecting(null)} className="rounded-lg px-2.5 py-1.5 font-medium text-graysage hover:bg-cream">No</button>
                    <button type="button" onClick={() => onDecide(p.id, 'archived')} className="rounded-lg border border-danger/30 px-2.5 py-1.5 font-semibold text-danger hover:bg-danger/5">Sí, rechazar</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => setRejecting(p.id)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-graysage transition hover:bg-cream hover:text-danger">Rechazar</button>
                    <button type="button" onClick={() => onDecide(p.id, 'active')} className="rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-semibold text-paper transition hover:bg-sage-deep">Aprobar</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// Dashboard del pastor en rejilla bento: el último culto manda (tarjeta grande
// con su gráfico), al lado la salud de la iglesia y lo pendiente; debajo el
// camino de discipulado, la semana y la agenda.
export default function Dashboard() {
  const { membership, membershipLoading } = useAuth()
  const [church, setChurch] = useState<Church | null>(null)
  const [raw, setRaw] = useState<Raw | null>(null)
  const [upcoming, setUpcoming] = useState<Upcoming[]>([])
  const [week, setWeek] = useState<PastoralWeek | null>(null)
  const [live, setLive] = useState<{ name: string; count: number } | null>(null)
  const [decideError, setDecideError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  useEffect(() => {
    if (!membership) return
    const id = membership.churchId
    supabase.from('churches').select('name, code, plan, country, capacity').eq('id', id).maybeSingle().then(({ data }) => {
      setChurch(data)
      if (data?.name) remember({ church: data.name }) // para saludar en el próximo login
    })
    // Miembros, equipos, asistencias recientes y los últimos 10 cultos.
    const since = new Date(Date.now() - ATTENDANCE_WINDOW_DAYS * 86400000).toISOString()
    Promise.all([
      supabase.from('members').select('id, full_name, birth_date, status, created_at, is_baptized').eq('church_id', id),
      supabase.from('attendance').select('member_id, checked_at').eq('church_id', id).gte('checked_at', since),
      supabase.from('services').select('id, name, starts_at').eq('church_id', id).neq('status', 'active').order('starts_at', { ascending: false }).limit(10),
      supabase.from('member_teams').select('member_id, is_leader'),
    ]).then(async ([memRes, attRes, svcRes, teamRes]) => {
      setWeek(pastoralWeek(memRes.data ?? [], attRes.data ?? []))
      const svcs = (svcRes.data ?? []).slice().reverse()
      const { data: att } = svcs.length
        ? await supabase.from('attendance').select('service_id, member_id, type').in('service_id', svcs.map((s) => s.id))
        : { data: [] as { service_id: string | null; member_id: string | null; type: string | null }[] }
      setRaw({
        members: memRes.data ?? [],
        teams: teamRes.data ?? [],
        services: svcs.map((s) => ({ ...s, attendance: (att ?? []).filter((a) => a.service_id === s.id) })),
      })
    })
    // Próximas actividades (7 días) a partir de las reglas recurrentes.
    Promise.all([
      supabase.from('activity_schedules').select(SCHEDULE_SUMMARY_COLUMNS).eq('church_id', id),
      supabase.from('activity_types').select('id, color'),
    ]).then(([schRes, typeRes]) => {
      const colorOf = new Map((typeRes.data ?? []).map((t) => [t.id, t.color as string]))
      const rules = summaryRules((schRes.data ?? []) as ScheduleSummaryRow[])
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const out: Upcoming[] = []
      for (let i = 0; i < 7; i++) {
        const d = new Date(today)
        d.setDate(d.getDate() + i)
        for (const s of rules) {
          if (occursOn(s, d)) out.push({ key: `${s.id}-${i}`, name: s.name, date: d, start: s.startTime, color: colorOf.get(s.typeId ?? '') ?? '#4A7C6F' })
        }
      }
      out.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.start ?? '').localeCompare(b.start ?? ''))
      setUpcoming(out.slice(0, 6))
    })
    // Culto en curso (si lo hay) con su número de asistentes.
    supabase.from('services').select('id, name').eq('church_id', id).eq('status', 'active').maybeSingle().then(async ({ data }) => {
      if (!data) return setLive(null)
      const { count } = await supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('service_id', data.id)
      setLive({ name: data.name, count: count ?? 0 })
    })
  }, [membership])

  const ins = useMemo(() => raw && churchInsights(raw.members, raw.teams, raw.services), [raw])
  const services: ServicePoint[] = useMemo(
    () =>
      (raw?.services ?? []).map((s) => {
        const online = s.attendance.filter((a) => a.type === 'online').length
        return { id: s.id, name: s.name, label: s.starts_at ? SHORT_FMT.format(new Date(s.starts_at)).replace('.', '') : '—', presential: s.attendance.length - online, online, capacity: church?.capacity ?? null }
      }),
    [raw, church],
  )

  if (membershipLoading) return <PageLoading />
  if (!membership) return <Navigate to="/onboarding" replace />

  const todayItem = upcoming.find((u) => u.date.toDateString() === new Date().toDateString())
  const todayLabel = todayItem ? `${todayItem.name}${todayItem.start ? ` · ${formatTime(todayItem.start)}` : ''}` : null
  const occupancy = ins?.last && church?.capacity ? Math.round((ins.last.presential / church.capacity) * 100) : null
  const prospects = week?.prospects ?? []

  // Aprobar → activo. Rechazar → archivado (sus datos se conservan).
  const decide = async (memberId: string, status: 'active' | 'archived') => {
    setWeek((w) => w && { ...w, prospects: w.prospects.filter((p) => p.id !== memberId) })
    const { error } = await supabase.from('members').update({ status }).eq('id', memberId)
    if (error) {
      setDecideError('No se pudo guardar la decisión. Recarga la página e inténtalo de nuevo.')
      return
    }
    setRaw((r) => r && { ...r, members: r.members.map((m) => (m.id === memberId ? { ...m, status } : m)) })
  }

  return (
    <PageShell aura>
      <WelcomeBand
        churchName={church?.name ?? null}
        live={live}
        today={todayLabel}
        meta={
          church && (
            <>
              <span className="font-mono text-paper/90">{church.code}</span>
              {church.plan && <span className="capitalize"> · Plan {church.plan.replace('_', ' ')}</span>}
              {church.country && <span> · {church.country}</span>}
            </>
          )
        }
      />

      {decideError && <p className="mb-4 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">{decideError}</p>}

      {/* Bento: el último culto (2×2) y a su lado los indicadores y lo pendiente */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <section className="subir vidrio col-span-2 flex flex-col p-5 sm:p-6 lg:row-span-2" aria-label="Último culto">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-graysage">Último culto{ins?.last ? ` · ${ins.last.name}` : ''}</p>
              {ins?.last ? (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <p className="text-6xl font-bold leading-none tracking-[-0.04em] tabular-nums text-charcoal"><CountUp to={ins.last.total} /></p>
                  {ins.deltaPct != null && <Delta value={ins.deltaPct} suffix="% vs. promedio" />}
                </div>
              ) : (
                <p className="mt-2 font-serif text-2xl text-charcoal">Aún no hay cultos</p>
              )}
              <p className="mt-2 text-sm text-graysage">
                {ins?.last
                  ? <>{ins.last.presential} presencial · {ins.last.online} en línea{occupancy != null && <> · <b className="text-charcoal">{occupancy}%</b> de las sillas</>}</>
                  : 'Inicia el culto y marca quién llega: aquí verás la asistencia y su tendencia.'}
              </p>
            </div>
            {services.length > 0 ? (
              <Legend items={[{ color: SERIES.main, label: 'Presencial' }, { color: SERIES.second, label: 'En línea' }]} />
            ) : (
              <Link to="/culto" className="rounded-full bg-sage-dark px-4 py-2 text-sm font-semibold text-paper transition hover:bg-sage-deep">Iniciar culto →</Link>
            )}
          </div>
          <div className="mt-auto pt-2">
            {!raw ? (
              <div className="mt-4 h-56 animate-pulse rounded-xl bg-white/50" />
            ) : services.length === 0 ? (
              <div className="mt-6 flex h-40 items-end gap-3 opacity-40" aria-hidden>
                {[40, 55, 35, 65, 50, 72, 60].map((h, i) => <span key={i} className="flex-1 rounded-t-md bg-charcoal/10" style={{ height: `${h}%` }} />)}
              </div>
            ) : (
              <AttendanceColumns data={services} height={240} />
            )}
          </div>
        </section>

        <Stat
          label="Miembros"
          value={ins ? <CountUp to={ins.members} /> : '—'}
          icon={I.people}
          chip={ins?.newThisMonth ? <Delta value={ins.newThisMonth} suffix=" este mes" /> : undefined}
          foot="Crecimiento, últimos 6 meses"
          viz={ins ? <Sparkline values={ins.growth.map((g) => g.value)} /> : undefined}
          delay={50}
        />
        <Stat
          label="Vienen con constancia"
          value={ins?.regular ? <CountUp to={ins.regular.pct} suffix="%" /> : '—'}
          icon={I.calendarCheck}
          foot={ins?.regular ? `${ins.regular.count} de ${ins.members} vinieron a ${Math.ceil(ins.regular.window / 2)}+ de los últimos ${ins.regular.window}` : ''}
          viz={ins?.regular ? <Segments pct={ins.regular.pct} /> : undefined}
          empty={ins && !ins.regular ? { text: 'Se calcula cuando registres 2 cultos o más.', to: '/culto', cta: 'Ir a Culto' } : null}
          delay={100}
        />
        <Stat
          label="Sirven en un equipo"
          value={ins ? <CountUp to={ins.serving.pct} suffix="%" /> : '—'}
          icon={I.hands}
          foot={ins ? `${ins.serving.count} de ${ins.members} · ${ins.leaders} ${ins.leaders === 1 ? 'líder' : 'líderes'}` : ''}
          viz={ins ? <Meter value={ins.serving.count} total={ins.members} /> : undefined}
          empty={ins && ins.members > 0 && ins.serving.count === 0 ? { text: 'Nadie sirve aún. Asigna equipos desde el perfil de cada miembro.', to: '/miembros', cta: 'Ir a Miembros' } : null}
          className="col-span-2 lg:col-span-1"
          delay={150}
        />

        {/* Pendientes: lo que pide acción hoy, compacto */}
        <section className="subir vidrio col-span-2 flex flex-col p-5 lg:col-span-1" style={{ animationDelay: '200ms' }} aria-label="Pendientes">
          <div className="flex h-9 items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-graysage">Pendientes</p>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-vela-light text-clay"><Icon>{I.bell}</Icon></span>
          </div>
          <ul className="mt-1 divide-y divide-charcoal/[0.06]">
            <PendingRow
              icon={I.personPlus}
              count={prospects.length}
              label={prospects.length === 1 ? 'por aprobar' : 'por aprobar'}
              done="Nadie por aprobar"
              action={
                <button type="button" onClick={() => setApproving(true)} className="flex items-center gap-1.5 rounded-full bg-sage-dark py-1 pl-1 pr-3 text-xs font-semibold text-paper transition hover:bg-sage-deep">
                  <span className="flex -space-x-2">{prospects.slice(0, 2).map((p) => <span key={p.id} className="rounded-full ring-2 ring-sage-dark"><Avatar name={p.name} size={20} /></span>)}</span>
                  Revisar
                </button>
              }
            />
            <PendingRow
              icon={I.clock}
              count={week?.absent.length ?? 0}
              label="por visitar"
              done={week?.tracksAttendance ? 'Nadie falta hace 3 semanas' : 'Sin asistencia aún'}
              action={<a href="#semana" className="text-xs font-semibold text-clay hover:underline">Ver</a>}
            />
            <PendingRow
              icon={I.cake}
              count={week?.birthdays.length ?? 0}
              label="cumplen esta semana"
              done="Sin cumpleaños esta semana"
              action={<a href="#semana" className="text-xs font-semibold text-clay hover:underline">Ver</a>}
            />
          </ul>
        </section>
      </div>

      {/* Fila inferior: discipulado (ancho), la semana y la agenda */}
      <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-4">
        <Panel title="Camino de discipulado" sub="Cuántos avanzan en cada paso, sobre el total de miembros" className="lg:col-span-2" delay={60}>
          {ins ? (
            <Funnel
              steps={[
                { label: 'Miembros', value: ins.members, hint: 'en la iglesia' },
                { label: 'Constantes', value: ins.regular?.count ?? 0, hint: ins.regular ? 'vienen seguido' : 'faltan cultos' },
                { label: 'Bautizados', value: ins.baptized.count, hint: 'dieron el paso' },
                { label: 'Sirven', value: ins.serving.count, hint: 'en un equipo' },
                { label: 'Líderes', value: ins.leaders, hint: 'guían un equipo' },
              ]}
            />
          ) : (
            <div className="h-56 animate-pulse rounded-xl bg-white/50" />
          )}
          {ins && ins.members > 0 && (
            <p className="mt-5 flex items-start gap-2 rounded-xl bg-vela-light/80 px-3 py-2.5 text-sm text-clay">
              <Icon className="mt-0.5 h-4 w-4 shrink-0"><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" /></Icon>
              {ins.serving.count === 0
                ? 'Aún nadie sirve en un equipo: asígnalos desde el perfil de cada miembro.'
                : ins.serving.pct < 30
                  ? `Solo ${ins.serving.pct}% sirve en un equipo: invita a alguien constante a servir.`
                  : ins.baptized.pct < 50
                    ? `${ins.members - ins.baptized.count} miembros aún no se bautizan: buen momento para una clase.`
                    : 'Buen avance: la mayoría ya da pasos de compromiso.'}
            </p>
          )}
        </Panel>

        <div id="semana" className="scroll-mt-24">
          <Panel title="Esta semana" sub="Personas que necesitan tu atención" className="h-full" delay={100}>
            {week ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-clay"><Icon className="h-3.5 w-3.5">{I.clock}</Icon>Por visitar</p>
                  <PeopleList items={week.absent} empty={week.tracksAttendance ? 'Todos han venido en las últimas 3 semanas.' : 'Cuando registres asistencia, aquí verás a quién visitar.'} />
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-clay"><Icon className="h-3.5 w-3.5">{I.cake}</Icon>Cumpleaños</p>
                  <PeopleList items={week.birthdays} empty="Nadie cumple años en los próximos 7 días." />
                </div>
              </div>
            ) : (
              <div className="h-40 animate-pulse rounded-xl bg-white/50" />
            )}
          </Panel>
        </div>

        <Panel title="Próximos 7 días" sub="Del calendario" action={<Link to="/calendario" className="shrink-0 text-xs font-semibold text-sage-dark hover:underline">Ver todo →</Link>} delay={140}>
          {upcoming.length === 0 ? (
            <div className="flex flex-1 flex-col items-start justify-center gap-3">
              <p className="text-sm text-graysage">Sin actividades esta semana.</p>
              <Link to="/calendario" className="rounded-full bg-sage-dark px-3.5 py-1.5 text-xs font-semibold text-paper transition hover:bg-sage-deep">Crear actividad →</Link>
            </div>
          ) : (
            <ul className="-mx-1 space-y-1">
              {upcoming.map((u) => (
                <li key={u.key} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
                  <span className="flex w-10 shrink-0 flex-col items-center rounded-lg bg-white/70 py-1 leading-none">
                    <span className="text-[0.65rem] font-semibold uppercase text-graysage">{DAY_FMT.format(u.date).split(' ')[0].replace('.', '')}</span>
                    <span className="mt-0.5 text-base font-bold tabular-nums text-charcoal">{u.date.getDate()}</span>
                  </span>
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: u.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-charcoal">{u.name}</p>
                    {u.start && <p className="font-mono text-xs text-graysage">{formatTime(u.start)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {approving && <ApprovalsDialog items={prospects} onDecide={decide} onClose={() => setApproving(false)} />}
    </PageShell>
  )
}
