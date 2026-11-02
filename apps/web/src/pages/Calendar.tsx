import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import PageShell, { PageLoading } from '../components/PageShell'
import ActivityForm from '../components/ActivityForm'
import AgendaView, { type NewActivityAttrs } from '../components/AgendaView'
import { DEFAULT_AGE_RANGES, readAgeRanges, type AgeRangeDef } from '../lib/member'
import {
  formatTime,
  moveRule,
  occursOn,
  readActivityTemplates,
  readAssignees,
  readAudience,
  recurrenceLabel,
  type ActivityType,
  type Audience,
  type Freq,
  type Schedule,
  type ScheduleTeam,
  type Segment,
  type Tag,
  type ActivityTemplate,
} from '../lib/activity'

interface Opt {
  id: string
  name: string
  key?: string
}

const NEXT_FMT = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric' })

// Resumen del ritmo: la próxima actividad y cuántas hay en los próximos 7 días.
function rhythmSummary(rules: Schedule[], now = new Date()) {
  const active = rules.filter((s) => s.enabled)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0)
  let next: { s: Schedule; date: Date } | null = null
  let week = 0
  for (let i = 0; i < 14 && (!next || i < 7); i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const todays = active.filter((s) => occursOn(s, d)).sort((a, b) => toMin(a.startTime) - toMin(b.startTime))
    if (i < 7) week += todays.length
    if (!next) {
      const hit = todays.find((s) => i > 0 || toMin(s.startTime) >= nowMin)
      if (hit) next = { s: hit, date: d }
    }
  }
  return { next, week, active: active.length, paused: rules.length - active.length }
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      {children}
    </svg>
  )
}

