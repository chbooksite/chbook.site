import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import ServiceTimeline from './ServiceTimeline'
import type { AgeRangeDef } from '../lib/member'
import {
  WEEKDAYS,
  clockToMin,
  serviceMinutes,
  type ActivityType,
  type Audience,
  type AudienceScope,
  type Freq,
  type Schedule,
  type ScheduleTeam,
  type Segment,
  type Tag,
} from '../lib/activity'

interface Opt {
  id: string
  name: string
}
type Seg = Segment & { _k: string }

const inputCls =
  'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

function chipCls(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs transition ${active ? 'bg-sage text-cream' : 'bg-cream text-graysage hover:bg-sage/10'}`
}
const mkKey = () => Math.random().toString(36).slice(2)
const withKey = (s: Segment): Seg => ({ ...s, _k: mkKey() })

// Línea de tiempo por defecto al crear, para que el concepto se entienda de entrada.
const DEFAULT_TIMELINE: { name: string; min: number; tag: string }[] = [
  { name: 'Inicio', min: 5, tag: 'Bienvenida' },
  { name: 'Alabanza', min: 25, tag: 'Alabanza' },
  { name: 'Palabra', min: 35, tag: 'Prédica' },
  { name: 'Ofrenda', min: 15, tag: 'Ofrenda' },
  { name: 'Anuncios', min: 5, tag: 'Anuncios' },
  { name: 'Despedida', min: 5, tag: 'Despedida' },
]
function defaultSegments(tags: Tag[]): Seg[] {
  return DEFAULT_TIMELINE.map((d) => {
    const t = tags.find((x) => x.name.toLowerCase() === d.tag.toLowerCase())
    return withKey({ tagId: t?.id ?? null, name: d.name, durationMin: d.min, assignTeamId: null, assignRoleId: null, memberIds: [], pinned: false })
  })
}

// Reordena respetando los bloques fijados (que conservan su posición absoluta).
function reorderRespectingPins(arr: Seg[], from: number, to: number): Seg[] {
  const moved = [...arr]
  const [m] = moved.splice(from, 1)
  moved.splice(Math.max(0, Math.min(moved.length, to)), 0, m)
  const pinAt = new Map(arr.map((s, i) => [i, s]).filter(([, s]) => (s as Seg).pinned) as [number, Seg][])
  const rest = moved.filter((s) => !s.pinned)
  const out: Seg[] = []
  let ri = 0
  for (let i = 0; i < arr.length; i++) out.push(pinAt.get(i) ?? rest[ri++])
  return out
}

export default function ActivityForm({
  churchId,
  editing,
  editingTeams,
  editingSegments,
  types,
  teams,
  roles,
  ageRanges,
  tags,
  membersByTeam,
  membersByRole,
  onClose,
  onSaved,
  onTagCreated,
}: {
  churchId: string
  editing: Schedule | null
  editingTeams: ScheduleTeam[]
  editingSegments: Segment[]
  types: ActivityType[]
  teams: Opt[]
  roles: Opt[]
  ageRanges: AgeRangeDef[]
  tags: Tag[]
  membersByTeam: Map<string, Opt[]>
  membersByRole: Map<string, Opt[]>
  onClose: () => void
  onSaved: () => void
  onTagCreated: (t: Tag) => void
}) {
  const typeById = new Map(types.map((t) => [t.id, t]))
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '—'
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'Rol'

  const [name, setName] = useState(editing?.name ?? '')
  const [typeId, setTypeId] = useState(editing?.typeId ?? '')
  const [weekday, setWeekday] = useState(editing?.weekday ?? 0)
  const [freq, setFreq] = useState<Freq>(editing?.freq ?? 'weekly')
  const [nth, setNth] = useState(editing?.nth && editing.nth !== 0 ? editing.nth : 1)
  const [startTime, setStartTime] = useState(editing?.startTime ? editing.startTime.slice(0, 5) : '')
  const [endTime, setEndTime] = useState(editing?.endTime ? editing.endTime.slice(0, 5) : '')
  const [audScope, setAudScope] = useState<AudienceScope>(editing?.audience.scope ?? 'all')
  const [audIds, setAudIds] = useState<string[]>(editing?.audience.ids ?? [])
  const [audKeys, setAudKeys] = useState<string[]>(editing?.audience.keys ?? [])

  const [partTeams, setPartTeams] = useState<ScheduleTeam[]>(editingTeams)
  const [segments, setSegments] = useState<Seg[]>(editing ? editingSegments.map(withKey) : defaultSegments(tags))
  const [newTagName, setNewTagName] = useState('')
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [assignKey, setAssignKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleArr = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const total = serviceMinutes(startTime || null, endTime || null)
  const startMin = clockToMin(startTime || null)

  // Capa 1
  const addTeam = (teamId: string) => {
    if (!teamId || partTeams.some((t) => t.teamId === teamId)) return
    setPartTeams([...partTeams, { teamId, delegate: false, memberIds: [] }])
  }
  const patchTeam = (teamId: string, p: Partial<ScheduleTeam>) => setPartTeams((prev) => prev.map((t) => (t.teamId === teamId ? { ...t, ...p } : t)))
  const removeTeam = (teamId: string) => setPartTeams((prev) => prev.filter((t) => t.teamId !== teamId))

  // Capa 2
  const patchSeg = (k: string, p: Partial<Seg>) => setSegments((prev) => prev.map((s) => (s._k === k ? { ...s, ...p } : s)))
  const removeSeg = (k: string) => setSegments((prev) => prev.filter((s) => s._k !== k))
  const addSegmentFromTag = (t: Tag) =>
    setSegments((prev) => [...prev, withKey({ tagId: t.id, name: t.name, durationMin: t.defaultDurationMin ?? 10, assignTeamId: null, assignRoleId: null, memberIds: [], pinned: false })])
  const segColor = (s: Segment) => tags.find((t) => t.id === s.tagId)?.color ?? '#94a3b8'

  const createTag = async () => {
    const nm = newTagName.trim()
    if (!nm) return
    const { data, error: err } = await supabase
      .from('activity_tags')
      .insert({ church_id: churchId, name: nm, default_duration_min: 10, color: '#64748b' })
      .select('id, name, color, default_duration_min')
      .single()
    if (err || !data) {
      setError(err?.message ?? 'No se pudo crear')
      return
    }
    const tag: Tag = { id: data.id, name: data.name, color: data.color, defaultDurationMin: data.default_duration_min }
    onTagCreated(tag)
    setNewTagName('')
    addSegmentFromTag(tag)
  }

  const legend = (s: Seg): string => {
    if (s.assignTeamId) return teamName(s.assignTeamId)
    if (s.assignRoleId) {
      const rn = roleName(s.assignRoleId)
      if (s.memberIds.length) {
        const names = s.memberIds.map((id) => (membersByRole.get(s.assignRoleId!) ?? []).find((m) => m.id === id)?.name).filter(Boolean)
        return names.length ? `${rn}: ${names.join(', ')}` : rn
      }
      return rn
    }
    return 'Sin encargado'
  }

  // Arrastre vertical
  const listRef = useRef<HTMLDivElement | null>(null)
  const dragKey = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const onDragStart = (k: string) => (e: RPointerEvent) => {
    dragKey.current = k
    setDragging(k)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: RPointerEvent) => {
    if (!dragKey.current || !listRef.current) return
    const kids = Array.from(listRef.current.children) as HTMLElement[]
    let target = kids.length - 1
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) {
        target = i
        break
      }
    }
    setSegments((prev) => {
      const from = prev.findIndex((s) => s._k === dragKey.current)
      if (from < 0 || from === target || prev[from].pinned) return prev
      return reorderRespectingPins(prev, from, target)
    })
  }
  const onDragEnd = () => {
    dragKey.current = null
    setDragging(null)
  }

  const save = async () => {
    if (!name.trim()) {
      setError('Ponle un nombre a la actividad.')
      return
    }
    setSaving(true)
    setError(null)
    const audience: Audience =
      audScope === 'all' ? { scope: 'all' } : audScope === 'ages' ? { scope: 'ages', keys: audKeys } : { scope: audScope, ids: audIds }
    const payload = {
      church_id: churchId,
      name: name.trim(),
      type_id: typeId || null,
      freq,
      weekday,
      nth: freq === 'monthly' ? nth : null,
      start_time: startTime || null,
      end_time: endTime || null,
      audience: audience as never,
      enabled: editing?.enabled ?? true,
    }

    let scheduleId = editing?.id ?? null
    if (scheduleId) {
      const { error: err } = await supabase.from('activity_schedules').update(payload).eq('id', scheduleId)
      if (err) return fail(err.message)
    } else {
      const { data, error: err } = await supabase.from('activity_schedules').insert(payload).select('id').single()
      if (err || !data) return fail(err?.message ?? 'No se pudo crear')
      scheduleId = data.id
    }

    await supabase.from('schedule_teams').delete().eq('schedule_id', scheduleId)
    if (partTeams.length) {
      const { error: err } = await supabase.from('schedule_teams').insert(
        partTeams.map((t) => ({ church_id: churchId, schedule_id: scheduleId, team_id: t.teamId, delegate: t.delegate, member_ids: t.delegate ? [] : t.memberIds })),
      )
      if (err) return fail(err.message)
    }

    await supabase.from('schedule_segments').delete().eq('schedule_id', scheduleId)
    if (segments.length) {
      const { error: err } = await supabase.from('schedule_segments').insert(
        segments.map((s, i) => ({
          church_id: churchId,
          schedule_id: scheduleId,
          tag_id: s.tagId,
          name: s.name,
          sort_order: i,
          duration_min: s.durationMin,
          team_id: s.assignTeamId,
          role_id: s.assignRoleId,
          member_ids: s.assignRoleId ? s.memberIds : [],
          pinned: s.pinned,
        })),
      )
      if (err) return fail(err.message)
    }

    setSaving(false)
    onSaved()

    function fail(msg: string) {
      setSaving(false)
      setError(msg)
    }
  }

  const availableTeams = teams.filter((t) => !partTeams.some((p) => p.teamId === t.id))


  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal/30 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 font-serif text-lg text-charcoal">{editing ? 'Editar actividad' : 'Nueva actividad'}</h3>

        <div className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-graysage">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Culto de oración" autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage">Tipo</label>
              <select value={typeId} onChange={(e) => { const id = e.target.value; setTypeId(id); if (!name) setName(typeById.get(id)?.name ?? '') }} className={inputCls}>
                <option value="">Sin tipo</option>
                {types.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage">Día</label>
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={inputCls}>
                {WEEKDAYS.map((d, i) => (<option key={i} value={i}>{d}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage">Frecuencia</label>
              <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)} className={inputCls}>
                <option value="weekly">Cada semana</option>
                <option value="monthly">Una vez al mes</option>
              </select>
            </div>
            {freq === 'monthly' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">¿Qué {WEEKDAYS[weekday].toLowerCase()} del mes?</label>
                <select value={nth} onChange={(e) => setNth(Number(e.target.value))} className={inputCls}>
                  <option value={1}>1º del mes</option>
                  <option value={2}>2º del mes</option>
                  <option value={3}>3º del mes</option>
                  <option value={4}>4º del mes</option>
                  <option value={-1}>Último del mes</option>
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage">Hora de inicio</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage">Hora de fin <span className="text-graysage/50">(opcional)</span></label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-graysage">¿Para quién?</label>
            <select value={audScope} onChange={(e) => setAudScope(e.target.value as AudienceScope)} className={inputCls}>
              <option value="all">Toda la iglesia</option>
              <option value="teams">Equipos específicos</option>
              <option value="roles">Roles específicos</option>
              <option value="ages">Rangos de edad</option>
            </select>
            {audScope === 'teams' && (<div className="mt-2 flex flex-wrap gap-2">{teams.map((t) => (<button key={t.id} type="button" onClick={() => setAudIds(toggleArr(audIds, t.id))} className={chipCls(audIds.includes(t.id))}>{t.name}</button>))}</div>)}
            {audScope === 'roles' && (<div className="mt-2 flex flex-wrap gap-2">{roles.map((r) => (<button key={r.id} type="button" onClick={() => setAudIds(toggleArr(audIds, r.id))} className={chipCls(audIds.includes(r.id))}>{r.name}</button>))}</div>)}
            {audScope === 'ages' && (<div className="mt-2 flex flex-wrap gap-2">{ageRanges.filter((r) => r.enabled).map((r) => (<button key={r.key} type="button" onClick={() => setAudKeys(toggleArr(audKeys, r.key))} className={chipCls(audKeys.includes(r.key))}>{r.name}</button>))}</div>)}
          </div>

          {/* Capa 1: equipos participantes */}
          <div className="rounded-xl bg-cream/50 p-4">
            <p className="text-sm font-medium text-charcoal">Equipos participantes</p>
            <p className="mb-3 text-xs text-graysage">Equipos disponibles durante todo el servicio. Elige miembros o deja que su líder los asigne.</p>
            {partTeams.map((pt) => {
              const members = membersByTeam.get(pt.teamId) ?? []
              return (
                <div key={pt.teamId} className="mb-2 rounded-lg border border-graysage/15 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-charcoal">{teamName(pt.teamId)}</span>
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-graysage">
                      <input type="checkbox" checked={pt.delegate} onChange={(e) => patchTeam(pt.teamId, { delegate: e.target.checked })} />
                      Delegar al líder
                    </label>
                    <button type="button" onClick={() => removeTeam(pt.teamId)} className="text-xs text-graysage hover:text-clay">✕</button>
                  </div>
                  {!pt.delegate && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {members.length === 0 && <span className="text-xs text-graysage/50">Sin miembros en este equipo.</span>}
                      {members.map((m) => (<button key={m.id} type="button" onClick={() => patchTeam(pt.teamId, { memberIds: toggleArr(pt.memberIds, m.id) })} className={chipCls(pt.memberIds.includes(m.id))}>{m.name}</button>))}
                    </div>
                  )}
                </div>
              )
            })}
            {availableTeams.length > 0 && (
              <select value="" onChange={(e) => addTeam(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">+ Añadir equipo…</option>
                {availableTeams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            )}
          </div>

          {/* Capa 2: línea de tiempo horizontal */}
          <div className="rounded-xl bg-cream/50 p-4">
            <p className="text-sm font-medium text-charcoal">Línea de tiempo del servicio</p>
            <p className="mb-3 text-xs text-graysage">Arrastra el borde derecho de cada actividad para ajustar su duración. Debajo, usa ⠿ para reordenar y ⋮ para fijar, asignar encargado o eliminar.</p>

            {/* barra visual */}
            <div className="mb-4">
              <ServiceTimeline
                segments={segments}
                totalMin={total}
                startMin={startMin}
                colorOf={segColor}
                keyOf={(s) => (s as Seg)._k}
                selectedKey={selectedKey}
                onSelect={(i) => setSelectedKey(segments[i]._k)}
                onDuration={(i, min) => setSegments((prev) => prev.map((s, idx) => (idx === i ? { ...s, durationMin: min } : s)))}
              />
            </div>

            {/* lista de actividades */}
            <div ref={listRef} className="space-y-1.5">
              {segments.map((s) => {
                const roleMembers = s.assignRoleId ? membersByRole.get(s.assignRoleId) ?? [] : []
                return (
                  <div
                    key={s._k}
                    className={`rounded-lg border bg-white p-2 transition ${selectedKey === s._k ? 'border-sage ring-1 ring-sage/30' : 'border-graysage/15'} ${dragging === s._k ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      {s.pinned ? (
                        <span title="Fijada" className="text-sm">📌</span>
                      ) : (
                        <span onPointerDown={onDragStart(s._k)} onPointerMove={onDragMove} onPointerUp={onDragEnd} title="Arrastrar para reordenar" className="cursor-grab touch-none select-none px-1 text-graysage active:cursor-grabbing">⠿</span>
                      )}
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: segColor(s) }} />
                      <input value={s.name} onChange={(e) => patchSeg(s._k, { name: e.target.value })} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-charcoal outline-none hover:border-graysage/20 focus:border-sage" />
                      <div className="flex items-center gap-1">
                        <input type="number" min={1} value={s.durationMin ?? ''} onChange={(e) => patchSeg(s._k, { durationMin: e.target.value ? Number(e.target.value) : null })} className="w-14 rounded border border-graysage/20 bg-cream/40 px-1.5 py-0.5 text-right text-sm outline-none focus:border-sage" />
                        <span className="text-[0.7rem] text-graysage">min</span>
                      </div>
                      <button type="button" onClick={() => setAssignKey(assignKey === s._k ? null : s._k)} className={`hidden rounded-full px-2 py-0.5 text-[0.7rem] sm:inline-block ${s.assignTeamId || s.assignRoleId ? 'bg-sage-water/10 text-sage-dark' : 'bg-graysage/10 text-graysage/70'}`}>
                        {legend(s)}
                      </button>
                      <div className="relative">
                        <button type="button" onClick={() => setMenuKey(menuKey === s._k ? null : s._k)} className="px-1 text-graysage hover:text-charcoal" title="Opciones">⋮</button>
                        {menuKey === s._k && (
                          <div className="absolute right-0 top-6 z-10 w-44 overflow-hidden rounded-lg border border-graysage/20 bg-white py-1 shadow-lg">
                            <button type="button" onClick={() => { patchSeg(s._k, { pinned: !s.pinned }); setMenuKey(null) }} className="block w-full px-3 py-1.5 text-left text-sm text-charcoal hover:bg-cream">{s.pinned ? 'Dejar de fijar' : 'Fijar (no mover)'}</button>
                            <button type="button" onClick={() => { setAssignKey(s._k); setMenuKey(null) }} className="block w-full px-3 py-1.5 text-left text-sm text-charcoal hover:bg-cream">Asignar encargado</button>
                            <button type="button" onClick={() => { removeSeg(s._k); setMenuKey(null) }} className="block w-full px-3 py-1.5 text-left text-sm text-clay hover:bg-cream">Eliminar</button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* editor de encargado */}
                    {assignKey === s._k && (
                      <div className="mt-2 ml-6 rounded-lg bg-cream/60 p-2">
                        <select
                          value={s.assignTeamId ? `team:${s.assignTeamId}` : s.assignRoleId ? `role:${s.assignRoleId}` : ''}
                          onChange={(e) => {
                            const v = e.target.value
                            if (v.startsWith('team:')) patchSeg(s._k, { assignTeamId: v.slice(5), assignRoleId: null, memberIds: [] })
                            else if (v.startsWith('role:')) patchSeg(s._k, { assignRoleId: v.slice(5), assignTeamId: null, memberIds: [] })
                            else patchSeg(s._k, { assignTeamId: null, assignRoleId: null, memberIds: [] })
                          }}
                          className="w-full rounded border border-graysage/20 bg-white px-2 py-1 text-sm outline-none focus:border-sage"
                        >
                          <option value="">Sin encargado</option>
                          {partTeams.length > 0 && (
                            <optgroup label="Equipos participantes">
                              {partTeams.map((pt) => (<option key={pt.teamId} value={`team:${pt.teamId}`}>{teamName(pt.teamId)}</option>))}
                            </optgroup>
                          )}
                          <optgroup label="Roles">{roles.map((r) => (<option key={r.id} value={`role:${r.id}`}>{r.name}</option>))}</optgroup>
                        </select>
                        {s.assignRoleId && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {roleMembers.length === 0 && <span className="text-xs text-graysage/50">Sin miembros con este rol.</span>}
                            {roleMembers.map((m) => (<button key={m.id} type="button" onClick={() => patchSeg(s._k, { memberIds: toggleArr(s.memberIds, m.id) })} className={chipCls(s.memberIds.includes(m.id))}>{m.name}</button>))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* catálogo */}
            <div className="mt-3 mb-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (<button key={t.id} type="button" onClick={() => addSegmentFromTag(t)} className="rounded-full border border-graysage/25 px-2.5 py-1 text-xs text-graysage hover:bg-sage/10">+ {t.name}</button>))}
            </div>
            <div className="flex gap-2">
              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createTag())} placeholder="Nueva actividad interna…" className="flex-1 rounded-lg border border-graysage/25 bg-white px-3 py-1.5 text-sm outline-none focus:border-sage" />
              <button type="button" onClick={createTag} className="rounded-lg border border-sage/40 px-3 py-1.5 text-xs text-sage-dark hover:bg-sage/10">Agregar al catálogo</button>
            </div>
          </div>

          {error && <p className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm text-graysage hover:underline">Cancelar</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage disabled:opacity-60">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
