import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import ActivityForm from '../components/ActivityForm'
import AgendaView, { type NewActivityAttrs } from '../components/AgendaView'
import { DEFAULT_AGE_RANGES, readAgeRanges, type AgeRangeDef } from '../lib/member'
import {
  formatTime,
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
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />


  const sortedList = [...schedules]
    .filter((s) => !s.parentId)
    .sort((a, b) => a.weekday - b.weekday || (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  return (
    <div className="min-h-screen bg-white">
      <AppHeader />
      <main className="mx-auto max-w-none px-6 py-10 lg:px-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 font-serif text-2xl text-charcoal">El ritmo de la iglesia</h1>
            <p className="text-sm text-graysage">Define las actividades recurrentes una vez; el sistema proyecta tu semana.</p>
          </div>
          <button type="button" onClick={openNew} className="shrink-0 rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-white transition hover:brightness-95">
            + Nueva actividad
          </button>
        </div>

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
          />
        </section>

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
                  {s.assignees.length > 0 && <span className="text-xs text-graysage" title="Encargados">· 👤 {encargadosLabel(s)}</span>}
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
