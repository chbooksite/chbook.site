import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'

interface Church {
  name: string
  code: string
  plan: string | null
  country: string | null
}

// Panel del pastor. Las métricas reales llegan en el Paso 5.
export default function Dashboard() {
  const { user, signOut, membership, membershipLoading } = useAuth()
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
      <header className="flex items-center justify-between border-b border-clay-light/30 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-charcoal">
            <span className="font-serif text-lg text-gold">
              Ch<span className="align-top text-[0.6rem]">+</span>
            </span>
          </div>
          <span className="font-serif text-lg text-sage-dark">ChBook</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-xs text-graysage sm:inline">{user?.email}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-graysage/25 px-3 py-1.5 text-sm text-graysage transition hover:bg-cream"
          >
            Salir
          </button>
        </div>
      </header>

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

        <div className="mt-8 rounded-2xl border border-clay-light/40 bg-white p-6">
          <p className="text-sm text-graysage">
            Tu iglesia está creada. El panel con las métricas reales (miembros
            activos, asistencia) llega en el{' '}
            <span className="font-medium text-sage-dark">Paso 5</span>. Lo próximo:
            gestionar miembros y aprobar prospectos.
          </p>
        </div>
      </main>
    </div>
  )
}
