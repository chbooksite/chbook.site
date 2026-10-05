import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import { DEFAULT_AGE_RANGES, readAgeRanges, type AgeRangeDef } from '../lib/member'
import {
  WEEKDAYS,
  WEEKDAYS_SHORT,
  addDays,
  formatTime,
  projectWeek,
  readAudience,
  recurrenceLabel,
  weekStart,
  type ActivityType,
  type Audience,
  type AudienceScope,
  type Freq,
  type Schedule,
} from '../lib/activity'

interface Opt {
  id: string
  name: string
}

const inputCls =
  'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

const emptyForm = {
  name: '',
  typeId: '',
  freq: 'weekly' as Freq,
  weekday: 0,
  nth: 1,
  startTime: '',
  endTime: '',
  audScope: 'all' as AudienceScope,
  audIds: [] as string[],
  audKeys: [] as string[],
  responsibleTeamId: '',
  enabled: true,
}
type FormState = typeof emptyForm

export default function Calendar() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [types, setTypes] = useState<ActivityType[]>([])
  const [teams, setTeams] = useState<Opt[]>([])
  const [roles, setRoles] = useState<Opt[]>([])
  const [ageRanges, setAgeRanges] = useState<AgeRangeDef[]>(DEFAULT_AGE_RANGES)
  const [weekRef, setWeekRef] = useState<Date>(new Date())
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    if (!churchId) return
    const [schRes, typeRes, teamRes, roleRes, churchRes] = await Promise.all([
      supabase.from('activity_schedules').select('*').eq('church_id', churchId),
      supabase.from('activity_types').select('id, key, name, color, is_system').order('is_system', { ascending: false }).order('name'),
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('roles').select('id, name').order('name'),
      supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
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
    setTypes(
      (typeRes.data ?? []).map((t) => ({ id: t.id, key: t.key, name: t.name, color: t.color, isSystem: !!t.is_system })),
    )
    setTeams((teamRes.data ?? []) as Opt[])
    setRoles((roleRes.data ?? []) as Opt[])
    setAgeRanges(readAgeRanges(churchRes.data?.settings))
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

  // ---- Formulario ----
  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }
  const openEdit = (s: Schedule) => {
    setEditingId(s.id)
    setForm({
      name: s.name,
      typeId: s.typeId ?? '',
      freq: s.freq,
      weekday: s.weekday,
      nth: s.nth && s.nth !== 0 ? s.nth : 1,
      startTime: s.startTime ? s.startTime.slice(0, 5) : '',
      endTime: s.endTime ? s.endTime.slice(0, 5) : '',
      audScope: s.audience.scope,
      audIds: s.audience.ids ?? [],
      audKeys: s.audience.keys ?? [],
      responsibleTeamId: s.responsibleTeamId ?? '',
      enabled: s.enabled,
    })
    setError(null)
    setShowForm(true)
  }

  const toggleArr = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]

  const save = async () => {
    if (!form.name.trim()) {
      setError('Ponle un nombre a la actividad.')
      return
    }
    setSaving(true)
    setError(null)
    const audience: Audience =
      form.audScope === 'all'
        ? { scope: 'all' }
        : form.audScope === 'ages'
          ? { scope: 'ages', keys: form.audKeys }
          : { scope: form.audScope, ids: form.audIds }
    const payload = {
      church_id: churchId!,
      name: form.name.trim(),
      type_id: form.typeId || null,
      freq: form.freq,
      weekday: form.weekday,
      nth: form.freq === 'monthly' ? form.nth : null,
      start_time: form.startTime || null,
      end_time: form.endTime || null,
      audience: audience as never,
      responsible_team_id: form.responsibleTeamId || null,
      enabled: form.enabled,
    }
    const { error: err } = editingId
      ? await supabase.from('activity_schedules').update(payload).eq('id', editingId)
      : await supabase.from('activity_schedules').insert(payload)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setShowForm(false)
    await load()
  }

  const toggleEnabled = async (s: Schedule) => {
    setSchedules((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))
    await supabase.from('activity_schedules').update({ enabled: !s.enabled }).eq('id', s.id)
  }

  const remove = async (s: Schedule) => {
    if (!window.confirm(`¿Eliminar "${s.name}" del ritmo? Esto quita la actividad recurrente.`)) return
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
            <p className="text-sm text-graysage">
              Define las actividades recurrentes una vez; el sistema proyecta tu semana.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="shrink-0 rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage"
          >
            + Nueva actividad
          </button>
        </div>

        {/* Navegación de semana */}
        <div className="mb-3 flex items-center gap-3">
          <button type="button" onClick={() => setWeekRef(addDays(ws, -7))} className="rounded-lg border border-graysage/25 px-2.5 py-1 text-sm text-graysage hover:bg-white">
            ←
          </button>
          <button type="button" onClick={() => setWeekRef(new Date())} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">
            Hoy
          </button>
          <button type="button" onClick={() => setWeekRef(addDays(ws, 7))} className="rounded-lg border border-graysage/25 px-2.5 py-1 text-sm text-graysage hover:bg-white">
            →
          </button>
          <span className="font-mono text-xs text-graysage">{rangeLabel}</span>
        </div>

        {/* Vista de semana proyectada */}
        <div className="mb-10 grid gap-2 sm:grid-cols-7">
          {week.map((day) => {
            const isToday = day.date.toDateString() === todayKey
            return (
              <div
                key={day.date.toISOString()}
                className={`rounded-xl border bg-white p-2 ${isToday ? 'border-sage ring-1 ring-sage/30' : 'border-clay-light/40'}`}
              >
                <div className="mb-2 flex items-baseline justify-between">
                  <span className={`text-xs font-medium ${isToday ? 'text-sage-dark' : 'text-graysage'}`}>
                    {WEEKDAYS_SHORT[day.weekday]}
                  </span>
                  <span className={`text-sm ${isToday ? 'font-semibold text-sage-dark' : 'text-charcoal'}`}>
                    {day.date.getDate()}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {day.items.length === 0 && <p className="py-2 text-center text-[0.65rem] text-graysage/40">—</p>}
                  {day.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openEdit(s)}
                      style={{ borderLeftColor: colorOf(s) }}
                      className={`block w-full rounded-md border-l-4 bg-cream/60 px-2 py-1.5 text-left transition hover:bg-cream ${s.enabled ? '' : 'opacity-40'}`}
                    >
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
          <p className="rounded-xl border border-dashed border-graysage/30 bg-white/50 px-4 py-8 text-center text-sm text-graysage">
            Aún no hay actividades. Crea la primera con «Nueva actividad».
          </p>
        ) : (
          <ul className="space-y-2">
            {sortedList.map((s) => {
              const t = typeById.get(s.typeId ?? '')
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-clay-light/40 bg-white px-4 py-3 ${s.enabled ? '' : 'opacity-50'}`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s) }} />
                  <span className="font-medium text-charcoal">{s.name}</span>
                  {t && <span className="text-xs text-graysage">· {t.name}</span>}
                  <span className="text-sm text-graysage">· {recurrenceLabel(s)}</span>
                  {s.startTime && (
                    <span className="font-mono text-xs text-graysage">
                      · {formatTime(s.startTime)}
                      {s.endTime ? `–${formatTime(s.endTime)}` : ''}
                    </span>
                  )}
                  <span className="rounded-full bg-sage-water/10 px-2 py-0.5 text-xs text-sage-dark">{audienceLabel(s.audience)}</span>
                  {s.responsibleTeamId && (
                    <span className="text-xs text-graysage">{teamById.get(s.responsibleTeamId)}</span>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <button type="button" onClick={() => toggleEnabled(s)} className="text-xs text-graysage hover:text-sage-dark hover:underline">
                      {s.enabled ? 'Pausar' : 'Activar'}
                    </button>
                    <button type="button" onClick={() => openEdit(s)} className="text-xs text-graysage hover:text-sage-dark hover:underline">
                      Editar
                    </button>
                    <button type="button" onClick={() => remove(s)} className="text-xs text-graysage hover:text-clay hover:underline">
                      Eliminar
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {/* Formulario (panel) */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal/30 p-4 sm:p-8" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-serif text-lg text-charcoal">{editingId ? 'Editar actividad' : 'Nueva actividad'}</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Nombre</label>
                <input value={form.name} onChange={(e) => setF('name', e.target.value)} className={inputCls} placeholder="Culto de oración" autoFocus />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Tipo</label>
                  <select
                    value={form.typeId}
                    onChange={(e) => {
                      const id = e.target.value
                      setForm((p) => ({ ...p, typeId: id, name: p.name || (typeById.get(id)?.name ?? '') }))
                    }}
                    className={inputCls}
                  >
                    <option value="">Sin tipo</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Equipo responsable</label>
                  <select value={form.responsibleTeamId} onChange={(e) => setF('responsibleTeamId', e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Frecuencia</label>
                  <select value={form.freq} onChange={(e) => setF('freq', e.target.value as Freq)} className={inputCls}>
                    <option value="weekly">Cada semana</option>
                    <option value="monthly">Una vez al mes</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Día</label>
                  <select value={form.weekday} onChange={(e) => setF('weekday', Number(e.target.value))} className={inputCls}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={i} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>

              {form.freq === 'monthly' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">¿Qué {WEEKDAYS[form.weekday].toLowerCase()} del mes?</label>
                  <select value={form.nth} onChange={(e) => setF('nth', Number(e.target.value))} className={inputCls}>
                    <option value={1}>1º del mes</option>
                    <option value={2}>2º del mes</option>
                    <option value={3}>3º del mes</option>
                    <option value={4}>4º del mes</option>
                    <option value={-1}>Último del mes</option>
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Hora de inicio</label>
                  <input type="time" value={form.startTime} onChange={(e) => setF('startTime', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Hora de fin <span className="text-graysage/50">(opcional)</span></label>
                  <input type="time" value={form.endTime} onChange={(e) => setF('endTime', e.target.value)} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">¿Para quién?</label>
                <select value={form.audScope} onChange={(e) => setF('audScope', e.target.value as AudienceScope)} className={inputCls}>
                  <option value="all">Toda la iglesia</option>
                  <option value="teams">Equipos específicos</option>
                  <option value="roles">Roles específicos</option>
                  <option value="ages">Rangos de edad</option>
                </select>
                {form.audScope === 'teams' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {teams.map((t) => (
                      <button key={t.id} type="button" onClick={() => setF('audIds', toggleArr(form.audIds, t.id))} className={chipCls(form.audIds.includes(t.id))}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
                {form.audScope === 'roles' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {roles.map((r) => (
                      <button key={r.id} type="button" onClick={() => setF('audIds', toggleArr(form.audIds, r.id))} className={chipCls(form.audIds.includes(r.id))}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
                {form.audScope === 'ages' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ageRanges.filter((r) => r.enabled).map((r) => (
                      <button key={r.key} type="button" onClick={() => setF('audKeys', toggleArr(form.audKeys, r.key))} className={chipCls(form.audKeys.includes(r.key))}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error && <p className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-graysage hover:underline">
                Cancelar
              </button>
              <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage disabled:opacity-60">
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function chipCls(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs transition ${active ? 'bg-sage text-cream' : 'bg-cream text-graysage hover:bg-sage/10'}`
}
