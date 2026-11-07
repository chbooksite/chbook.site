import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { churchInsights, type InsightService } from '../lib/insights'
import { DEFAULT_AGE_RANGES, displayAgeRange, readAgeRanges, type AgeRangeDef } from '../lib/member'
import { btnPrimary, btnSecondary } from '../lib/ui'
import PageShell, { PageLoading } from '../components/PageShell'
import Avatar from '../components/Avatar'
import { Funnel, Meter, Segments, Sparkline } from '../components/charts'
import { CountUp, Delta, Icon, Panel, Stat } from '../components/DashKit'

interface Person {
  id: string
  full_name: string
  status: string | null
  is_baptized: boolean | null
  created_at: string | null
  birth_date: string | null
  age_group: string | null
}

interface Data {
  people: Person[]
  teams: { id: string; name: string }[]
  links: { member_id: string; team_id: string; is_leader: boolean | null }[]
  services: InsightService[]
  ranges: AgeRangeDef[]
}

const I = {
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" /></>,
  calendarCheck: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>,
  hands: <><path d="M7 11V7a5 5 0 0 1 10 0v4" /><path d="M4 11h16v4a8 8 0 0 1-16 0z" /></>,
  personPlus: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
}

const isMember = (p: Person) => !p.status || p.status === 'active'

// Tarjeta de un grupo (equipo o rango de edad): cuántos son, quiénes (caras) y
// qué parte de la iglesia representan. Toda la tarjeta entra a la lista filtrada.
function GroupCard({ to, title, dot, count, total, faces, note, delay }: { to: string; title: string; dot?: string; count: number; total: number; faces: string[]; note?: string; delay: number }) {
  const share = total ? Math.round((count / total) * 100) : 0
  return (
    <Link to={to} className="subir vidrio group flex flex-col p-4 transition duration-300 hover:-translate-y-0.5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-semibold text-charcoal">
          {dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />}
          <span className="truncate">{title}</span>
        </p>
        <Icon className="h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-sage-dark">{I.arrow}</Icon>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className="text-3xl font-bold leading-none tracking-[-0.03em] tabular-nums text-charcoal">{count}</p>
        {faces.length > 0 && (
          <span className="flex -space-x-2">
            {faces.slice(0, 4).map((n, i) => <span key={i} className="rounded-full ring-2 ring-white"><Avatar name={n} size={26} /></span>)}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-graysage">{count === 1 ? 'persona' : 'personas'}{note ? ` · ${note}` : ''}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-charcoal/[0.07]" aria-hidden>
        <div className="h-full rounded-full bg-sage-dark transition-[width] duration-700" style={{ width: `${share}%` }} />
      </div>
    </Link>
  )
}

function SectionHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-9 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-serif text-2xl text-charcoal">{title}</h2>
        <p className="text-sm text-graysage">{sub}</p>
      </div>
      {action}
    </div>
  )
}

