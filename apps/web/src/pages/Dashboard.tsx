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

// Tarjeta de métrica (KPI centrado en personas).
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-clay-light/40 bg-white p-5">
      <p className="font-serif text-3xl text-sage-water">{value}</p>
      <p className="mt-1 text-sm text-graysage">{label}</p>
    </div>
  )
}

// Panel del pastor con métricas reales (vista church_dashboard).
export default function Dashboard() {
  const { membership, membershipLoading } = useAuth()
  const [church, setChurch] = useState<Church | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    if (!membership) return
    const id = membership.churchId
    supabase
      .from('churches')
      .select('name, code, plan, country')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setChurch(data))
    supabase
      .from('church_dashboard')
      .select('total_members, active_members, active_pct, avg_attendance')
      .eq('church_id', id)
      .maybeSingle()
      .then(({ data }) => setMetrics(data))
  }, [membership])

  // Gate: con sesión pero sin iglesia → onboarding.
  if (membershipLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-serif text-3xl text-charcoal">
          {church ? church.name : 'Bienvenido'}
        </h1>
        {church && (
          <p className="mt-2 flex flex-wrap items-center gap-3 text-graysage">
            <span className="font-mono text-sm text-sage-dark">{church.code}</span>
            {church.plan && (
              <span className="rounded-full bg-sage-water/15 px-2.5 py-0.5 text-xs font-medium capitalize text-sage-dark">
                {church.plan.replace('_', ' ')}
              </span>
            )}
            {church.country && <span className="text-sm">{church.country}</span>}
          </p>
        )}

        {/* Métricas centradas en personas */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Miembros" value={metrics?.total_members ?? 0} />
          <Stat label="Activos" value={metrics?.active_members ?? 0} />
          <Stat label="% Activos" value={`${metrics?.active_pct ?? 0}%`} />
          <Stat label="Asistencia prom." value={metrics?.avg_attendance ?? 0} />
        </div>

        <div className="mt-4">
          <Link
            to="/miembros"
            className="block rounded-2xl border border-clay-light/40 bg-white p-6 transition hover:border-sage hover:shadow-sm"
          >
            <p className="font-serif text-lg text-sage-dark">Miembros</p>
            <p className="mt-1 text-sm text-graysage">
              Gestiona tu comunidad: agrega personas, asigna roles y equipos, y
              aprueba prospectos.
            </p>
          </Link>
        </div>
      </main>
    </div>
  )
}
