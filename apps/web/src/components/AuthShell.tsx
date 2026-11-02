import type { ReactNode } from 'react'
import { LogoMark } from './Logo'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
      {children}
    </svg>
  )
}

// Lo que ChBook hace, en tres líneas (en vez de repetir el eslogan).
const FEATURES = [
  { icon: <><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></>, title: 'Asistencia en vivo', text: 'Marca quién llega, sin pasar lista.' },
  { icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h3v-3" /></>, title: 'Invitación con QR', text: 'Tu gente se une con un código.' },
  { icon: <><path d="M3 20h18" /><path d="M6 16V9M11 16V5M16 16v-4M21 16V8" /></>, title: 'Salud de tu iglesia', text: 'Constancia, servicio y discipulado.' },
]

// Marco de las pantallas de acceso (login, restablecer contraseña): panel de
// marca a la izquierda (solo escritorio) y el formulario centrado a la derecha.
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="con-aura relative flex min-h-screen">
      <div className="aura" aria-hidden />

      <aside className="relative m-4 hidden w-[42%] max-w-[36rem] flex-col overflow-hidden rounded-[1.75rem] border border-white/15 text-paper shadow-[0_24px_60px_-24px_rgba(30,42,36,0.55)] lg:flex">
        {/* Foto de marca desenfocada bajo un velo sage: el mismo ambiente que el Dashboard */}
        <div className="absolute inset-0 scale-110 bg-cover bg-center" style={{ backgroundImage: 'url(/hero-band.webp)', filter: 'blur(6px) saturate(0.85)' }} aria-hidden />
        <div className="absolute inset-0 bg-sage-dark/[0.82]" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_22%,rgba(201,168,76,0.14),transparent_70%)]" aria-hidden />

        <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-12">
          <div className="flex flex-col items-center pt-4 text-center">
            <LogoMark size={132} badge={false} draw className="logo-brillo text-gold" />
            <span className="mt-4 text-2xl font-semibold tracking-tight text-paper">ChBook</span>
            <span className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.32em] text-paper/55">Church Management</span>
          </div>

          <p className="mx-auto max-w-md py-8 text-center font-serif text-[2.3rem] leading-[1.12]">Sabe quién llegó al culto sin pasar lista.</p>

          <ul className="space-y-1 rounded-2xl border border-white/15 bg-white/[0.08] p-2 backdrop-blur-md">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-center gap-3.5 rounded-xl px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gold"><Icon>{f.icon}</Icon></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-paper">{f.title}</span>
                  <span className="block text-xs text-paper/65">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-8">{children}</main>
    </div>
  )
}
