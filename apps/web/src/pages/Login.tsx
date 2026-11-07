import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { forget, readRemembered, remember } from '../lib/remember'
import { supabase } from '../lib/supabase'
import { LogoMark } from '../components/Logo'
import AuthShell from '../components/AuthShell'
import ChurchLogo from '../components/ChurchLogo'
import { greeting } from '../lib/ui'

type Mode = 'signin' | 'signup'
type Step = 'email' | 'password'
// idle → enviando → ok (✓) → saliendo (fundido y se pasa al Dashboard)
type Phase = 'idle' | 'sending' | 'ok' | 'leaving'

const OK_MS = 450 // tiempo que se ve la ✓
const LEAVE_MS = 350 // duración del fundido al Dashboard

function Icon({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

// Campo con etiqueta flotante: la etiqueta sube cuando hay texto o foco.
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-1.5 text-[0.7rem] font-medium text-graysage transition-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-focus:top-1.5 peer-focus:translate-y-0 peer-focus:text-[0.7rem] peer-focus:text-sage-dark"
      >
        {label}
      </label>
    </div>
  )
}

const inputCls =
  'peer w-full rounded-xl border border-white/80 bg-white/70 px-4 pb-2 pt-6 text-[0.95rem] text-charcoal outline-none transition placeholder:text-transparent focus:border-sage-dark focus:ring-4 focus:ring-sage-light'

