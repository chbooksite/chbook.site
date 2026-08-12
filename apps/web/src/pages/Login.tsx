import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

type Mode = 'signin' | 'signup'

export default function Login() {
  const { session, loading, signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Si ya hay sesión, no mostrar el login.
  if (!loading && session) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setInfo(null)

    const action = mode === 'signin' ? signIn : signUp
    const { error, needsEmailConfirm } = await action(email.trim(), password)

    setSubmitting(false)

    if (error) {
      setError(error)
      return
    }
    if (needsEmailConfirm) {
      setInfo('Cuenta creada. Revisa tu correo para confirmarla antes de entrar.')
      setMode('signin')
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        {/* Marca */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-charcoal">
            <span className="font-serif text-2xl text-gold">
              Ch<span className="align-top text-sm">+</span>
            </span>
          </div>
          <h1 className="font-serif text-2xl text-sage-dark">ChBook</h1>
          <p className="mt-1 text-sm text-graysage">Panel del pastor</p>
        </div>

        {/* Tarjeta */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-clay-light/40 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-5 font-serif text-lg text-charcoal">
            {mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta'}
          </h2>

          <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="email">
            Correo
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
            placeholder="pastor@iglesia.com"
          />

          <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
            placeholder="••••••••"
          />

          {error && (
            <p className="mb-3 rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">
              {error}
            </p>
          )}
          {info && (
            <p className="mb-3 rounded-lg bg-sage-water/10 px-3 py-2 text-sm text-sage-dark">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sage-dark px-4 py-2.5 font-medium text-cream transition hover:bg-sage disabled:opacity-60"
          >
            {submitting
              ? 'Procesando…'
              : mode === 'signin'
                ? 'Entrar'
                : 'Crear cuenta'}
          </button>

          <p className="mt-4 text-center text-sm text-graysage">
            {mode === 'signin' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setError(null)
                setInfo(null)
              }}
              className="font-medium text-sage underline-offset-2 hover:underline"
            >
              {mode === 'signin' ? 'Crear una' : 'Iniciar sesión'}
            </button>
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-graysage/70">
          Acceso para pastores y administradores.
        </p>
      </div>
    </div>
  )
}
