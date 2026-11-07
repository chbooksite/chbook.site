import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { greeting } from '../lib/ui'

const DATE_FMT = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' })
const upperFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

interface Props {
  churchName: string | null
  meta: ReactNode // código · plan · país
  today: string | null // "Culto dominical · 10:00" si hay actividad hoy
  live: { name: string; count: number } | null
  logoUrl?: string | null // logo de la iglesia (Ajustes → Identidad)
  coverUrl?: string | null // foto del templo; si no hay, la foto de ChBook
}

// Banda de bienvenida del Dashboard: la foto del templo (o la de la marca) desenfocada bajo un
// velo sage, saludo, nombre de la iglesia y una sola acción (iniciar o ver el
// culto). Al bajar, la foto se desplaza más lento (parallax).
export default function WelcomeBand({ churchName, meta, today, live, logoUrl, coverUrl }: Props) {
  const bandRef = useRef<HTMLElement>(null)
  const photoRef = useRef<HTMLDivElement>(null)
  const [now] = useState(() => new Date())

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const onScroll = () => {
      if (reduce || raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = Math.min(window.scrollY, 400)
        if (photoRef.current) photoRef.current.style.transform = `translate3d(0, ${y * 0.35}px, 0) scale(1.15)`
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const action = live ? (
    <Link to="/culto" className="inline-flex items-center gap-2.5 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-sage-dark shadow-lg transition hover:bg-white">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage opacity-70 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sage-dark" />
      </span>
      Ver en vivo · {live.count} {live.count === 1 ? 'asistente' : 'asistentes'}
    </Link>
  ) : (
    <Link to="/culto" className="inline-flex items-center gap-2 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-sage-dark shadow-lg transition hover:bg-white">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" />
      </svg>
      Iniciar culto
    </Link>
  )

  return (
      <section ref={bandRef} className="subir relative mb-6 overflow-hidden rounded-[1.75rem] border border-white/20 text-paper shadow-[0_18px_50px_-24px_rgba(30,42,36,0.6)]" aria-label="Bienvenida">
        {/* Foto de marca: desenfocada, solo ambiente */}
        {/* Con la foto propia del templo, el velo baja para que se reconozca; el
            texto se protege oscureciendo solo el lado izquierdo y la base. */}
        <div ref={photoRef} className="absolute inset-0 bg-cover bg-center will-change-transform" style={{ backgroundImage: `url(${coverUrl ?? '/hero-band.webp'})`, filter: coverUrl ? 'blur(0.5px) saturate(1)' : 'blur(5px) saturate(0.85)', transform: 'scale(1.15)' }} aria-hidden />
        <div className={`absolute inset-0 ${coverUrl ? 'bg-sage-dark/35' : 'bg-sage-dark/70'}`} aria-hidden />
        <div className={`absolute inset-0 ${coverUrl ? 'bg-[linear-gradient(100deg,rgba(20,30,26,0.78)_0%,rgba(20,30,26,0.45)_45%,transparent_80%)]' : 'bg-[linear-gradient(100deg,rgba(30,42,36,0.55),transparent_70%)]'}`} aria-hidden />
        {coverUrl && <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[linear-gradient(to_top,rgba(20,30,26,0.55),transparent)]" aria-hidden />}

        <div className="relative flex min-h-[13rem] flex-col justify-end gap-5 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
          <div className="min-w-0">
            <p className="text-sm text-paper/75">
              {greeting(now)} · {upperFirst(DATE_FMT.format(now))}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-3 sm:gap-4">
              {logoUrl && <img src={logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-lg sm:h-16 sm:w-16" />}
              <h1 className="line-clamp-2 min-w-0 font-serif text-[2rem] leading-[1.05] text-paper sm:text-5xl">{churchName ?? 'Dashboard'}</h1>
            </div>
            <p className="mt-2 text-sm text-paper/70">{meta}</p>
            {today && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-paper backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
                Hoy: {today}
              </p>
            )}
          </div>
          <div className="shrink-0">{action}</div>
        </div>
      </section>
  )
}
