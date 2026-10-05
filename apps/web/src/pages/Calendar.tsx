import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import ActivityForm from '../components/ActivityForm'
import { DEFAULT_AGE_RANGES, readAgeRanges, type AgeRangeDef } from '../lib/member'
import {
  WEEKDAYS_SHORT,
  addDays,
  formatTime,
  projectWeek,
  readActivityTemplates,
  readAssignees,
  readAudience,
  recurrenceLabel,
  weekStart,
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
  const [membersByTeam, setMembersByTeam] = useState<Map<string, Opt[]>>(new Map())
  const [membersByRole, setMembersByRole] = useState<Map<string, Opt[]>>(new Map())
  const [teamsBySchedule, setTeamsBySchedule] = useState<Map<string, ScheduleTeam[]>>(new Map())
  const [segmentsBySchedule, setSegmentsBySchedule] = useState<Map<string, Segment[]>>(new Map())
  const [weekRef, setWeekRef] = useState<Date>(new Date())
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)

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

  const colorOf = (s: Schedule) => typeById.get(s.typeId ?? '')?.color ?? '#94a3b8'

  const audienceLabel = (a: Audience): string => {
    if (a.scope === 'all') return 'Toda la iglesia'
    if (a.scope === 'roles') return (a.ids ?? []).map((id) => roleById.get(id)).filter(Boolean).join(', ') || 'Roles'
    if (a.scope === 'teams') return (a.ids ?? []).map((id) => teamById.get(id)).filter(Boolean).join(', ') || 'Equipos'
    return (a.keys ?? []).map((k) => ageRanges.find((r) => r.key === k)?.name).filter(Boolean).join(', ') || 'Edades'
  }

  const week = useMemo(() => projectWeek(schedules, weekStart(weekRef)), [schedules, weekRef])
  const todayKey = new Date().toDateString()

  const openNew = () => {
    setEditing(null)
    setShowForm(true)
  }
  const openEdit = (s: Schedule) => {
    setEditing(s)
    setShowForm(true)
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  const ws = weekStart(weekRef)
  const rangeLabel = `${ws.getDate()} ${ws.toLocaleDateString('es', { month: 'short' })} – ${addDays(ws, 6).getDate()} ${addDays(ws, 6).toLocaleDateString('es', { month: 'short' })}`

  const sortedList = [...schedules]
    .filter((s) => !s.parentId)
    .sort((a, b) => a.weekday - b.weekday || (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 font-serif text-2xl text-charcoal">El ritmo de la iglesia</h1>
            <p className="text-sm text-graysage">Define las actividades recurrentes una vez; el sistema proyecta tu semana.</p>
          </div>
          <button type="button" onClick={openNew} className="shrink-0 rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage">
            + Nueva actividad
          </button>
        </div>

        {/* Navegación de semana */}
        <div className="mb-3 flex items-center gap-3">
          <button type="button" onClick={() => setWeekRef(addDays(ws, -7))} className="rounded-lg border border-graysage/25 px-2.5 py-1 text-sm text-graysage hover:bg-white">←</button>
          <button type="button" onClick={() => setWeekRef(new Date())} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">Hoy</button>
          <button type="button" onClick={() => setWeekRef(addDays(ws, 7))} className="rounded-lg border border-graysage/25 px-2.5 py-1 text-sm text-graysage hover:bg-white">→</button>
          <span className="font-mono text-xs text-graysage">{rangeLabel}</span>
        </div>

        {/* Vista de semana proyectada */}
        <div className="mb-10 grid gap-2 sm:grid-cols-7">
          {week.map((day) => {
            const isToday = day.date.toDateString() === todayKey
            return (
              <div key={day.date.toISOString()} className={`rounded-xl border bg-white p-2 ${isToday ? 'border-sage ring-1 ring-sage/30' : 'border-clay-light/40'}`}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className={`text-xs font-medium ${isToday ? 'text-sage-dark' : 'text-graysage'}`}>{WEEKDAYS_SHORT[day.weekday]}</span>
                  <span className={`text-sm ${isToday ? 'font-semibold text-sage-dark' : 'text-charcoal'}`}>{day.date.getDate()}</span>
                </div>
                <div className="space-y-1.5">
                  {day.items.length === 0 && <p className="py-2 text-center text-[0.65rem] text-graysage/40">—</p>}
                  {day.items.map((s) => (
                    <button key={s.id} type="button" onClick={() => openEdit(s)} style={{ borderLeftColor: colorOf(s) }} className={`block w-full rounded-md border-l-4 bg-cream/60 px-2 py-1.5 text-left transition hover:bg-cream ${s.enabled ? '' : 'opacity-40'}`}>
                      {s.startTime && <span className="font-mono text-[0.65rem] text-graysage">{formatTime(s.startTime)}</span>}
                      <span className="block text-xs font-medium leading-tight text-charcoal">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Lista de actividades recurrentes */}
        <h2 className="mb-3 font-serif text-lg text-charcoal">Actividades recurrentes</h2>
        {sortedList.length === 0 ? (
          <p className="rounded-xl border border-dashed border-graysage/30 bg-white/50 px-4 py-8 text-center text-sm text-graysage">Aún no hay actividades. Crea la primera con «Nueva actividad».</p>
        ) : (
          <ul className="space-y-2">
            {sortedList.map((s) => {
              const t = typeById.get(s.typeId ?? '')
              const nTeams = teamsBySchedule.get(s.id)?.length ?? 0
              const nSegs = segmentsBySchedule.get(s.id)?.length ?? 0
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-clay-light/40 bg-white px-4 py-3 ${s.enabled ? '' : 'opacity-50'}`}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s) }} />
                  <span className="font-medium text-charcoal">{s.name}</span>
                  {t && <span className="text-xs text-graysage">· {t.name}</span>}
                  <span className="text-sm text-graysage">· {recurrenceLabel(s)}</span>
                  {s.startTime && <span className="font-mono text-xs text-graysage">· {formatTime(s.startTime)}{s.endTime ? `–${formatTime(s.endTime)}` : ''}</span>}
                  <span className="rounded-full bg-sage-water/10 px-2 py-0.5 text-xs text-sage-dark">{audienceLabel(s.audience)}</span>
                  {nTeams > 0 && <span className="text-xs text-graysage">{nTeams} equipo{nTeams > 1 ? 's' : ''}</span>}
                  {nSegs > 0 && <span className="text-xs text-graysage">{nSegs} actividad{nSegs > 1 ? 'es' : ''}</span>}
                  <div className="ml-auto flex items-center gap-3">
                    <button type="button" onClick={() => toggleEnabled(s)} className="text-xs text-graysage hover:text-sage-dark hover:underline">{s.enabled ? 'Pausar' : 'Activar'}</button>
                    <button type="button" onClick={() => openEdit(s)} className="text-xs text-graysage hover:text-sage-dark hover:underline">Editar</button>
                    <button type="button" onClick={() => remove(s)} className="text-xs text-graysage hover:text-clay hover:underline">Eliminar</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {showForm && (
        <ActivityForm
          churchId={churchId!}
          editing={editing}
          editingTeams={editing ? teamsBySchedule.get(editing.id) ?? [] : []}
          editingSegments={editing ? segmentsBySchedule.get(editing.id) ?? [] : []}
          types={types}
          teams={teams}
          roles={roles}
          ageRanges={ageRanges}
          tags={tags}
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
