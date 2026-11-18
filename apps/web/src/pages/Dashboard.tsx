import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import ChurchHealth from '../components/ChurchHealth'
import MembersOverview from '../components/MembersOverview'
import ActivityMetrics from '../components/ActivityMetrics'
import TeamStats from '../components/TeamStats'
import LeaderStats from '../components/LeaderStats'
import BestNumbers from '../components/BestNumbers'
import ChurchMap from '../components/ChurchMap'

const Ico = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const SECTIONS: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'iglesia', label: 'Salud', icon: <Ico><path d="M3 12h4l2-6 4 12 2-6h6" /></Ico> },
  { id: 'miembros', label: 'Miembros', icon: <Ico><circle cx="9" cy="8" r="3" /><path d="M15 11a3 3 0 1 0-1-5.8" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M17 15c2.4 0 4 1.7 4 5" /></Ico> },
  { id: 'actividades', label: 'Actividades', icon: <Ico><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /></Ico> },
  { id: 'equipos', label: 'Equipos', icon: <Ico><circle cx="7" cy="9" r="2.5" /><circle cx="17" cy="9" r="2.5" /><path d="M2 19c0-2.5 2-4 5-4s5 1.5 5 4M12 19c0-2.5 2-4 5-4s5 1.5 5 4" /></Ico> },
  { id: 'lideres', label: 'Líderes', icon: <Ico><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /><path d="M12 2.5l.9 1.8 2 .3-1.45 1.4.34 2L12 7.1l-1.8.9.34-2L9.1 4.6l2-.3z" /></Ico> },
  { id: 'mejores', label: 'Mejores números', icon: <Ico><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Ico> },
]

// El mapa (panel lateral fijo) cambia de modo según la sección visible.
type MapMode = 'equipos' | 'cobertura' | 'asistencia' | 'bautismo' | 'sexo' | 'edad'
const MAP_MODE: Record<string, MapMode> = {
  iglesia: 'cobertura', miembros: 'cobertura', actividades: 'asistencia', equipos: 'equipos', lideres: 'cobertura', mejores: 'equipos',
}

// Panel del pastor: dashboard de datos por SECCIONES con barra lateral COLAPSABLE
// (rail de iconos pegado a la izquierda; se amplía con la flecha y se contrae al
// tocar fuera o al elegir una sección). Scroll-spy resalta la sección visible.
export default function Dashboard() {
  const { membership, membershipLoading } = useAuth()
  const [church, setChurch] = useState<{ name: string; code: string } | null>(null)
  const [avgAttendance, setAvgAttendance] = useState(0)
  const [active, setActive] = useState('iglesia')
  const [overlay, setOverlay] = useState<MapMode | null>(null) // tarjeta seleccionada que controla el mapa
  const [mapOcc, setMapOcc] = useState<string | null>(null) // actividad elegida → asistencia en el mapa
  const [highlight, setHighlight] = useState<string | null>(null) // equipo/líder seleccionado → aislado en el mapa
  const [expanded, setExpanded] = useState(false)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!membership) return
    const id = membership.churchId
    supabase.from('churches').select('name, code').eq('id', id).maybeSingle().then(({ data }) => setChurch(data as { name: string; code: string } | null))
    supabase.from('church_dashboard').select('avg_attendance').eq('church_id', id).maybeSingle().then(({ data }) => setAvgAttendance((data as { avg_attendance?: number } | null)?.avg_attendance ?? 0))
  }, [membership])

  // Scroll-spy.
  useEffect(() => {
    if (!membership) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id) }),
      { rootMargin: '-25% 0px -65% 0px' },
    )
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [membership])

  // Al cambiar de sección, el mapa vuelve al modo por defecto de esa sección
  // (se suelta la tarjeta que lo controlaba).
  useEffect(() => { setOverlay(null); setHighlight(null) }, [active])

  // Contrae la barra al hacer clic fuera de ella.
  useEffect(() => {
    if (!expanded) return
    const onDown = (e: MouseEvent) => { if (navRef.current && !navRef.current.contains(e.target as Node)) setExpanded(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [expanded])

  if (membershipLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-cream"><p className="text-sm text-graysage">Cargando…</p></div>
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  const go = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setExpanded(false) }
  const mapMode = overlay ?? MAP_MODE[active] ?? 'cobertura'

  return (
    <div className="min-h-screen bg-cream">
      <div className="sticky top-0 z-40"><AppHeader /></div>

      {/* Barra lateral colapsable (rail de iconos) */}
      <aside
        ref={navRef}
        className={`fixed bottom-0 left-0 top-[57px] z-30 flex flex-col gap-1 border-r border-black/5 bg-white p-2 transition-[width] duration-300 ease-out ${expanded ? 'w-52 shadow-2xl' : 'w-16'}`}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? 'Contraer menú' : 'Ampliar menú'}
          className="mb-1 flex h-10 items-center gap-2 rounded-lg px-3 text-graysage transition hover:bg-cream"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
          </svg>
          {expanded && <span className="whitespace-nowrap text-[0.65rem] font-semibold uppercase tracking-wider">En esta página</span>}
        </button>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            title={s.label}
            className={`flex h-11 items-center gap-3 rounded-lg px-3 transition ${active === s.id ? 'bg-sage-light text-sage-dark' : 'text-graysage hover:bg-sage-light/50 hover:text-sage-dark'}`}
          >
            {s.icon}
            {expanded && <span className="truncate text-sm font-medium">{s.label}</span>}
          </button>
        ))}
      </aside>

      {/* Contenido (deja libre el rail de 64px; la barra ampliada flota encima) */}
      <div className="ml-16">
        <div className="w-full px-8 py-8 xl:pr-10">
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-14">
              <section id="iglesia" className="scroll-mt-20"><ChurchHealth churchId={membership.churchId} /></section>
              <section id="miembros" className="scroll-mt-20"><MembersOverview churchId={membership.churchId} avgAttendance={avgAttendance} onMapView={(m) => setOverlay(m)} /></section>
              <section id="actividades" className="scroll-mt-20"><ActivityMetrics churchId={membership.churchId} onOccurrence={setMapOcc} /></section>
              <section id="equipos" className="scroll-mt-20"><TeamStats churchId={membership.churchId} onSelect={setHighlight} /></section>
              <section id="lideres" className="scroll-mt-20"><LeaderStats churchId={membership.churchId} onSelect={setHighlight} /></section>
              <section id="mejores" className="scroll-mt-20"><BestNumbers churchId={membership.churchId} /></section>
            </div>
            {/* Franja del mapa: nombre de la iglesia arriba + mapa centrado y estático */}
            <div className="min-w-0 xl:sticky xl:top-[91px] xl:flex xl:h-[calc(100vh-91px)] xl:flex-col">
              <div className="pt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-sage-dark">Panel del pastor</p>
                <h1 className="mt-0.5 font-serif text-2xl font-semibold text-charcoal">{church?.name ?? 'Tu congregación'}</h1>
                {church?.code && <p className="mt-0.5 font-mono text-xs text-graysage/70">{church.code}</p>}
              </div>
              <div className="flex flex-1 items-center">
                <ChurchMap churchId={membership.churchId} mode={mapMode} occId={mapOcc} highlight={highlight} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
