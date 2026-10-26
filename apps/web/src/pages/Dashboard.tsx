import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'

interface Church {
  name: string
  code: string
  plan: string | null
  country: string | null
}

interface Metrics {
  total_members: number | null
  active_members: number | null
  active_pct: number | null
  avg_attendance: number | null
}

// Tarjeta de métrica (KPI) con tinte verde suave sobre la lámina blanca.
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-sage/15 bg-sage-light/50 p-5">
      <p className="font-serif text-3xl font-semibold text-sage-dark">{value}</p>
      <p className="mt-1 text-sm text-graysage">{label}</p>
    </div>
  )
}

// Acceso rápido. `tone`: 'beige' (cálido puntual), 'sage' (tinte verde) o 'plain'.
function QuickLink({ to, title, desc, tone = 'plain' }: { to: string; title: string; desc: string; tone?: 'beige' | 'sage' | 'plain' }) {
  const bg =
    tone === 'beige' ? 'border-transparent bg-beige hover:brightness-[0.98]'
    : tone === 'sage' ? 'border-sage/15 bg-sage-light/60 hover:brightness-[0.98]'
    : 'border-black/5 bg-white hover:border-sage/40 hover:shadow-sm'
  return (
    <Link to={to} className={`group flex flex-col rounded-2xl border p-6 transition ${bg}`}>
      <p className="font-serif text-lg font-semibold text-charcoal">{title}</p>
      <p className="mt-1 text-sm text-graysage">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-sage-dark">
        Abrir <span className="transition group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  )
}

// Panel del pastor: hero oscuro + panel claro flotante con métricas reales.
export default function Dashboard() {
  const { membership, membershipLoading } = useAuth()
  const [church, setChurch] = useState<Church | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    if (!membership) return
    const id = membership.churchId
    supabase.from('churches').select('name, code, plan, country').eq('id', id).maybeSingle().then(({ data }) => setChurch(data))
    supabase.from('church_dashboard').select('total_members, active_members, active_pct, avg_attendance').eq('church_id', id).maybeSingle().then(({ data }) => setMetrics(data))
  }, [membership])

  // Stack vertical: CALENDARIO arriba · PRINCIPAL (hero) en medio · DASHBOARD
  // abajo. Arrancamos en el medio (la principal). Scroll abajo → sube el
  // dashboard (de abajo hacia arriba); scroll arriba → baja el calendario (de
  // arriba hacia abajo). Ambos cubren la principal; en el medio no se ve ninguno.
  const [dashY, setDashY] = useState(100) // 100 oculto abajo → 0 cubriendo
  const [calY, setCalY] = useState(-100) // -100 oculto arriba → 0 cubriendo
  useEffect(() => {
    if (membershipLoading || !membership) return // esperar a que exista la pista de scroll
    const vh = () => window.innerHeight
    // Banda neutral de MEDIA pantalla [h, 1.5h] donde se ve SOLO la principal
    // (fácil de encuadrar). Debajo de h → baja el calendario; por encima de 1.5h → sube el dashboard.
    const onScroll = () => {
      const h = vh()
      const y = window.scrollY
      if (y <= h) { const p = Math.min(1, (h - y) / h); setCalY(-100 + p * 100); setDashY(100) }
      else if (y >= 1.5 * h) { const p = Math.min(1, (y - 1.5 * h) / h); setDashY(100 - p * 100); setCalY(-100) }
      else { setCalY(-100); setDashY(100) } // zona neutral: la principal
    }
    window.scrollTo(0, vh() * 1.25) // arrancar en el centro de la banda neutral
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [membershipLoading, membership])

  if (membershipLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#262e29]">
        <p className="text-sm text-white/60">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  return (
    <>
      {/* Pista de scroll: calendario [0,1] · neutral [1,1.5] · dashboard [1.5,2.5] (+1 viewport) */}
      <div className="h-[350vh]" aria-hidden />

      {/* PRINCIPAL (hero) — en el medio, fija detrás; foto + capa oscura translúcida */}
      <section className="fixed inset-0 z-0 flex flex-col overflow-hidden text-white">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/hero-bg.webp')" }} aria-hidden />
        <div className="absolute inset-0 bg-[#1b221d]/[0.88]" aria-hidden />
        <div className="pointer-events-none absolute -right-32 -top-40 h-[32rem] w-[32rem] rounded-full bg-sage/20 blur-[130px]" aria-hidden />
        <div className="pointer-events-none absolute -left-40 bottom-10 h-[26rem] w-[26rem] rounded-full bg-sage-dark/25 blur-[130px]" aria-hidden />

        <div className="relative">
          <AppHeader dark />
        </div>
        <div className="relative flex flex-1 items-center justify-center px-6 pb-16">
          <div className="max-w-3xl text-center">
            <span className="inline-block rounded-full bg-sage px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wider text-charcoal">
              Panel del pastor
            </span>
            <h1 className="mt-5 font-serif text-4xl font-semibold leading-tight text-white sm:text-5xl">
              {church ? church.name : 'Bienvenido'}
            </h1>
            <p className="mx-auto mt-3 max-w-md text-white/70">Tu comunidad, en un vistazo.</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link to="/miembros" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-white/90">
                Ver miembros
              </Link>
              <Link to="/calendario" className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10">
                Calendario
              </Link>
            </div>
            {church && (
              <p className="mt-5 text-sm text-sage">
                <span className="font-mono">{church.code}</span>
                {church.plan && <span className="capitalize text-white/50"> · {church.plan.replace('_', ' ')}</span>}
                {church.country && <span className="text-white/50"> · {church.country}</span>}
              </p>
            )}
            <p className="mt-10 text-xs text-white/40">↑ Calendario&nbsp;&nbsp;·&nbsp;&nbsp;Resumen ↓</p>
          </div>
        </div>
      </section>

      {/* CALENDARIO — arriba; BAJA al hacer scroll hacia arriba (fondo blanco) */}
      <section
        style={{ transform: `translateY(${calY}%)`, pointerEvents: calY <= -99 ? 'none' : 'auto' }}
        className="fixed inset-0 z-10 flex items-center justify-center overflow-hidden rounded-b-[2.5rem] bg-white shadow-[0_14px_40px_-14px_rgba(0,0,0,0.4)] will-change-transform"
      >
        <div className="max-w-2xl px-6 py-16 text-center">
          <span className="inline-block rounded-full bg-sage px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wider text-charcoal">
            Calendario
          </span>
          <h2 className="mt-5 font-serif text-3xl font-semibold leading-tight text-charcoal sm:text-4xl">
            El ritmo de la iglesia
          </h2>
          <p className="mx-auto mt-3 max-w-md text-graysage">
            Define tus actividades una vez y el sistema proyecta la semana, con encargados y ciclos.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-5 text-sm text-graysage">
            <span>Semana · Día · Mes</span>
            <span className="text-sage-dark">Encargados</span>
            <span>Ciclos</span>
          </div>
          <Link to="/calendario" className="mt-8 inline-block rounded-full bg-sage-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
            Abrir calendario
          </Link>
        </div>
      </section>

      {/* DASHBOARD (resumen) — abajo; SUBE al hacer scroll hacia abajo */}
      <section
        style={{ transform: `translateY(${dashY}%)`, pointerEvents: dashY >= 99 ? 'none' : 'auto' }}
        className="fixed inset-0 z-10 flex items-center overflow-hidden rounded-t-[2.5rem] bg-white shadow-[0_-14px_40px_-14px_rgba(0,0,0,0.4)] will-change-transform"
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-10">
          <h2 className="mb-5 font-serif text-xl font-semibold text-charcoal">Resumen</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Miembros" value={metrics?.total_members ?? 0} />
            <Stat label="Activos" value={metrics?.active_members ?? 0} />
            <Stat label="% Activos" value={`${metrics?.active_pct ?? 0}%`} />
            <Stat label="Asistencia prom." value={metrics?.avg_attendance ?? 0} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <QuickLink to="/miembros" tone="beige" title="Miembros" desc="Agrega personas, asigna roles y equipos, y aprueba prospectos." />
            <QuickLink to="/calendario" tone="sage" title="Calendario" desc="El ritmo de la iglesia: actividades, encargados y ciclos." />
            <QuickLink to="/ajustes" title="Ajustes" desc="Datos de la iglesia, equipos, roles y reglas." />
          </div>
        </div>
      </section>
    </>
  )
}
