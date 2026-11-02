import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AuthShell from '../components/AuthShell'
import { PageLoading } from '../components/PageShell'
import { btnPrimary, fieldCls } from '../lib/ui'

// Llegada desde el correo de "¿Olvidaste tu contraseña?": Supabase abre la
// sesión con el enlace (detectSessionInUrl) y aquí se elige la contraseña nueva.
export default function ResetPassword() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <PageLoading />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Usa al menos 8 caracteres.')
    if (password !== confirm) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError('No se pudo guardar. Pide un enlace nuevo e inténtalo otra vez.')
    navigate('/', { replace: true })
  }

  return (
    <AuthShell>
      <div className="subir vidrio w-full max-w-[29rem] p-6 sm:p-9">
        {session ? (
          <>
            <h1 className="font-serif text-[2.1rem] leading-tight text-charcoal">Nueva contraseña</h1>
            <p className="mt-1 text-graysage">Elige una que recuerdes. La usarás para entrar desde ahora.</p>
            <form onSubmit={submit} className="mt-7 space-y-3" noValidate>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-graysage">Contraseña nueva</span>
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldCls} autoFocus />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-graysage">Repítela</span>
                <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={fieldCls} />
              </label>
              <div aria-live="polite">{error && <p className="text-sm text-danger">{error}</p>}</div>
              <button type="submit" disabled={busy} className={`${btnPrimary} mt-3 h-12 w-full`}>
                {busy ? 'Guardando…' : 'Guardar y entrar'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-serif text-[2.1rem] leading-tight text-charcoal">El enlace venció</h1>
            <p className="mt-2 text-graysage">Los enlaces para restablecer la contraseña duran poco y sirven una sola vez. Pide uno nuevo desde el inicio de sesión.</p>
            <Link to="/login" className={`${btnPrimary} mt-7 flex h-12 w-full items-center justify-center`}>Volver a iniciar sesión</Link>
          </>
        )}
      </div>
    </AuthShell>
  )
}
