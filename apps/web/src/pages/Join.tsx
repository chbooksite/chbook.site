import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LogoMark } from '../components/Logo'

function Icon({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

const STEPS = [
  { title: 'Descarga ChBook', text: 'La app para miembros llega muy pronto a Android y iPhone.' },
  { title: 'Crea tu cuenta', text: 'Con tu correo, en un minuto.' },
  { title: 'Escribe este código', text: 'Quedas como prospecto hasta que tu pastor te apruebe.' },
]

// Página pública del QR de invitación (/unirse/CHBK-XXXX). No pide sesión:
// muestra el código de la iglesia y los pasos para unirse.
export default function Join() {
  const { code: raw } = useParams()
  const code = (raw ?? '').toUpperCase()
  const valid = /^CHBK-[A-Z0-9]{3,}$/.test(code)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Sin permiso de portapapeles: el código queda seleccionable a mano.
    }
  }

  return (
    <div className="con-aura relative flex min-h-screen flex-col items-center px-5 py-10 sm:justify-center">
      <div className="aura" aria-hidden />

      <main className="relative w-full max-w-md">
        <div className="subir mb-6 flex flex-col items-center text-center">
          <LogoMark size={64} draw />
          <p className="mt-3 text-lg font-semibold tracking-tight text-charcoal">ChBook</p>
        </div>

        <section className="subir vidrio overflow-hidden" style={{ animationDelay: '80ms' }}>
          {valid ? (
            <>
              <div className="relative overflow-hidden bg-sage-dark px-6 py-7 text-center text-paper">
                <div className="absolute inset-0 scale-110 bg-cover bg-center opacity-35" style={{ backgroundImage: 'url(/hero-band.webp)', filter: 'blur(6px)' }} aria-hidden />
                <div className="relative">
                  <p className="text-sm text-paper/80">Te invitaron a unirte a tu iglesia</p>
                  <p className="mt-1 font-serif text-3xl leading-tight">Te damos la bienvenida</p>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.25em] text-paper/60">Código de la iglesia</p>
                  <p className="mt-1 select-all font-mono text-[2.4rem] leading-none tracking-wider text-gold">{code}</p>
                  <button type="button" onClick={copy} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-semibold text-sage-dark transition hover:bg-white">
                    <Icon className="h-4 w-4">{copied ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>}</Icon>
                    {copied ? 'Copiado' : 'Copiar código'}
                  </button>
                </div>
              </div>

              <ol className="space-y-1 p-4">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-3.5 rounded-xl px-2 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage-dark/[0.08] text-sm font-bold text-sage-dark">{i + 1}</span>
                    <span>
                      <span className="block text-sm font-semibold text-charcoal">{s.title}</span>
                      <span className="block text-sm text-graysage">{s.text}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="border-t border-charcoal/[0.06] px-6 py-4">
                <p className="flex items-start gap-2 text-sm text-graysage">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-clay"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.01" /></Icon>
                  Mientras llega la app, guarda este código o muéstraselo al equipo de tu iglesia para que te registren.
                </p>
              </div>
            </>
          ) : (
            <div className="p-7 text-center">
              <p className="font-serif text-2xl text-charcoal">Este enlace no es válido</p>
              <p className="mt-2 text-sm text-graysage">Pide a tu iglesia el código de invitación (empieza por CHBK-) o escanea de nuevo su QR.</p>
            </div>
          )}
        </section>

        <p className="subir mt-6 text-center text-sm text-graysage" style={{ animationDelay: '160ms' }}>
          ¿Eres pastor?{' '}
          <Link to="/login" className="font-semibold text-clay underline-offset-4 hover:underline">Entra a tu Dashboard</Link>
        </p>
      </main>
    </div>
  )
}