// Entorno "Personas": la salud de la iglesia y la puerta a cada grupo
// (equipos, edades, atajos). La lista completa vive en /miembros.
export default function People() {
  const { membership, membershipLoading } = useAuth()
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    if (!membership) return
    const id = membership.churchId
    // Regla de inactividad primero (REQ-13), igual que en Inicio.
    Promise.resolve(supabase.rpc('apply_inactivity')).catch(() => null).then(() => Promise.all([
      supabase.from('members').select('id, full_name, status, is_baptized, created_at, birth_date, age_group').eq('church_id', id),
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('member_teams').select('member_id, team_id, is_leader'),
      supabase.from('services').select('id, name, starts_at').eq('church_id', id).neq('status', 'active').order('starts_at', { ascending: false }).limit(10),
      supabase.from('churches').select('settings').eq('id', id).maybeSingle(),
    ]).then(async ([mem, tea, lnk, svc, ch]) => {
      const svcs = (svc.data ?? []).slice().reverse()
      const { data: att } = svcs.length
        ? await supabase.from('attendance').select('service_id, member_id, type').in('service_id', svcs.map((s) => s.id))
        : { data: [] as { service_id: string | null; member_id: string | null; type: string | null }[] }
      setData({
        people: mem.data ?? [],
        teams: tea.data ?? [],
        links: lnk.data ?? [],
        services: svcs.map((s) => ({ ...s, attendance: (att ?? []).filter((a) => a.service_id === s.id) })),
        ranges: readAgeRanges(ch.data?.settings) ?? DEFAULT_AGE_RANGES,
      })
    }))
  }, [membership])

  const view = useMemo(() => {
    if (!data) return null
    const ins = churchInsights(data.people, data.links, data.services)
    const visible = data.people.filter((p) => p.status !== 'archived') // como la lista
    const byId = new Map(visible.map((p) => [p.id, p]))
    const teams = data.teams.map((t) => {
      const ls = data.links.filter((l) => l.team_id === t.id && byId.has(l.member_id))
      return { ...t, count: ls.length, leaders: ls.filter((l) => l.is_leader).length, faces: ls.map((l) => byId.get(l.member_id)!.full_name) }
    })
    const rangeOf = (p: Person) => displayAgeRange(p.birth_date, p.age_group, data.ranges)
    const ages = data.ranges
      .filter((r) => r.enabled)
      .sort((a, b) => a.start - b.start)
      .map((r) => {
        const ps = visible.filter((p) => rangeOf(p) === r.name)
        return { key: r.key, name: r.name, color: r.color, count: ps.length, faces: ps.map((p) => p.full_name) }
      })
    const noAge = visible.filter((p) => !rangeOf(p)).length
    const inTeam = new Set(data.links.map((l) => l.member_id))
    const quick = [
      { key: 'prospect', label: 'Por aprobar', hint: 'esperan tu respuesta', count: visible.filter((p) => p.status === 'prospect').length },
      { key: 'noteam', label: 'Sin equipo', hint: 'aún no sirven', count: visible.filter((p) => isMember(p) && !inTeam.has(p.id)).length },
      { key: 'unbaptized', label: 'Sin bautizar', hint: 'próxima clase', count: visible.filter((p) => isMember(p) && !p.is_baptized).length },
      { key: 'inactive', label: 'Inactivos', hint: 'para reconectar', count: visible.filter((p) => p.status === 'inactive' || p.status === 'cambio_membresia').length },
    ]
    const active = visible.filter(isMember).length
    const inactive = visible.filter((p) => p.status === 'inactive').length
    return { ins, teams, ages, noAge, quick, total: visible.length, active, inactive }
  }, [data])

  if (membershipLoading) return <PageLoading />
  if (!membership) return <Navigate to="/onboarding" replace />

  const ins = view?.ins

  return (
    <PageShell
      title="Personas"
      subtitle="Tu iglesia por grupos: toca uno para ver quiénes son."
      actions={
        <>
          <Link to="/miembros" className={btnSecondary}>Ver a todos</Link>
          <Link to="/miembros?nuevo=1" className={btnPrimary}>
            <Icon className="h-4 w-4"><path d="M12 5v14M5 12h14" /></Icon>Agregar persona
          </Link>
        </>
      }
    >
      {/* Salud de la iglesia */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="Miembros"
          value={ins ? <CountUp to={ins.members} /> : '—'}
          icon={I.people}
          chip={ins?.newThisMonth ? <Delta value={ins.newThisMonth} suffix=" este mes" /> : undefined}
          foot={view && ins ? `${view.active} activos (${ins.members ? Math.round((view.active * 100) / ins.members) : 0}%) · ${view.inactive} ${view.inactive === 1 ? 'inactivo' : 'inactivos'}` : 'Crecimiento, últimos 6 meses'}
          viz={ins ? <Sparkline values={ins.growth.map((g) => g.value)} /> : undefined}
        />
        <Stat
          label="Vienen con constancia"
          value={ins?.regular ? <CountUp to={ins.regular.pct} suffix="%" /> : '—'}
          icon={I.calendarCheck}
          foot={ins?.regular ? `${ins.regular.count} de ${ins.members} vinieron a ${Math.ceil(ins.regular.window / 2)}+ de los últimos ${ins.regular.window}` : ''}
          viz={ins?.regular ? <Segments pct={ins.regular.pct} /> : undefined}
          empty={ins && !ins.regular ? { text: 'Se calcula cuando registres 2 cultos o más.', to: '/culto', cta: 'Ir a Culto' } : null}
          delay={50}
        />
        <Stat
          label="Sirven en un equipo"
          value={ins ? <CountUp to={ins.serving.pct} suffix="%" /> : '—'}
          icon={I.hands}
          foot={ins ? `${ins.serving.count} de ${ins.members} · ${ins.leaders} ${ins.leaders === 1 ? 'líder' : 'líderes'}` : ''}
          viz={ins ? <Meter value={ins.serving.count} total={ins.members} /> : undefined}
          delay={100}
        />
        <Stat
          label="Por aprobar"
          value={ins ? <CountUp to={ins.prospects} /> : '—'}
          icon={I.personPlus}
          foot={ins?.prospects ? 'Se unieron con el código y esperan tu aprobación' : 'Nadie espera aprobación'}
          viz={
            ins?.prospects ? (
              <Link to="/miembros?ver=prospect" className="inline-flex items-center gap-1 rounded-full bg-sage-dark px-3.5 py-1.5 text-xs font-semibold text-paper transition hover:bg-sage-deep">Revisar →</Link>
            ) : undefined
          }
          delay={150}
        />
      </div>

      {/* Equipos */}
      <SectionHead
        title="Equipos"
        sub="Quién sirve dónde."
        action={<Link to="/ajustes?tab=equipos" className="text-sm font-semibold text-sage-dark hover:underline">Editar equipos →</Link>}
      />
      {!view ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-white/50" />)}</div>
      ) : view.teams.length === 0 ? (
        <div className="vidrio flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-graysage">Aún no hay equipos. Créalos (alabanza, niños, bienvenida…) y asígnalos desde el perfil de cada persona.</p>
          <Link to="/ajustes?tab=equipos" className={btnPrimary}>Crear equipos</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {view.teams.map((t, i) => (
            <GroupCard
              key={t.id}
              to={`/miembros?equipo=${t.id}`}
              title={t.name}
              count={t.count}
              total={view.total}
              faces={t.faces}
              note={t.leaders ? `${t.leaders} ${t.leaders === 1 ? 'líder' : 'líderes'}` : undefined}
              delay={i * 40}
            />
          ))}
        </div>
      )}

      {/* Edades */}
      <SectionHead
        title="Por edades"
        sub="Según los rangos de tu iglesia."
        action={<Link to="/ajustes?tab=iglesia" className="text-sm font-semibold text-sage-dark hover:underline">Editar rangos →</Link>}
      />
      {!view ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">{[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-white/50" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {view.ages.map((a, i) => (
              <GroupCard key={a.key} to={`/miembros?edad=${encodeURIComponent(a.name)}`} title={a.name} dot={a.color} count={a.count} total={view.total} faces={a.faces} delay={i * 40} />
            ))}
          </div>
          {view.noAge > 0 && (
            <p className="mt-3 text-sm text-graysage">
              {view.noAge} {view.noAge === 1 ? 'persona no tiene' : 'personas no tienen'} fecha de nacimiento ni edad registrada.
            </p>
          )}
        </>
      )}

      {/* Discipulado y atajos */}
      <div className="mt-9 grid gap-3 sm:gap-4 lg:grid-cols-3">
        <Panel title="Camino de discipulado" sub="Cuántos avanzan en cada paso, sobre el total de miembros" className="lg:col-span-2">
          {ins ? (
            <Funnel
              steps={[
                { label: 'Miembros', value: ins.members, hint: 'en la iglesia' },
                { label: 'Constantes', value: ins.regular?.count ?? 0, hint: ins.regular ? 'vienen seguido' : 'faltan cultos' },
                { label: 'Bautizados', value: ins.baptized.count, hint: 'dieron el paso' },
                { label: 'Sirven', value: ins.serving.count, hint: 'en un equipo' },
                { label: 'Líderes', value: ins.leaders, hint: 'guían un equipo' },
              ]}
            />
          ) : (
            <div className="h-56 animate-pulse rounded-xl bg-white/50" />
          )}
        </Panel>
        <Panel title="Atajos" sub="Listas que conviene revisar">
          <ul className="-mx-2 space-y-0.5">
            {(view?.quick ?? []).map((q) => (
              <li key={q.key}>
                <Link to={`/miembros?ver=${q.key}`} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/70">
                  <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums ${q.count ? 'bg-vela-light text-clay' : 'bg-sage-light text-sage-dark'}`}>{q.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-charcoal">{q.label}</span>
                    <span className="block text-xs text-graysage">{q.hint}</span>
                  </span>
                  <Icon className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-sage-dark">{I.arrow}</Icon>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </PageShell>
  )
}
