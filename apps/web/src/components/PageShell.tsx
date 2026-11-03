import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from './AppHeader'

// Marco común de las pantallas protegidas (paleta oficial, ver docs/DISENO.md):
// fondo con aura (las .tarjeta se vuelven vidrio), encabezado sage, título de página y
// hueco para la barra inferior móvil.
// `bare`: sin fondo propio (la página pinta el suyo detrás, p. ej. Calendario).
export default function PageShell({
  back,
  title,
  subtitle,
  actions,
  width = 'wide',
  bare = false,
  aura = true,
  children,
}: {
  // Enlace de vuelta al entorno (p. ej. Miembros → Personas).
  back?: { to: string; label: string }
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  width?: 'wide' | 'mid' | 'narrow'
  bare?: boolean
  // Fondo con aura para las tarjetas de vidrio (por defecto en todas las pantallas).
  aura?: boolean
  children: ReactNode
}) {
  const max = width === 'narrow' ? 'max-w-3xl' : width === 'mid' ? 'max-w-5xl' : 'max-w-none'
  return (
    <div className={`min-h-screen pb-32 md:pb-0 ${aura ? 'con-aura' : bare ? '' : 'bg-paper'}`}>
      {aura && <div className="aura" aria-hidden />}
      <AppHeader />
      <main className={`relative mx-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-10 ${max}`}>
        {title && (
          <header className="subir mb-7 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              {back && (
                <Link to={back.to} className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-sage-dark underline-offset-2 hover:underline">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
                  {back.label}
                </Link>
              )}
              <h1 className="font-serif text-3xl font-bold text-charcoal">{title}</h1>
              {subtitle && <p className="mt-1 text-graysage">{subtitle}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          </header>
        )}
        {children}
      </main>
    </div>
  )
}

// Pantalla de carga de las páginas de trabajo.
export function PageLoading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="flex items-center gap-3 text-graysage">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-sage/30 border-t-sage-dark" aria-hidden />
        {label}
      </div>
    </div>
  )
}