export default function Login() {
  const { session, loading, signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const [known] = useState(readRemembered)
  const [mode, setMode] = useState<Mode>('signin')
  const [step, setStep] = useState<Step>(known ? 'password' : 'email')
  const [email, setEmail] = useState(known?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [now] = useState(() => new Date())
  const [resetState, setResetState] = useState<'idle' | 'sending'>('idle')
  const passRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Enfocar el campo del paso actual.
  useEffect(() => {
    ;(step === 'email' ? emailRef : passRef).current?.focus({ preventScroll: true })
  }, [step])

  // Si ya había sesión al llegar, ir directo al Dashboard (pero no cortar la
  // animación de salida de un inicio de sesión recién hecho).
  if (!loading && session && phase === 'idle') return <Navigate to="/" replace />

  const isSunday = now.getDay() === 0
  const rawDate = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const dateLine = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)
  const welcomeBack = mode === 'signin' && known && email === known.email

  const fail = (msg: string) => {
    setError(msg)
    setPhase('idle')
    // Sacudida corta de la tarjeta (sin remontarla, para no repetir otras animaciones).
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cardRef.current?.animate(
        [0, -7, 7, -7, 7, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 450, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' },
      )
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (step === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return fail('Escribe un correo válido.')
      setStep('password')
      return
    }

    setPhase('sending')
    const action = mode === 'signin' ? signIn : signUp
    const { error, needsEmailConfirm } = await action(email.trim(), password)
    if (error) return fail(error)
    if (needsEmailConfirm) {
      setPhase('idle')
      setInfo('Cuenta creada. Revisa tu correo para confirmarla y luego entra.')
      setMode('signin')
      setPassword('')
      return
    }

    remember({ email: email.trim() })
    setPhase('ok')
    setTimeout(() => setPhase('leaving'), OK_MS)
    setTimeout(() => navigate('/', { replace: true }), OK_MS + LEAVE_MS)
  }

  // Restablecer contraseña: Supabase envía un enlace que vuelve a /restablecer.
  const sendReset = async () => {
    setError(null)
    setInfo(null)
    setResetState('sending')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/restablecer` })
    setResetState('idle')
    if (error) return fail('No pudimos enviar el correo. Inténtalo de nuevo en un momento.')
    setInfo(`Te enviamos un enlace a ${email.trim()} para crear una contraseña nueva.`)
  }

  const changeAccount = () => {
    forget()
    setEmail('')
    setPassword('')
    setError(null)
    setStep('email')
  }
  const toggleMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin')
    setError(null)
    setInfo(null)
    setPassword('')
    setStep('email')
  }

  const leaving = phase === 'leaving'
  const busy = phase !== 'idle'
  const title = mode === 'signup' ? 'Crea tu cuenta' : welcomeBack ? 'Hola de nuevo' : greeting(now)
  const subtitle =
    mode === 'signup'
      ? 'Organiza tu iglesia en minutos.'
      : welcomeBack && known?.church
        ? <>a {known.logo && <span className="mx-0.5 inline-flex align-middle"><ChurchLogo src={known.logo} style={known.logoStyle ?? 'transparent'} size={24} className="ring-1 ring-clay-light" /></span>} <span className="font-semibold text-charcoal">{known.church}</span></>
        : 'Entra a tu Dashboard.'

  return (
    <AuthShell>
        <div
          className="w-full max-w-[29rem] transition-opacity ease-out"
          style={{ opacity: leaving ? 0 : 1, transitionDuration: `${LEAVE_MS}ms` }}
        >
          <div ref={cardRef} className="subir vidrio p-6 sm:p-9">
            <div className="mb-10 flex items-center justify-between">
              <span className="lg:hidden"><LogoMark size={44} draw /></span>
              <p className="ml-auto text-right text-xs leading-snug text-graysage">
                <span>{dateLine}</span>
                {isSunday && <span className="block font-semibold text-clay">Día de culto</span>}
              </p>
            </div>

            <h1 className="font-serif text-[2.1rem] leading-tight text-charcoal">{title}</h1>
            <p className="mt-1 text-graysage">{subtitle}</p>

                <form onSubmit={handleSubmit} className="mt-7" noValidate>
                  {step === 'email' ? (
                    <div key="email" className="paso">
                      <Field id="email" label="Correo electrónico">
                        <input
                          ref={emailRef}
                          id="email"
                          type="email"
                          required
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={inputCls}
                          placeholder="Correo electrónico"
                        />
                      </Field>
                    </div>
                  ) : (
                    <div key="password" className="paso space-y-3">
                      {/* Correo elegido, como "chip", con opción de cambiarlo */}
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/80 bg-white/50 px-4 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage-dark text-xs font-bold uppercase text-paper">
                            {email.trim().charAt(0) || '?'}
                          </span>
                          <span className="truncate text-sm text-charcoal" title={email}>{email}</span>
                        </span>
                        <button type="button" onClick={known && email === known.email ? changeAccount : () => setStep('email')} className="shrink-0 text-xs font-semibold text-sage-dark transition hover:text-charcoal">
                          {known && email === known.email ? '¿No eres tú?' : 'Cambiar'}
                        </button>
                      </div>
                      <Field id="password" label={mode === 'signin' ? 'Contraseña' : 'Crea una contraseña (mín. 8)'}>
                        <input
                          ref={passRef}
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={`${inputCls} pr-12`}
                          placeholder="Contraseña"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint transition hover:text-charcoal"
                          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        >
                          <Icon>
                            {showPassword
                              ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
                              : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
                          </Icon>
                        </button>
                      </Field>
                      {mode === 'signin' && (
                        <div className="flex justify-end">
                          <button type="button" onClick={sendReset} disabled={resetState === 'sending'} className="text-xs font-semibold text-sage-dark underline-offset-4 transition hover:underline disabled:opacity-60">
                            {resetState === 'sending' ? 'Enviando…' : '¿Olvidaste tu contraseña?'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div aria-live="polite">
                    {error && <p className="mt-3 flex items-center gap-2 text-sm text-danger"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />{error}</p>}
                    {info && <p className="mt-3 text-sm text-sage-dark">{info}</p>}
                  </div>

                  {/* Botón que se transforma: texto → círculo que carga → ✓ */}
                  <div className="mt-6 flex justify-center">
                    <button
                      type="submit"
                      disabled={busy}
                      className={`flex h-12 items-center justify-center overflow-hidden bg-sage-dark font-semibold text-paper transition-all duration-300 hover:bg-sage-deep ${busy ? 'w-12 rounded-full' : 'w-full rounded-2xl'}`}
                      aria-label={phase === 'sending' ? 'Entrando…' : undefined}
                    >
                      {phase === 'sending' ? (
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />
                      ) : phase === 'ok' || leaving ? (
                        <Icon className="h-6 w-6"><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
                      ) : (
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {step === 'email' ? 'Continuar' : mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
                          <Icon className="h-4 w-4"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Icon>
                        </span>
                      )}
                    </button>
                  </div>
                </form>

            <p className="mt-8 text-center text-sm text-graysage">
              {mode === 'signin' ? '¿Tu iglesia aún no usa ChBook?' : '¿Ya tienes cuenta?'}{' '}
              <button type="button" onClick={toggleMode} className="font-semibold text-clay underline-offset-4 transition hover:underline">
                {mode === 'signin' ? 'Registrar mi iglesia' : 'Iniciar sesión'}
              </button>
            </p>
          </div>
          <p className="mt-6 text-center text-xs text-graysage">Tus datos están protegidos y solo los ve tu iglesia.</p>
        </div>
    </AuthShell>
  )
}
