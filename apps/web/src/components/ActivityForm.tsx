import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import ServiceTimeline from './ServiceTimeline'
import type { AgeRangeDef } from '../lib/member'
import {
  WEEKDAYS,
  clockToMin,
  serviceMinutes,
  type ActivityType,
  type Assignee,
  type Audience,
  type AudienceScope,
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
type Seg = Segment & { _k: string }

// Equipos activos por defecto al crear una actividad nueva.
const DEFAULT_TEAM_KEYS = ['multimedia', 'diaconos', 'musica', 'finanzas']

const inputCls =
  'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

function chipCls(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs transition ${active ? 'bg-sage text-cream' : 'bg-cream text-graysage hover:bg-sage/10'}`
}
// Chip del catálogo de actividades: en uso (ya en la línea) cambia de color.
function catalogChipCls(used: boolean): string {
  return `rounded-full px-2.5 py-1 text-xs transition ${used ? 'bg-sage/20 font-medium text-sage-dark' : 'border border-graysage/25 text-graysage hover:bg-sage/10'}`
}
const mkKey = () => Math.random().toString(36).slice(2)
const withKey = (s: Segment): Seg => ({ ...s, _k: mkKey() })

// hex (#rgb o #rrggbb) → rgba con alfa dado.
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16) || 0
  const g = parseInt(n.slice(2, 4), 16) || 0
  const b = parseInt(n.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// Tarjeta que "sale" de la etiqueta de la barra: brota desde el punto (originPct),
// justo debajo de la barra (top) para no taparla, con el MISMO color de la
// actividad al 50% de transparencia, superponiéndose a la línea de tiempo.
function PopCard({ originPct, top, color, children }: { originPct: number; top: number; color: string; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return (
    <div
      data-card
      style={{ top, transformOrigin: `${originPct}% top`, borderColor: color, backgroundColor: withAlpha(color, 0.5) }}
      className={`absolute inset-x-0 z-20 overflow-hidden rounded-xl border-l-4 shadow-xl backdrop-blur-sm transition-all duration-300 ease-out ${shown ? 'scale-100 opacity-100' : 'scale-[0.12] opacity-90'}`}
    >
      <div className={`transition-opacity delay-100 duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}>{children}</div>
    </div>
  )
}

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
    return withKey({ tagId: t?.id ?? null, name: d.name, durationMin: d.min, assignees: [], pinned: false })
  })
}

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
  templates,
  onTemplatesChange,
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
  templates: ActivityTemplate[]
  onTemplatesChange: (t: ActivityTemplate[]) => void
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

  const teamsOf = (ids: string[]): ScheduleTeam[] => ids.filter((id) => teams.some((t) => t.id === id)).map((id) => ({ teamId: id, delegate: false, memberIds: [] }))
  const [partTeams, setPartTeams] = useState<ScheduleTeam[]>(
    editing ? editingTeams : teams.filter((t) => t.key && DEFAULT_TEAM_KEYS.includes(t.key)).map((t) => ({ teamId: t.id, delegate: false, memberIds: [] })),
  )
  const [tpls, setTpls] = useState<ActivityTemplate[]>(templates)
  const [templateName, setTemplateName] = useState('')
  const [segments, setSegments] = useState<Seg[]>(editing ? editingSegments.map(withKey) : defaultSegments(tags))
  const [newTagName, setNewTagName] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [originPct, setOriginPct] = useState(50)
  const [cardTop, setCardTop] = useState(80)
  const selectSeg = (k: string, frac?: number) => { setSelectedKey(k); if (frac != null) setOriginPct(frac * 100) }

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
  const removeTeam = (teamId: string) => setPartTeams((prev) => prev.filter((t) => t.teamId !== teamId))


  // Capa 2
  const patchSeg = (k: string, p: Partial<Seg>) => setSegments((prev) => prev.map((s) => (s._k === k ? { ...s, ...p } : s)))
  const removeSeg = (k: string) => setSegments((prev) => prev.filter((s) => s._k !== k))
  const addSegmentFromTag = (t: Tag) => {
    const seg = withKey({ tagId: t.id, name: t.name, durationMin: t.defaultDurationMin ?? 10, assignees: [], pinned: false })
    setSegments((prev) => [...prev, seg])
    setSelectedKey(seg._k)
  }
  const segColor = (s: Segment) => tags.find((t) => t.id === s.tagId)?.color ?? '#94a3b8'

  // encargados
  const membersOf = (a: Assignee): Opt[] => (a.kind === 'team' ? membersByTeam.get(a.id) : membersByRole.get(a.id)) ?? []
  const assigneeLabel = (a: Assignee) => (a.kind === 'team' ? teamName(a.id) : roleName(a.id))
  const addAssignee = (k: string, kind: 'team' | 'role', id: string) =>
    setSegments((prev) => prev.map((s) => (s._k === k && !s.assignees.some((a) => a.kind === kind && a.id === id) ? { ...s, assignees: [...s.assignees, { kind, id, memberIds: [] }] } : s)))
  const removeAssignee = (k: string, idx: number) => setSegments((prev) => prev.map((s) => (s._k === k ? { ...s, assignees: s.assignees.filter((_, i) => i !== idx) } : s)))
  const toggleAssigneeMember = (k: string, idx: number, memberId: string) =>
    setSegments((prev) => prev.map((s) => (s._k === k ? { ...s, assignees: s.assignees.map((a, i) => (i === idx ? { ...a, memberIds: toggleArr(a.memberIds, memberId) } : a)) } : s)))
  const legend = (s: Seg): string => (s.assignees.length ? s.assignees.map((a) => { const n = a.memberIds.length; return n ? `${assigneeLabel(a)} (${n})` : assigneeLabel(a) }).join(' · ') : 'Sin encargado')

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

  // Arrastre vertical de la lista
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
      if (e.clientY < r.top + r.height / 2) { target = i; break }
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

  // Plantillas: guardar el arreglo (equipos + línea de tiempo) y reutilizarlo.
  const persistTemplates = async (next: ActivityTemplate[]) => {
    const { data } = await supabase.from('churches').select('settings').eq('id', churchId).maybeSingle()
    const s = (data?.settings ?? {}) as Record<string, unknown>
    await supabase.from('churches').update({ settings: { ...s, activity_templates: next } as never }).eq('id', churchId)
    setTpls(next)
    onTemplatesChange(next)
  }
  const saveTemplate = () => {
    const nm = templateName.trim()
    if (!nm) return
    const entry: ActivityTemplate = {
      name: nm,
      typeId: typeId || null,
      teamIds: partTeams.map((t) => t.teamId),
      segments: segments.map((s) => ({ tagId: s.tagId, name: s.name, durationMin: s.durationMin, assignees: s.assignees, pinned: s.pinned })),
    }
    persistTemplates([...tpls.filter((t) => t.name !== nm), entry])
    setTemplateName('')
  }
  const applyTemplate = (t: ActivityTemplate) => {
    if (t.typeId) setTypeId(t.typeId)
    setPartTeams(teamsOf(t.teamIds))
    setSegments(t.segments.map((s) => withKey({ tagId: s.tagId, name: s.name, durationMin: s.durationMin, assignees: s.assignees ?? [], pinned: !!s.pinned })))
    setSelectedKey(null)
  }
  const deleteTemplate = (nm: string) => persistTemplates(tpls.filter((t) => t.name !== nm))

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
          assignees: s.assignees as never,
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

  const selected = segments.find((s) => s._k === selectedKey) ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal/30 p-4 sm:p-8">
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onClickCapture={(e) => {
          if (!selectedKey) return
          const t = e.target as HTMLElement
          if (t.closest('[data-card]') || t.closest('[data-seg]')) return
          setSelectedKey(null)
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg text-charcoal">{editing ? 'Editar actividad' : 'Nueva actividad'}</h3>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-lg text-graysage hover:bg-cream hover:text-charcoal" title="Cerrar">✕</button>
        </div>

        {/* Plantillas: reutilizar un arreglo (equipos + línea de tiempo) */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl bg-cream/50 px-3 py-2">
          <span className="mr-1 text-xs font-medium text-graysage">Plantillas:</span>
          {tpls.length === 0 && <span className="text-xs text-graysage/50">ninguna guardada</span>}
          {tpls.map((t) => (
            <span key={t.name} className="inline-flex items-center gap-1 rounded-full border border-sage/30 bg-white px-2.5 py-1 text-xs text-charcoal">
              <button type="button" onClick={() => applyTemplate(t)} title="Partir de esta plantilla" className="hover:text-sage-dark">{t.name}</button>
              <button type="button" onClick={() => deleteTemplate(t.name)} title="Eliminar plantilla" className="text-graysage/60 hover:text-clay">✕</button>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveTemplate())}
              placeholder="Nombra este esquema de planificación"
              className="w-56 rounded-lg border border-graysage/25 bg-white px-2.5 py-1 text-xs outline-none focus:border-sage"
            />
            <button type="button" onClick={saveTemplate} disabled={!templateName.trim()} className="rounded-lg border border-sage/40 px-2.5 py-1 text-xs text-sage-dark hover:bg-sage/10 disabled:opacity-50">Guardar como plantilla</button>
          </div>
        </div>

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

          {/* Capa 1: equipos participantes (en formato etiqueta) */}
          <div className="rounded-xl bg-cream/50 p-4">
            <p className="text-sm font-medium text-charcoal">Equipos participantes</p>
            <p className="mb-3 text-xs text-graysage">Toca un equipo para activarlo durante todo el servicio. Los activos cambian de color.</p>
            <div className="flex flex-wrap gap-1.5">
              {teams.map((t) => {
                const active = partTeams.some((p) => p.teamId === t.id)
                return (
                  <button key={t.id} type="button" onClick={() => (active ? removeTeam(t.id) : addTeam(t.id))} className={catalogChipCls(active)}>{t.name}</button>
                )
              })}
            </div>
          </div>

          {/* Capa 2: línea de tiempo horizontal */}
          <div className="rounded-xl bg-cream/50 p-4">
            <p className="text-sm font-medium text-charcoal">Línea de tiempo del servicio</p>
            <p className="mb-3 text-xs text-graysage">Arrastra el borde derecho para la duración, el cuerpo para moverla. Toca una actividad para ver y asignar sus encargados.</p>

            <div className="relative mb-3">
              <ServiceTimeline
                segments={segments}
                totalMin={total}
                startMin={startMin}
                colorOf={segColor}
                keyOf={(s) => (s as Seg)._k}
                selectedKey={selectedKey}
                onSelect={(i, frac) => selectSeg(segments[i]._k, frac)}
                onResize={(i, minI, minNext) => setSegments((prev) => prev.map((s, idx) => (idx === i ? { ...s, durationMin: minI } : minNext != null && idx === i + 1 ? { ...s, durationMin: minNext } : s)))}
                onReorder={(from, to) => setSegments((prev) => reorderRespectingPins(prev, from, to))}
                onBarBottom={setCardTop}
              />

            {/* tarjeta de la actividad seleccionada — brota de la etiqueta y se superpone */}
            {selected && (
              <PopCard key={selected._k} originPct={originPct} top={cardTop + 4} color={segColor(selected)}>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: segColor(selected) }} />
                  <input value={selected.name} onChange={(e) => patchSeg(selected._k, { name: e.target.value })} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-serif text-base text-charcoal outline-none hover:border-graysage/20 focus:border-sage" />
                  <input type="number" min={1} value={selected.durationMin ?? ''} onChange={(e) => patchSeg(selected._k, { durationMin: e.target.value ? Number(e.target.value) : null })} className="w-16 rounded border border-graysage/20 bg-cream/40 px-1.5 py-0.5 text-right text-sm outline-none focus:border-sage" />
                  <span className="text-xs text-graysage">min</span>
                  <button type="button" onClick={() => setSelectedKey(null)} className="px-1 text-graysage hover:text-charcoal" title="Cerrar">✕</button>
                </div>

                <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-graysage/70">Encargados</p>
                {selected.assignees.length === 0 && <p className="text-xs text-graysage/60">Aún sin encargados. Añade uno abajo.</p>}
                <div className="space-y-2">
                  {selected.assignees.map((a, ai) => {
                    const members = membersOf(a)
                    return (
                      <div key={`${a.kind}:${a.id}`} className="rounded-lg bg-cream/60 p-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${a.kind === 'team' ? 'bg-clay/10 text-clay' : 'bg-sage-water/15 text-sage-dark'}`}>
                            {a.kind === 'team' ? 'Equipo' : 'Rol'}: {assigneeLabel(a)}
                          </span>
                          <button type="button" onClick={() => removeAssignee(selected._k, ai)} className="ml-auto text-xs text-graysage hover:text-clay">✕</button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {members.length === 0 && <span className="text-xs text-graysage/50">Sin miembros disponibles.</span>}
                          {members.map((m) => (<button key={m.id} type="button" onClick={() => toggleAssigneeMember(selected._k, ai, m.id)} className={chipCls(a.memberIds.includes(m.id))}>{m.name}</button>))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <select
                  value=""
                  onChange={(e) => { const v = e.target.value; if (v.startsWith('team:')) addAssignee(selected._k, 'team', v.slice(5)); else if (v.startsWith('role:')) addAssignee(selected._k, 'role', v.slice(5)) }}
                  className="mt-2 w-full rounded-lg border border-sage/40 bg-white px-2 py-1.5 text-sm text-sage-dark outline-none focus:border-sage"
                >
                  <option value="">+ Añadir encargado…</option>
                  {partTeams.length > 0 && (<optgroup label="Equipos participantes">{partTeams.map((pt) => (<option key={pt.teamId} value={`team:${pt.teamId}`}>{teamName(pt.teamId)}</option>))}</optgroup>)}
                  <optgroup label="Roles">{roles.map((r) => (<option key={r.id} value={`role:${r.id}`}>{r.name}</option>))}</optgroup>
                </select>
              </div>
              </PopCard>
            )}
            </div>

            {/* catálogo de actividades internas (visible) */}
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-graysage/70">Actividades internas</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const used = segments.some((s) => s.tagId === t.id)
                const col = t.color ?? '#94a3b8'
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => addSegmentFromTag(t)}
                    style={used ? { backgroundColor: col, color: '#fff' } : undefined}
                    className={used ? 'rounded-full px-2.5 py-1 text-xs font-medium' : catalogChipCls(false)}
                  >
                    + {t.name}
                  </button>
                )
              })}
            </div>
            <div className="mb-3 flex gap-2">
              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createTag())} placeholder="Nueva actividad interna…" className="flex-1 rounded-lg border border-graysage/25 bg-white px-3 py-1.5 text-sm outline-none focus:border-sage" />
              <button type="button" onClick={createTag} className="rounded-lg border border-sage/40 px-3 py-1.5 text-xs text-sage-dark hover:bg-sage/10">Agregar al catálogo</button>
            </div>

            {/* lista desplegable de actividades (la barra es lo principal) */}
            <button type="button" onClick={() => setListOpen((v) => !v)} className="flex w-full items-center justify-between rounded-lg border border-graysage/20 bg-white px-3 py-1.5 text-sm text-graysage hover:bg-cream">
              <span>Lista de actividades ({segments.length})</span>
              <span className="text-xs">{listOpen ? '▾ ocultar' : '▸ ver'}</span>
            </button>
            {listOpen && (
            <div ref={listRef} className="mt-1.5 space-y-1.5">
              {segments.map((s) => (
                <div
                  key={s._k}
                  data-seg
                  onClick={() => setSelectedKey(s._k)}
                  className={`cursor-pointer rounded-lg border bg-white p-2 transition ${selectedKey === s._k ? 'border-sage ring-1 ring-sage/30' : 'border-graysage/15'} ${dragging === s._k ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {s.pinned ? (
                      <span title="Fijada" className="text-sm">📌</span>
                    ) : (
                      <span onPointerDown={onDragStart(s._k)} onPointerMove={onDragMove} onPointerUp={onDragEnd} onClick={(e) => e.stopPropagation()} title="Arrastrar para reordenar" className="cursor-grab touch-none select-none px-1 text-graysage active:cursor-grabbing">⠿</span>
                    )}
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: segColor(s) }} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-charcoal">{s.name}</span>
                    <span className="hidden truncate text-xs text-graysage sm:inline">{legend(s)}</span>
                    <span className="font-mono text-xs text-graysage">{s.durationMin ?? 0}′</span>
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setMenuKey(menuKey === s._k ? null : s._k)} className="px-1 text-graysage hover:text-charcoal" title="Opciones">⋮</button>
                      {menuKey === s._k && (
                        <div className="absolute right-0 top-6 z-10 w-40 overflow-hidden rounded-lg border border-graysage/20 bg-white py-1 shadow-lg">
                          <button type="button" onClick={() => { patchSeg(s._k, { pinned: !s.pinned }); setMenuKey(null) }} className="block w-full px-3 py-1.5 text-left text-sm text-charcoal hover:bg-cream">{s.pinned ? 'Dejar de fijar' : 'Fijar (no mover)'}</button>
                          <button type="button" onClick={() => { setSelectedKey(s._k); setMenuKey(null) }} className="block w-full px-3 py-1.5 text-left text-sm text-charcoal hover:bg-cream">Encargados</button>
                          <button type="button" onClick={() => { removeSeg(s._k); if (selectedKey === s._k) setSelectedKey(null); setMenuKey(null) }} className="block w-full px-3 py-1.5 text-left text-sm text-clay hover:bg-cream">Eliminar</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )}
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
