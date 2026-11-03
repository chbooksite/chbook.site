import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Piezas compartidas de los tableros (Inicio y Personas): misma cabecera,
// mismos números y mismas tarjetas en los dos entornos.

const NUM = new Intl.NumberFormat('es')

export function Icon({ children, className = 'h-[18px] w-[18px]' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

// Número que cuenta desde 0 al cargar (sin animación si se pidió menos movimiento).
export function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const dur = reduce ? 0 : 800
    let raf = requestAnimationFrame(function tick(t) {
      const k = dur ? Math.min(1, (t - start) / dur) : 1
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{NUM.format(v)}{suffix}</>
}

// Tarjeta con título: todas las secciones usan la misma cabecera.
export function Panel({ title, sub, action, className = '', delay = 0, children }: { title: string; sub?: string; action?: ReactNode; className?: string; delay?: number; children: ReactNode }) {
  return (
    <section className={`subir vidrio flex flex-col p-5 ${className}`} style={{ animationDelay: `${delay}ms` }} aria-label={title}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-xl leading-tight text-charcoal">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-graysage">{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

// Indicador pequeño: cabecera, número, contexto y mini gráfico a la misma altura.
// Sin datos muestra qué hacer (`empty`) en vez de un "—".
export function Stat({ label, value, icon, chip, foot, viz, empty, className = '', delay = 0 }: { label: string; value: ReactNode; icon: ReactNode; chip?: ReactNode; foot: ReactNode; viz?: ReactNode; empty?: { text: string; to: string; cta: string } | null; className?: string; delay?: number }) {
  return (
    <div className={`subir vidrio group flex flex-col p-5 transition duration-300 hover:-translate-y-0.5 ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex h-9 items-center justify-between gap-3">
        <p className="line-clamp-2 text-xs font-semibold uppercase leading-tight tracking-wider text-graysage">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-dark/[0.08] text-sage-dark transition group-hover:bg-sage-dark group-hover:text-paper">
          <Icon>{icon}</Icon>
        </span>
      </div>
      {empty ? (
        <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
          <p className="text-sm leading-snug text-graysage">{empty.text}</p>
          <Link to={empty.to} className="inline-flex w-fit items-center gap-1 rounded-full bg-sage-dark px-3.5 py-1.5 text-xs font-semibold text-paper transition hover:bg-sage-deep">
            {empty.cta} →
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-3 flex h-10 items-end gap-2.5">
            <p className="text-[2.4rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-charcoal">{value}</p>
            {chip}
          </div>
          <p className="mt-2 line-clamp-2 h-8 text-xs leading-4 text-graysage">{foot}</p>
          <div className="mt-4 flex h-9 items-end">{viz ?? <div className="h-px w-full bg-charcoal/[0.08]" />}</div>
        </>
      )}
    </div>
  )
}

// Variación: verde si sube, neutra si baja o no cambia.
export function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const up = value > 0
  return (
    <span className={`mb-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${up ? 'bg-sage-light text-sage-dark' : 'bg-charcoal/[0.06] text-graysage'}`}>
      {up ? '↑ +' : value < 0 ? '↓ ' : '· '}{value}{suffix}
    </span>
  )
}

