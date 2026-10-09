import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import {
  addDays,
  addMonths,
  buildAxis,
  chooseUnit,
  cycleDepth,
  cycleOccurrences,
  CYCLE_DURATIONS,
  DAY_MS,
  occurrenceEnd,
  parseYmd,
  startOfDay,
  ymd,
  type Cycle,
  type CycleDuration,
} from '../lib/calendar'

const UNIT_LABEL: Record<string, string> = { hours: 'horas', days: 'días', weeks: 'semanas', months: 'meses' }

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']
const LANE_H = 30
const HEADER_H = 46

// Calendario en línea de tiempo: eje con zoom (horas→meses) y ciclos como bandas
// de color anidables. La duración se elige por preset (y nº de repeticiones o
// continuo); solo se ingresa la fecha de inicio y el resto se calcula.
export default function CalendarTimeline({ churchId, cycles }: { churchId: string; cycles: Cycle[] }) {
  const [items, setItems] = useState<Cycle[]>(cycles)
  useEffect(() => setItems(cycles), [cycles])

  const [zoomT, setZoomT] = useState(35) // 0 = un año visible · 100 = un día (con horas)
  const [containerW, setContainerW] = useState(900)
  const [selected, setSelected] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ sl: number; x: number } | null>(null)

  const today = startOfDay(new Date())
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 6, 1)
  const rangeEnd = addMonths(rangeStart, 12) // ventana de un año
  const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS)
  const minPx = Math.max(0.5, containerW / totalDays) // zoom máx. de alejamiento: el año entra justo
  const maxPx = Math.max(minPx * 2, containerW) // zoom máx. de acercamiento: ~un día ocupa el ancho
  const pxPerDay = minPx * Math.pow(maxPx / minPx, zoomT / 100)
  const width = totalDays * pxPerDay
  const xOf = (d: Date) => ((d.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay
  const unit = chooseUnit(containerW / pxPerDay)
  const axis = buildAxis(rangeStart, rangeEnd, pxPerDay, unit)

  const byId = new Map(items.map((c) => [c.id, c]))
  const laneOf = (c: Cycle) => cycleDepth(c, byId)
  const maxLane = items.reduce((m, c) => Math.max(m, laneOf(c)), 0)
  const bodyH = HEADER_H + (maxLane + 1) * LANE_H + 8

  // Por defecto HOY en el "cero" (borde izquierdo) de la barra.
  const todayToStart = (behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ left: xOf(today), behavior })
  }
  // Imán suave: al soltar cerca de hoy, se acomoda a cero.
  const magnetToday = () => {
    const el = scrollRef.current
    if (el && Math.abs(el.scrollLeft - xOf(today)) < 44) el.scrollTo({ left: xOf(today), behavior: 'smooth' })
  }
  useLayoutEffect(() => {
    const measure = () => { if (scrollRef.current) setContainerW(scrollRef.current.clientWidth) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => { todayToStart() }, [zoomT, containerW]) // eslint-disable-line react-hooks/exhaustive-deps

  // Presets de zoom: selecciona directamente una temporalidad.
  const tFor = (visibleDays: number) => {
    const px = containerW / visibleDays
    const t = (100 * Math.log(px / minPx)) / Math.log(maxPx / minPx)
    return Math.max(0, Math.min(100, t))
  }
  const ZOOM_PRESETS: { label: string; days: number }[] = [
    { label: 'Día', days: 1 },
    { label: 'Semana', days: 7 },
    { label: 'Mes', days: 30 },
    { label: 'Año', days: 365 },
  ]

  const persist = async (c: Cycle) => {
    await supabase.from('cycles').update({ name: c.name, color: c.color, starts_on: c.startsOn, ends_on: c.endsOn, goal: c.goal, parent_id: c.parentId, duration: c.duration, repeat: c.repeat }).eq('id', c.id)
  }
  const patch = (id: string, p: Partial<Cycle>, save = true) => {
    setItems((prev) => {
      const next = prev.map((c) => {
        if (c.id !== id) return c
        const merged = { ...c, ...p }
        // Si cambia la duración (preset) o el inicio, recalcular el fin de una ocurrencia.
        if (merged.duration !== 'custom' && ('duration' in p || 'startsOn' in p)) {
          merged.endsOn = ymd(occurrenceEnd(merged.duration, parseYmd(merged.startsOn), parseYmd(merged.endsOn)))
        }
        return merged
      })
      if (save) { const c = next.find((x) => x.id === id); if (c) persist(c) }
      return next
    })
  }
  const createCycle = async () => {
    const s = ymd(today)
    const e = ymd(occurrenceEnd('quarterly', today, today))
    const color = COLORS[items.length % COLORS.length]
    const { data, error } = await supabase.from('cycles').insert({ church_id: churchId, name: 'Nuevo ciclo', color, starts_on: s, ends_on: e, duration: 'quarterly', repeat: 1 }).select('id').single()
    if (error || !data) return
    setItems((prev) => [...prev, { id: data.id, parentId: null, name: 'Nuevo ciclo', color, startsOn: s, endsOn: e, goal: null, duration: 'quarterly', repeat: 1 }])
    setSelected(data.id)
  }
  const removeCycle = async (id: string) => {
    await supabase.from('cycles').delete().eq('id', id)
    setItems((prev) => prev.filter((c) => c.id !== id))
    if (selected === id) setSelected(null)
  }

  // Los ciclos NO se arrastran (se editan por fechas en el panel). El arrastre de
  // la barra solo sirve para desplazarse en el tiempo (1:1, sin seleccionar texto).
  const onBgDown = (e: RPointerEvent) => {
    const el = scrollRef.current
    if (!el) return
    e.preventDefault() // evita selección de texto al arrastrar
    pan.current = { sl: el.scrollLeft, x: e.clientX }
    trackRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    if (!pan.current) return
    if (e.buttons === 0) { pan.current = null; magnetToday(); return }
    const el = scrollRef.current
    if (el) el.scrollLeft = pan.current.sl - (e.clientX - pan.current.x)
  }
  const onUp = () => {
    if (pan.current) { pan.current = null; magnetToday() }
  }

  const sel = items.find((c) => c.id === selected) ?? null
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>()
    const walk = (pid: string) => items.filter((c) => c.parentId === pid).forEach((ch) => { if (!out.has(ch.id)) { out.add(ch.id); walk(ch.id) } })
    walk(id)
    return out
  }
  const parentOptions = sel ? items.filter((c) => c.id !== sel.id && !descendants(sel.id).has(c.id)) : []

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={createCycle} className="rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-medium text-cream transition hover:bg-sage">+ Nuevo ciclo</button>
        <button type="button" onClick={() => todayToStart('smooth')} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">Hoy</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-graysage/25">
            {ZOOM_PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => setZoomT(tFor(p.days))} className={`px-2 py-1 text-xs transition ${Math.abs(tFor(p.days) - zoomT) < 7 ? 'bg-sage text-cream' : 'text-graysage hover:bg-sage/10'}`}>{p.label}</button>
            ))}
          </div>
          {/* slider: Día (izq) → Año (der), invierte zoomT */}
          <span className="text-[0.65rem] text-graysage">Día</span>
          <input type="range" min={0} max={100} step={1} value={100 - zoomT} onChange={(e) => setZoomT(100 - Number(e.target.value))} className="h-1 w-36 cursor-pointer accent-sage" title={`Zoom: ${UNIT_LABEL[unit]}`} />
          <span className="text-[0.65rem] text-graysage">Año</span>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-graysage/20 bg-cream/40">
        <div ref={trackRef} onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} className="relative touch-none cursor-grab select-none active:cursor-grabbing" style={{ width, height: bodyH }}>
          {axis.top.map((b, i) => (
            <div key={i} style={{ left: b.x, width: b.w }} className={`absolute top-0 h-5 overflow-hidden border-l border-graysage/20 px-1 text-[0.6rem] leading-5 ${b.strong ? 'font-semibold text-charcoal' : 'text-graysage'}`}>{b.label}</div>
          ))}
          {axis.ticks.map((t, i) => (
            <div key={i} style={{ left: t.x }} className="absolute top-5 text-[0.55rem] text-graysage/70">
              <span className="absolute left-0 top-0 h-2 w-px bg-graysage/20" />
              <span className="absolute left-0.5 top-2 whitespace-nowrap">{t.label}</span>
            </div>
          ))}
          <span style={{ left: xOf(today), height: bodyH }} className="absolute top-0 z-10 w-0.5 bg-clay/50" aria-hidden />

          {items.map((c) => {
            const occ = cycleOccurrences(c, rangeEnd)
            const topPx = HEADER_H + laneOf(c) * LANE_H
            return occ.map((o) => {
              const left = xOf(o.start)
              const w = Math.max(6, xOf(addDays(o.end, 1)) - left)
              return (
                <div
                  key={`${c.id}:${o.i}`}
                  onPointerDown={(e) => { e.stopPropagation(); setSelected(c.id) }}
                  style={{ left, width: w, top: topPx, backgroundColor: c.color, borderColor: c.color }}
                  className={`absolute flex h-[26px] cursor-pointer items-center overflow-hidden rounded border px-1.5 text-white ${o.i === 0 ? '' : 'opacity-70'} ${selected === c.id ? 'ring-2 ring-white' : ''}`}
                  title={`${c.name} · ${ymd(o.start)} → ${ymd(o.end)}`}
                >
                  <span className="truncate text-[0.7rem] font-medium">{c.name}{c.repeat !== 1 ? ` ${o.i + 1}` : ''}</span>
                </div>
              )
            })
          })}
        </div>
      </div>

      {sel && (
        <div className="mt-3 rounded-xl border border-sage/30 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="color" value={sel.color} onChange={(e) => patch(sel.id, { color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-graysage/25" title="Color" />
            <input value={sel.name} onChange={(e) => patch(sel.id, { name: e.target.value })} className="min-w-40 flex-1 rounded-lg border border-graysage/25 bg-cream/40 px-2.5 py-1.5 text-sm outline-none focus:border-sage" />
            <button type="button" onClick={() => removeCycle(sel.id)} className="rounded-lg px-2 py-1 text-lg text-graysage hover:text-clay" title="Eliminar ciclo">🗑</button>
            <button type="button" onClick={() => setSelected(null)} className="px-2 text-lg leading-none text-graysage hover:text-charcoal" title="Cerrar">✕</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-graysage">
            <label className="flex items-center gap-1">Inicio
              <input type="date" value={sel.startsOn} onChange={(e) => patch(sel.id, { startsOn: e.target.value })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" />
            </label>
            <label className="flex items-center gap-1">Duración
              <select value={sel.duration} onChange={(e) => patch(sel.id, { duration: e.target.value as CycleDuration })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal">
                {CYCLE_DURATIONS.map((d) => (<option key={d.value} value={d.value}>{d.label}</option>))}
              </select>
            </label>
            {sel.duration === 'custom' && (
              <label className="flex items-center gap-1">Fin
                <input type="date" value={sel.endsOn} onChange={(e) => patch(sel.id, { endsOn: e.target.value })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" />
              </label>
            )}
            <label className="flex items-center gap-1">Repeticiones
              <input type="number" min={1} value={sel.repeat === 0 ? '' : sel.repeat} disabled={sel.repeat === 0} onChange={(e) => patch(sel.id, { repeat: Math.max(1, Number(e.target.value) || 1) })} className="w-16 rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal disabled:opacity-50" />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={sel.repeat === 0} onChange={(e) => patch(sel.id, { repeat: e.target.checked ? 0 : 1 })} />
              Continuo
            </label>
            <label className="flex items-center gap-1">Dentro de
              <select value={sel.parentId ?? ''} onChange={(e) => patch(sel.id, { parentId: e.target.value || null })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal">
                <option value="">— (ciclo raíz)</option>
                {parentOptions.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </label>
          </div>
          <input value={sel.goal ?? ''} onChange={(e) => patch(sel.id, { goal: e.target.value || null })} placeholder="Meta del ciclo (opcional)…" className="mt-2 w-full rounded-lg border border-graysage/25 bg-cream/40 px-2.5 py-1.5 text-sm outline-none focus:border-sage" />
        </div>
      )}
    </div>
  )
}