export default function Calendar() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [types, setTypes] = useState<ActivityType[]>([])
  const [teams, setTeams] = useState<Opt[]>([])
  const [roles, setRoles] = useState<Opt[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [ageRanges, setAgeRanges] = useState<AgeRangeDef[]>(DEFAULT_AGE_RANGES)
  const [templates, setTemplates] = useState<ActivityTemplate[]>([])
  const [members, setMembers] = useState<Opt[]>([])
  const [membersByTeam, setMembersByTeam] = useState<Map<string, Opt[]>>(new Map())
  const [membersByRole, setMembersByRole] = useState<Map<string, Opt[]>>(new Map())
  const [teamsBySchedule, setTeamsBySchedule] = useState<Map<string, ScheduleTeam[]>>(new Map())
  const [segmentsBySchedule, setSegmentsBySchedule] = useState<Map<string, Segment[]>>(new Map())
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [newWeekday, setNewWeekday] = useState<number | null>(null)
  const [newStart, setNewStart] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!churchId) return
    const [schRes, typeRes, teamRes, roleRes, tagRes, churchRes, memRes, mtRes, mrRes, stRes, ssRes] = await Promise.all([
      supabase.from('activity_schedules').select('*').eq('church_id', churchId),
      supabase.from('activity_types').select('id, key, name, color, is_system').order('is_system', { ascending: false }).order('name'),
      supabase.from('teams').select('id, name, key').order('name'),
      supabase.from('roles').select('id, name').order('name'),
      supabase.from('activity_tags').select('id, name, color, default_duration_min').order('name'),
      supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
      supabase.from('members').select('id, full_name').neq('status', 'archived').order('full_name'),
      supabase.from('member_teams').select('member_id, team_id'),
      supabase.from('member_roles').select('member_id, role_id'),
      supabase.from('schedule_teams').select('*').eq('church_id', churchId),
      supabase.from('schedule_segments').select('*').eq('church_id', churchId).order('sort_order'),
    ])

    setSchedules(
      (schRes.data ?? []).map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        typeId: r.type_id,
        name: r.name,
        freq: (r.freq as Freq) ?? 'weekly',
        weekday: r.weekday,
        nth: r.nth,
        startTime: r.start_time,
        endTime: r.end_time,
        audience: readAudience(r.audience),
        location: r.location,
        responsibleTeamId: r.responsible_team_id,
        assignees: readAssignees(r.assignees),
        onDate: r.on_date,
        sortOrder: r.sort_order ?? 0,
        enabled: r.enabled ?? true,
      })),
    )
    setTypes((typeRes.data ?? []).map((t) => ({ id: t.id, key: t.key, name: t.name, color: t.color, isSystem: !!t.is_system })))
    setTeams((teamRes.data ?? []) as Opt[])
    setRoles((roleRes.data ?? []) as Opt[])
    setTags((tagRes.data ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, defaultDurationMin: t.default_duration_min })))
    setAgeRanges(readAgeRanges(churchRes.data?.settings))
    setTemplates(readActivityTemplates(churchRes.data?.settings))

    // miembros por equipo / rol
    setMembers((memRes.data ?? []).map((m) => ({ id: m.id, name: m.full_name })))
    const memName = new Map((memRes.data ?? []).map((m) => [m.id, m.full_name]))
    const byTeam = new Map<string, Opt[]>()
    for (const row of mtRes.data ?? []) {
      const nm = memName.get(row.member_id)
      if (!nm) continue
      const arr = byTeam.get(row.team_id) ?? []
      arr.push({ id: row.member_id, name: nm })
      byTeam.set(row.team_id, arr)
    }
    const byRole = new Map<string, Opt[]>()
    for (const row of mrRes.data ?? []) {
      const nm = memName.get(row.member_id)
      if (!nm) continue
      const arr = byRole.get(row.role_id) ?? []
      arr.push({ id: row.member_id, name: nm })
      byRole.set(row.role_id, arr)
    }
    setMembersByTeam(byTeam)
    setMembersByRole(byRole)

    // capa 1 y 2 por servicio
    const stMap = new Map<string, ScheduleTeam[]>()
    for (const row of stRes.data ?? []) {
      const arr = stMap.get(row.schedule_id) ?? []
      arr.push({ teamId: row.team_id, delegate: !!row.delegate, memberIds: row.member_ids ?? [] })
      stMap.set(row.schedule_id, arr)
    }
    const ssMap = new Map<string, Segment[]>()
    for (const row of ssRes.data ?? []) {
      const arr = ssMap.get(row.schedule_id) ?? []
      arr.push({
        id: row.id,
        tagId: row.tag_id,
        name: row.name,
        durationMin: row.duration_min,
        assignees: readAssignees(row.assignees),
        pinned: !!row.pinned,
        level: row.level ?? 1,
        color: row.color ?? null,
        startOffset: row.start_offset ?? 0,
      })
      ssMap.set(row.schedule_id, arr)
    }
    setTeamsBySchedule(stMap)
    setSegmentsBySchedule(ssMap)

    setLoading(false)
  }, [churchId])

  useEffect(() => {
    load()
  }, [load])

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])

  const assigneeName = (a: { kind: string; id: string }): string =>
    a.kind === 'member' ? memberById.get(a.id) ?? 'Persona' : a.kind === 'team' ? teamById.get(a.id) ?? 'Equipo' : roleById.get(a.id) ?? 'Rol'
  const encargadosLabel = (s: Schedule): string => s.assignees.map((a) => assigneeName(a)).join(' · ')
  // Predicador: encargado cuyo rol se llama "Predicador" (sus personas, si las hay).
  const preacherOf = (s: Schedule): string | null => {
    const a = s.assignees.find((x) => x.kind === 'role' && (roleById.get(x.id) ?? '').toLowerCase().includes('predicador'))
    if (!a) return null
    const names = a.memberIds.map((id) => memberById.get(id)).filter(Boolean) as string[]
    return names.length ? names.join(', ') : roleById.get(a.id) ?? 'Predicador'
  }

  const colorOf = (s: Schedule) => typeById.get(s.typeId ?? '')?.color ?? '#94a3b8'

  const audienceLabel = (a: Audience): string => {
    if (a.all) return 'Toda la iglesia'
    const parts = [
      ...a.teamIds.map((id) => teamById.get(id)),
      ...a.roleIds.map((id) => roleById.get(id)),
      ...a.ageKeys.map((k) => ageRanges.find((r) => r.key === k)?.name),
    ].filter(Boolean)
    return parts.join(', ') || 'Toda la iglesia'
  }


  const openNew = () => {
    setEditing(null)
    setNewWeekday(null)
    setNewStart(null)
    setShowForm(true)
  }
  const openNewAt = (d: Date, start?: string) => {
    setEditing(null)
    setNewWeekday(d.getDay())
    setNewStart(start ?? null)
    setShowForm(true)
  }
  // Crear al SOLTAR (sin abrir el formulario): actividad de una sola fecha,
  // recurrencia apagada, bloque de 1 h alineado a la hora. Se edita luego.
  const createQuick = async (d: Date, start?: string, attrs?: NewActivityAttrs) => {
    if (!churchId) return
    const type = attrs?.typeId ? typeById.get(attrs.typeId) : undefined
    const s = start ?? '08:00'
    const end = `${String(Math.min(23, Number(s.slice(0, 2)) + 1)).padStart(2, '0')}:${s.slice(3, 5)}`
    const onDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const { data } = await supabase.from('activity_schedules').insert({
      church_id: churchId, name: type?.name ?? 'Nueva actividad', type_id: attrs?.typeId ?? null,
      freq: 'weekly', weekday: d.getDay(),
      start_time: s, end_time: end, on_date: onDate,
      audience: (attrs?.audience ?? { scope: 'all' }) as never, assignees: [] as never, enabled: true,
    }).select('id').single()
    // Equipos elegidos inline → capa 1 del servicio.
    const teamIds = attrs?.teamIds ?? []
    if (teamIds.length && data?.id) {
      await supabase.from('schedule_teams').insert(
        teamIds.map((teamId) => ({ church_id: churchId, schedule_id: data.id, team_id: teamId, delegate: false, member_ids: [] as never })),
      )
    }
    await load()
  }
  const openEdit = (s: Schedule) => {
    setEditing(s)
    setShowForm(true)
  }
  // Mover una tarjeta del calendario. Las de una sola fecha cambian solo ese día;
  // las recurrentes cambian su regla (todas las semanas/meses), así que se confirma.
  const moveSchedule = async (id: string, date: Date, startTime: string | null) => {
    const s = schedules.find((x) => x.id === id)
    if (!s) return
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const rule = moveRule(s, date)
    let start = s.startTime
    let end = s.endTime
    if (startTime && s.startTime) {
      const delta = toMin(startTime) - toMin(s.startTime)
      start = startTime
      if (s.endTime) end = toHhmm(Math.min(23 * 60 + 59, toMin(s.endTime) + delta))
    }
    const sameTime = (a: string | null, b: string | null) => (a ?? '').slice(0, 5) === (b ?? '').slice(0, 5)
    if (rule.weekday === s.weekday && rule.nth === s.nth && rule.onDate === s.onDate && sameTime(start, s.startTime)) return

    const next: Schedule = { ...s, ...rule, startTime: start, endTime: end }
    if (!s.onDate) {
      const when = `${recurrenceLabel(next)}${start ? ` a las ${formatTime(start)}` : ''}`
      if (!window.confirm(`"${s.name}" es recurrente: pasará a ser ${when.charAt(0).toLowerCase()}${when.slice(1)}, en todas sus fechas. ¿Continuar?`)) return
    }

    setSchedules((prev) => prev.map((x) => (x.id === id ? next : x)))
    const { error } = await supabase
      .from('activity_schedules')
      .update({ weekday: rule.weekday, nth: rule.nth, on_date: rule.onDate, start_time: start, end_time: end })
      .eq('id', id)
    if (error) {
      window.alert(`No se pudo mover la actividad: ${error.message}`)
      await load()
    }
  }
  const toggleEnabled = async (s: Schedule) => {
    setSchedules((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))
    await supabase.from('activity_schedules').update({ enabled: !s.enabled }).eq('id', s.id)
  }
  const remove = async (s: Schedule) => {
    if (!window.confirm(`¿Eliminar "${s.name}" del ritmo? Esto quita la actividad recurrente y sus asignaciones.`)) return
    await supabase.from('activity_schedules').delete().eq('id', s.id)
    await load()
  }

  if (membershipLoading || loading) {
    return <PageLoading />
  }
  if (!membership) return <Navigate to="/onboarding" replace />


  const sortedList = [...schedules]
    .filter((s) => !s.parentId)
    .sort((a, b) => a.weekday - b.weekday || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const sum = rhythmSummary(sortedList)

  return (
    <div className="min-h-screen">
      <PageShell
        title="El ritmo de la iglesia"
        subtitle="Define las actividades recurrentes una vez; el sistema proyecta tu semana."
        actions={
          <button type="button" onClick={openNew} className="shrink-0 rounded-xl bg-sage-dark px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-sage-deep">
            + Nueva actividad
          </button>
        }
      >

        {/* Resumen del ritmo: la próxima actividad manda */}
        {sortedList.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Resumen del ritmo">
            <div className="subir col-span-2 flex items-center gap-4 rounded-[1.25rem] bg-sage-dark p-5 text-paper shadow-[0_14px_36px_-16px_rgba(30,42,36,0.6)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-gold"><Glyph><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Glyph></span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-paper/70">Próxima actividad</p>
                {sum.next ? (
                  <>
                    <p className="truncate text-xl font-bold tracking-tight">{sum.next.s.name}</p>
                    <p className="text-sm capitalize text-paper/75">
                      {sum.next.date.toDateString() === new Date().toDateString() ? 'Hoy' : NEXT_FMT.format(sum.next.date)}
                      {sum.next.s.startTime && <> · <span className="font-mono">{formatTime(sum.next.s.startTime)}</span></>}
                    </p>
                  </>
                ) : (
                  <p className="text-lg font-semibold">Nada en las próximas 2 semanas</p>
                )}
              </div>
            </div>
            {[
              { label: 'Esta semana', value: sum.week, hint: 'actividades en 7 días' },
              { label: 'En el ritmo', value: sum.active, hint: sum.paused ? `${sum.paused} pausada${sum.paused > 1 ? 's' : ''}` : 'todas activas' },
            ].map((c, i) => (
              <div key={c.label} className="subir vidrio flex flex-col justify-center p-5" style={{ animationDelay: `${(i + 1) * 50}ms` }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-graysage">{c.label}</p>
                <p className="mt-1.5 text-[2rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-charcoal">{c.value}</p>
                <p className="mt-1 text-xs text-graysage">{c.hint}</p>
              </div>
            ))}
          </div>
        )}

        {/* Agenda tipo calendario */}
        <section className="mb-10">
          <AgendaView
            recurring={schedules.filter((s) => !s.parentId && s.enabled).map((s) => ({ ...s, color: typeById.get(s.typeId ?? '')?.color ?? '#94a3b8', responsibles: s.assignees.length ? encargadosLabel(s) : null, preacher: preacherOf(s) }))}
            typeOptions={types.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            teamOptions={teams.map((t) => ({ id: t.id, name: t.name }))}
            roleOptions={roles.map((r) => ({ id: r.id, name: r.name }))}
            ageOptions={ageRanges.map((r) => ({ key: r.key, name: r.name }))}
            onEdit={(id) => { const s = schedules.find((x) => x.id === id); if (s) openEdit(s) }}
            onNewAt={openNewAt}
            onDropNew={createQuick}
            onMoveActivity={moveSchedule}
          />
        </section>

        {/* Lista de actividades recurrentes */}
        <section className="vidrio p-5" aria-labelledby="h-recurrentes">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 id="h-recurrentes" className="font-serif text-xl leading-tight text-charcoal">Actividades recurrentes</h2>
              <p className="mt-0.5 text-xs text-graysage">Se repiten solas en la agenda. Pausa una sin borrarla.</p>
            </div>
            {sortedList.length > 0 && <span className="rounded-full bg-sage-dark/[0.08] px-2.5 py-0.5 text-xs font-semibold text-sage-dark">{sortedList.length}</span>}
          </header>
          {sortedList.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-clay-light px-4 py-10 text-center">
              <p className="text-sm text-graysage">Aún no hay actividades. Crea la primera y se repetirá sola cada semana.</p>
              <button type="button" onClick={openNew} className="rounded-full bg-sage-dark px-4 py-2 text-sm font-semibold text-paper transition hover:bg-sage-deep">+ Nueva actividad</button>
            </div>
          ) : (
            <ul className="-mx-2 divide-y divide-charcoal/[0.06]">
              {sortedList.map((s) => {
                const t = typeById.get(s.typeId ?? '')
                const nTeams = teamsBySchedule.get(s.id)?.length ?? 0
                const nSegs = segmentsBySchedule.get(s.id)?.length ?? 0
                const meta = [t?.name, nTeams ? `${nTeams} equipo${nTeams > 1 ? 's' : ''}` : null, nSegs ? `${nSegs} parte${nSegs > 1 ? 's' : ''}` : null, s.assignees.length ? `Encargados: ${encargadosLabel(s)}` : null].filter(Boolean).join(' · ')
                return (
                  <li key={s.id} className={`group flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-white/60 ${s.enabled ? '' : 'opacity-55'}`}>
                    <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s) }} aria-hidden />
                    <button type="button" onClick={() => openEdit(s)} className="min-w-0 flex-1 text-left">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-charcoal">{s.name}</span>
                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-graysage">{recurrenceLabel(s)}{s.startTime ? ` · ${formatTime(s.startTime)}${s.endTime ? `–${formatTime(s.endTime)}` : ''}` : ''}</span>
                        <span className="rounded-full bg-sage-light px-2 py-0.5 text-xs font-medium text-sage-dark">{audienceLabel(s.audience)}</span>
                        {!s.enabled && <span className="rounded-full bg-charcoal/[0.06] px-2 py-0.5 text-xs font-medium text-graysage">Pausada</span>}
                      </span>
                      {meta && <span className="mt-0.5 block truncate text-xs text-graysage">{meta}</span>}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => toggleEnabled(s)} className="rounded-full p-2 text-graysage transition hover:bg-white hover:text-sage-dark" aria-label={s.enabled ? `Pausar ${s.name}` : `Activar ${s.name}`} title={s.enabled ? 'Pausar' : 'Activar'}>
                        <Glyph>{s.enabled ? <><path d="M9 6v12M15 6v12" /></> : <path d="m8 5 11 7-11 7z" />}</Glyph>
                      </button>
                      <button type="button" onClick={() => openEdit(s)} className="rounded-full p-2 text-graysage transition hover:bg-white hover:text-sage-dark" aria-label={`Editar ${s.name}`} title="Editar">
                        <Glyph><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Glyph>
                      </button>
                      <button type="button" onClick={() => remove(s)} className="rounded-full p-2 text-graysage transition hover:bg-danger/10 hover:text-danger" aria-label={`Eliminar ${s.name}`} title="Eliminar">
                        <Glyph><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></Glyph>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </PageShell>

      {showForm && (
        <ActivityForm
          churchId={churchId!}
          editing={editing}
          defaultWeekday={newWeekday ?? undefined}
          defaultStart={newStart ?? undefined}
          editingTeams={editing ? teamsBySchedule.get(editing.id) ?? [] : []}
          editingSegments={editing ? segmentsBySchedule.get(editing.id) ?? [] : []}
          types={types}
          teams={teams}
          roles={roles}
          ageRanges={ageRanges}
          tags={tags}
          members={members}
          membersByTeam={membersByTeam}
          membersByRole={membersByRole}
          templates={templates}
          onTemplatesChange={setTemplates}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            load()
          }}
          onTagCreated={(tag) => setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      )}
    </div>
  )
}
