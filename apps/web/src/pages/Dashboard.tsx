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

// Panel del pastor. Las métricas reales llegan en el Paso 5.
export default function Dashboard() {
  const { membership, membershipLoading } = useAuth()
  const [church, setChurch] = useState<Church | null>(null)

  useEffect(() => {
    if (!membership) return
    supabase
      .from('churches')
      .select('name, code, plan, country')
      .eq('id', membership.churchId)
      .maybeSingle()
      .then(({ data }) => setChurch(data))
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

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            to="/miembros"
            className="rounded-2xl border border-clay-light/40 bg-white p-6 transition hover:border-sage hover:shadow-sm"
          >
            <p className="font-serif text-lg text-sage-dark">Miembros</p>
            <p className="mt-1 text-sm text-graysage">
              Gestiona tu comunidad: agrega personas, asigna roles y equipos, y
              aprueba prospectos.
            </p>
          </Link>

          <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
            <p className="font-serif text-lg text-graysage/70">Métricas</p>
            <p className="mt-1 text-sm text-graysage">
              El panel con métricas reales (miembros activos, asistencia) llega en
              el <span className="font-medium text-sage-dark">Paso 5</span>.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
