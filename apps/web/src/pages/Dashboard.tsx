import { useAuth } from '../lib/auth-context'

// Placeholder del dashboard del pastor. Las métricas reales llegan en el Paso 5.
export default function Dashboard() {
  const { user, signOut } = useAuth()

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
          <span className="hidden font-mono text-xs text-graysage sm:inline">
            {user?.email}
          </span>
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
        <h1 className="font-serif text-3xl text-charcoal">Bienvenido</h1>
        <p className="mt-2 text-graysage">
          Tu sesión está activa. Aquí irá el panel con las métricas de tu iglesia
          (miembros activos, asistencia real) en el Paso 5.
        </p>

        <div className="mt-8 rounded-2xl border border-clay-light/40 bg-white p-6">
          <p className="text-sm text-graysage">
            Próximo paso del desarrollo:{' '}
            <span className="font-medium text-sage-dark">
              registro de tu iglesia (onboarding)
            </span>
            .
          </p>
        </div>
      </main>
    </div>
  )
}
