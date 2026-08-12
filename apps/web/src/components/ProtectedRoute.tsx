import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

// Envuelve las rutas que requieren sesión. Sin sesión → redirige a /login.
export function ProtectedRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
