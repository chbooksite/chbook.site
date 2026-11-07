import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { LogoMark } from './Logo'
import Avatar from './Avatar'
import { useBrand, type LogoStyle } from '../lib/brand'
import ChurchLogo from './ChurchLogo'

// Tres entornos, como una web y no un sistema de menús: Inicio (el centro: el
// culto y la semana), Personas (la gente, por grupos) y Calendario (la
// organización). `match`: rutas que pertenecen al entorno.
const SECTIONS: { to: string; label: string; match: string[]; icon: ReactNode }[] = [
  { to: '/personas', label: 'Personas', match: ['/personas', '/miembros'], icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6" /></> },
  { to: '/', label: 'Inicio', match: ['/culto'], icon: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></> },
  { to: '/calendario', label: 'Calendario', match: ['/calendario'], icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></> },
]
const NAV_ORDER = [1, 0, 2] // escritorio: Inicio, Personas, Calendario

const GEAR = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>

// ¿La ruta actual pertenece a la sección?
function useIsOn() {
  const { pathname } = useLocation()
  return (s: (typeof SECTIONS)[number]) => (s.to === '/' && pathname === '/') || s.match.some((m) => pathname === m || pathname.startsWith(m + '/'))
}

function Icon({ children, className = 'h-6 w-6' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

interface NavStatus {
  church: string | null
  live: boolean // hay un culto en curso
  prospects: number // personas esperando aprobación
}

// Estado que la barra muestra como avisos. Se refresca al cambiar de pantalla
// y cada minuto, para enterarse sin entrar al Dashboard.
function useNavStatus(): NavStatus {
  const { membership } = useAuth()
  const { pathname } = useLocation()
  const [status, setStatus] = useState<NavStatus>({ church: null, live: false, prospects: 0 })

  useEffect(() => {
    const id = membership?.churchId
    if (!id) return
    let alive = true
    const load = () =>
      Promise.all([
        supabase.from('churches').select('name').eq('id', id).maybeSingle(),
        supabase.from('services').select('id', { count: 'exact', head: true }).eq('church_id', id).eq('status', 'active'),
        supabase.from('members').select('id', { count: 'exact', head: true }).eq('church_id', id).eq('status', 'prospect'),
      ]).then(([c, s, p]) => {
        if (alive) setStatus({ church: c.data?.name ?? null, live: (s.count ?? 0) > 0, prospects: p.count ?? 0 })
      })
    load()
    const t = setInterval(load, 60000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [membership, pathname])

  return status
}

// Punto que late (culto en vivo).
function LiveDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative flex h-2 w-2 ${className}`} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
    </span>
  )
}

// Menú de cuenta: avatar con iniciales → iglesia, correo, atajos y cerrar sesión.
function AccountMenu({ church, logo, logoStyle }: { church: string | null; logo: string | null; logoStyle: LogoStyle }) {
  const { user, signOut } = useAuth()
  const { pathname, search } = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [lastPath, setLastPath] = useState(pathname + search)

  // Cerrar al navegar (sin efecto: se compara con la ruta anterior durante el render).
  if (lastPath !== pathname + search) {
    setLastPath(pathname + search)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = church ?? user?.email ?? 'Mi iglesia'
  const item = 'flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-charcoal transition hover:bg-cream'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de cuenta"
        className="flex items-center gap-2 rounded-full p-1 pr-2 transition hover:bg-paper/10"
      >
        <span className="rounded-full ring-2 ring-paper/25">{logo ? <ChurchLogo src={logo} style={logoStyle} size={32} round /> : <Avatar name={name} size={32} />}</span>
        {!logo && <span className="hidden max-w-[10rem] truncate text-sm font-medium text-paper lg:inline">{church ?? 'Mi cuenta'}</span>}
        <Icon className={`h-4 w-4 text-paper/70 transition ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></Icon>
      </button>

      {open && (
        <div role="menu" className="subir absolute right-0 top-[calc(100%+0.6rem)] z-50 w-72 overflow-hidden rounded-2xl border border-clay-light bg-paper p-1.5 shadow-[0_20px_50px_-20px_rgba(30,42,36,0.45)]">
          <div className="flex items-center gap-3 px-3 py-3">
            {logo ? <ChurchLogo src={logo} style={logoStyle} size={40} className="ring-1 ring-clay-light" /> : <Avatar name={name} size={40} />}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-charcoal">{church ?? 'Mi iglesia'}</p>
              <p className="truncate text-xs text-graysage">{user?.email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-clay-light/70" />
          <Link role="menuitem" to="/ajustes" className={item}>
            <Icon className="h-[18px] w-[18px] text-graysage">{GEAR}</Icon>Ajustes de la iglesia
          </Link>
          <Link role="menuitem" to="/ajustes?tab=invitar" className={item}>
            <Icon className="h-[18px] w-[18px] text-graysage"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3h-3zM17 20h3v-3" /></Icon>Invitar miembros
          </Link>
          <Link role="menuitem" to="/ajustes?tab=apariencia" className={item}>
            <Icon className="h-[18px] w-[18px] text-graysage"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 7 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></Icon>Logo, foto y color
          </Link>
          <div className="my-1 h-px bg-clay-light/70" />
          <button role="menuitem" type="button" onClick={signOut} className={`${item} w-full text-danger hover:bg-danger/5`}>
            <Icon className="h-[18px] w-[18px]"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H4" /></Icon>Cerrar sesión
          </button>
          <p className="flex items-center justify-center gap-1.5 pb-1 pt-2 text-[11px] text-faint">
            <LogoMark size={12} badge={false} className="text-faint" />Funciona con ChBook
          </p>
        </div>
      )}
    </div>
  )
}

// Barra inferior (solo móvil): tres entornos, Inicio al centro y elevado (ahí
// se inicia el culto; late en dorado si hay uno en curso).
function BottomNav({ status }: { status: NavStatus }) {
  const isOn = useIsOn()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden" aria-label="Secciones">
      <div className="mx-auto grid max-w-sm grid-cols-3 items-end rounded-[1.5rem] border border-white/70 bg-white/80 px-1 shadow-[0_12px_40px_-12px_rgba(30,42,36,0.35)] backdrop-blur-xl">
        {SECTIONS.map((s) => {
          const on = isOn(s)
          return s.to === '/' ? (
            <Link key={s.to} to={s.to} className="flex flex-col items-center pb-2" aria-current={on ? 'page' : undefined} aria-label={status.live ? 'Inicio, culto en vivo' : 'Inicio'}>
              <span className={`relative -mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-sage-dark text-paper shadow-[0_10px_24px_-8px_rgba(30,42,36,0.7)] ring-4 ring-paper transition ${on ? 'scale-105' : ''}`}>
                <Icon className="h-7 w-7">{s.icon}</Icon>
                {status.live && <LiveDot className="absolute right-1 top-1" />}
              </span>
              <span className={`mt-1 text-xs font-semibold ${on ? 'text-sage-dark' : 'text-graysage'}`}>{status.live ? 'En vivo' : s.label}</span>
            </Link>
          ) : (
            <Link key={s.to} to={s.to} aria-current={on ? 'page' : undefined} className={`flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition ${on ? 'text-sage-dark' : 'text-graysage'}`}>
              <span className={`relative flex h-8 w-12 items-center justify-center rounded-full transition ${on ? 'bg-sage-light' : ''}`}>
                <Icon>{s.icon}</Icon>
                {s.to === '/personas' && status.prospects > 0 && (
                  <span className="absolute -right-0.5 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bronze px-1 text-[10px] font-bold text-white ring-2 ring-white">{status.prospects}</span>
                )}
              </span>
              {s.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// Encabezado: cápsula flotante de vidrio con la marca, los tres entornos al
// centro (como el menú de una web) y, a la derecha, el aviso de culto en vivo y
// la cuenta. En móvil la navegación pasa abajo.
export default function AppHeader() {
  const status = useNavStatus()
  const isOn = useIsOn()
  const { membership } = useAuth()
  const brand = useBrand(membership?.churchId)

  return (
    <>
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
        <div className="mx-auto grid grid-cols-[1fr_auto] items-center gap-3 rounded-[1.25rem] border border-white/10 bg-sage-dark/90 py-2 pl-4 pr-2 shadow-[0_12px_32px_-16px_rgba(30,42,36,0.6)] backdrop-blur-xl md:grid-cols-[1fr_auto_1fr]">
          {/* Firma: el logo y el nombre de la iglesia si subió su logo; si no, ChBook. Lleva a Inicio */}
          {brand.logoUrl ? (
            <Link to="/" className="group flex min-w-0 max-w-[16rem] items-center gap-2.5" aria-label={`${brand.name ?? 'Inicio'}, ir a Inicio`}>
              <ChurchLogo src={brand.logoUrl} style={brand.logoStyle} size={36} className="shadow-sm ring-1 ring-white/25 transition-transform duration-300 group-hover:scale-105" />
              <span className="truncate text-[1.02rem] font-semibold leading-tight tracking-tight text-paper">{brand.name}</span>
            </Link>
          ) : (
            <Link to="/" className="group flex w-fit shrink-0 items-center gap-2.5" aria-label="ChBook, ir a Inicio">
              <LogoMark size={28} badge={false} className="logo-brillo text-gold transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
              <span className="text-[1.1rem] font-semibold tracking-tight text-paper">ChBook</span>
            </Link>
          )}

          <nav className="hidden items-center gap-1 rounded-full bg-black/10 p-1 md:flex" aria-label="Secciones">
            {NAV_ORDER.map((i) => {
              const s = SECTIONS[i]
              const on = isOn(s)
              return (
                <Link
                  key={s.to}
                  to={s.to}
                  aria-current={on ? 'page' : undefined}
                  className={`relative flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${on ? 'bg-paper text-sage-dark shadow-sm' : 'text-paper/75 hover:bg-paper/10 hover:text-paper'}`}
                >
                  <Icon className="h-4 w-4">{s.icon}</Icon>
                  {s.label}
                  {s.to === '/personas' && status.prospects > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bronze px-1.5 text-[11px] font-bold text-white" title={`${status.prospects} por aprobar`}>
                      {status.prospects}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center justify-end gap-2">
            {status.live && (
              <Link to="/culto" className="hidden items-center gap-2 rounded-full bg-gold/20 px-3 py-1.5 text-xs font-semibold text-gold transition hover:bg-gold/30 sm:flex">
                <LiveDot />Culto en vivo
              </Link>
            )}
            <AccountMenu church={status.church} logo={brand.logoUrl} logoStyle={brand.logoStyle} />
          </div>
        </div>
      </header>
      <BottomNav status={status} />
    </>
  )
}
