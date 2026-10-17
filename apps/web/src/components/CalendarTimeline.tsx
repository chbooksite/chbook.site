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
import { occursOn, type Schedule } from '../lib/activity'

type RecSchedule = Schedule & { color: string }

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']
const LANE_H = 30
const HEADER_H = 46
const TIMELINE_H = 250
const CARD_H = 54 // alto de una ficha de actividad
const CARD_GAP = 4
const ACTS_TOP = HEADER_H + 28 // bajo el día/fecha del encabezado
const UNIT_LABEL: Record<string, string> = { hours: 'horas', days: 'días', weeks: 'semanas', months: 'meses' }
const hhmm =(d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

// Calendario en línea de tiempo: proyecta las ACTIVIDADES del ritmo (recurrentes,
// solo lectura — se editan con "Nueva actividad") y permite marcar CICLOS de color
// anidables. Eje con zoom (año→día), navegación con inercia e imán a hoy.
export default function CalendarTimeline({
  churchId,
  cycles,
  recurring,
  onEditSchedule,
}: {
  churchId: string
  cycles: Cycle[]
  recurring: RecSchedule[]
  onEditSchedule?: (id: string) => void
}) {
  const [items, setItems] = useState<Cycle[]>(cycles)
  useEffect(() => setItems(cycles), [cycles])

  const [zoomT, setZoomT] = useState(67) // por defecto ~ vista de semana (0=año, 100=día)
  const [containerW, setContainerW] = useState(900)
  const [selected, setSelected] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ sl: number; x: number; lastX: number; lastT: number; v: number } | null>(null)
  const momentum = useRef<number | null>(null)
  const animScroll = useRef<number | null>(null)
  const ovRef = useRef<HTMLDivElement>(null)
  const navDrag = useRef<{ x: number; sl: number; ratio: number } | null>(null)
  const [win, setWin] = useState({ left: 0, width: 100 })
  const [headLabel, setHeadLabel] = useState('')

  const today = startOfDay(new Date())
  const weekStart = addDays(today, -((today.getDay() + 6) % 7)) // lunes de la semana actual
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 6, 1)
  const rangeEnd = addMonths(rangeStart, 12)
  const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS)
  const minPx = Math.max(0.5, containerW / totalDays)
  const maxPx = Math.max(minPx * 2, containerW)
  const pxPerDay = minPx * Math.pow(maxPx / minPx, zoomT / 100)

  const syncWin = () => {
    const el = scrollRef.current
    if (!el || !el.scrollWidth) return
    setWin({ left: (el.scrollLeft / el.scrollWidth) * 100, width: Math.max(4, (el.clientWidth / el.scrollWidth) * 100) })
    const leftDate = addDays(rangeStart, xToIdx(el.scrollLeft))
    setHeadLabel(leftDate.toLocaleDateString('es', { month: 'long', year: 'numeric' }))
  }
  const unit = chooseUnit(containerW / pxPerDay)

  // Ocurrencias de las actividades del ritmo en el rango visible.
  interface Bar { key: string; start: Date; end: Date; title: string; color: string; scheduleId: string; timed: boolean }
  const occStart = (day: Date, s: Schedule) => {
    if (!s.startTime) return startOfDay(day)
    const [h, m] = s.startTime.split(':').map(Number)
    const d = new Date(day); d.setHours(h || 0, m || 0, 0, 0); return d
  }
  const occEnd = (start: Date, s: Schedule) => {
    if (!s.startTime) return addDays(startOfDay(start), 1)
    if (s.endTime) { const [h, m] = s.endTime.split(':').map(Number); const d = new Date(start); d.setHours(h || 0, m || 0, 0, 0); if (d > start) return d }
    return new Date(start.getTime() + 3600000)
  }
  const bars: Bar[] = []
  for (const r of recurring) {
    let cur = startOfDay(rangeStart)
    while (cur < rangeEnd) {
      if (occursOn(r, cur)) { const start = occStart(cur, r); const end = occEnd(start, r); bars.push({ key: `${r.id}:${ymd(cur)}`, start, end, title: r.name, color: r.color, scheduleId: r.id, timed: !!r.startTime }) }
      cur = addDays(cur, 1)
    }
  }
  bars.sort((a, b) => a.start.getTime() - b.start.getTime())

  // Actividades agrupadas por día + colores de ese día.
  const dayBars = new Map<number, Bar[]>()
  for (const b of bars) { const k = startOfDay(b.start).getTime(); const a = dayBars.get(k) ?? []; a.push(b); dayBars.set(k, a) }
  const dayColors = new Map<number, string[]>()
  for (const [k, arr] of dayBars) dayColors.set(k, Array.from(new Set(arr.map((b) => b.color))))

  // Deformación de días: un día SIN actividad ocupa 1/4 de uno CON actividad; el
  // ancho total se conserva (= zoom), así los días con actividad se agrandan para
  // llenar la vista. El eje y las barras usan este xOf deformado.
  const activeIdx = new Set<number>()
  for (const k of dayColors.keys()) activeIdx.add(Math.round((k - rangeStart.getTime()) / DAY_MS))
  const weightAt = (i: number) => (activeIdx.has(i) ? 1 : 0.25)
  let rawTotal = 0
  for (let i = 0; i < totalDays; i++) rawTotal += weightAt(i)
  const warpScale = rawTotal > 0 ? totalDays / rawTotal : 1
  const xStart = new Float64Array(totalDays + 1)
  for (let i = 0; i < totalDays; i++) xStart[i + 1] = xStart[i] + weightAt(i) * warpScale * pxPerDay
  const width = xStart[totalDays]
  const dayPxAt = (i: number) => xStart[i + 1] - xStart[i]
  const xOf = (d: Date) => {
    const f = (d.getTime() - rangeStart.getTime()) / DAY_MS
    if (f <= 0) return 0
    if (f >= totalDays) return width
    const i = Math.floor(f)
    return xStart[i] + (f - i) * dayPxAt(i)
  }
  const xToIdx = (px: number) => {
    let lo = 0, hi = totalDays - 1, idx = 0
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (xStart[mid] <= px) { idx = mid; lo = mid + 1 } else hi = mid - 1 }
    return idx
  }
  const axis = buildAxis(rangeStart, rangeEnd, pxPerDay, unit, xOf)
  // En vistas diaria/semanal, el mes/año se ancla al inicio de la barra (siempre
  // visible); en vistas amplias usamos las etiquetas de cada banda.
  const stickyMonth = unit !== 'months'

  const byId = new Map(items.map((c) => [c.id, c]))
  const laneOf = (c: Cycle) => cycleDepth(c, byId)
  const maxLane = items.reduce((m, c) => Math.max(m, laneOf(c)), 0)
  const lanesH = (maxLane + 1) * LANE_H

  const maxCards = Array.from(dayBars.values()).reduce((m, a) => Math.max(m, a.length), 0)
  const barsAreaH = maxCards ? maxCards * (CARD_H + CARD_GAP) + 10 : 0
  const bodyH = Math.max(TIMELINE_H, ACTS_TOP + barsAreaH + lanesH + 20)
  const cyclesTop = bodyH - lanesH - 10 // los ciclos se apoyan abajo

  // ---- navegación / zoom ----
  const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3)
  const EASE_IN_OUT = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const animateScrollTo = (target: number, dur = 650, ease: (t: number) => number = EASE_OUT) => {
    const el = scrollRef.current
    if (!el) return
    if (animScroll.current) cancelAnimationFrame(animScroll.current)
    const start = el.scrollLeft
    const dist = target - start
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      el.scrollLeft = start + dist * ease(t)
      animScroll.current = t < 1 ? requestAnimationFrame(step) : null
    }
    animScroll.current = requestAnimationFrame(step)
  }
  const weekToStart = (animate = false) => {
    const el = scrollRef.current
    if (!el) return
    if (animate) animateScrollTo(xOf(weekStart))
    else el.scrollLeft = xOf(weekStart)
  }
  // Al soltar, encuadra el borde izquierdo al inicio del próximo LUNES, pero SOLO
  // cuando ese lunes está a la derecha del borde y dentro de la mitad izquierda
  // del recuadro visible (si está más allá de la mitad, no tira).
  const magnetWeek = () => {
    const el = scrollRef.current
    if (!el) return
    const leftDate = addDays(rangeStart, xToIdx(el.scrollLeft))
    const back = (leftDate.getDay() + 6) % 7 // días desde el lunes
    let mon = addDays(leftDate, -back)
    if (xOf(mon) < el.scrollLeft) mon = addDays(mon, 7) // primer lunes a la derecha del borde
    const onScreen = xOf(mon) - el.scrollLeft
    if (onScreen >= 0 && onScreen <= el.clientWidth / 2) animateScrollTo(xOf(mon), 1000, EASE_IN_OUT)
  }
  useLayoutEffect(() => {
    const measure = () => { if (scrollRef.current) setContainerW(scrollRef.current.clientWidth) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => { weekToStart(); syncWin() }, [zoomT, containerW]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // pan por arrastre de zonas vacías con inercia
  const onBgDown = (e: RPointerEvent) => {
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()
    if (momentum.current) { cancelAnimationFrame(momentum.current); momentum.current = null }
    if (animScroll.current) { cancelAnimationFrame(animScroll.current); animScroll.current = null }
    pan.current = { sl: el.scrollLeft, x: e.clientX, lastX: e.clientX, lastT: performance.now(), v: 0 }
    trackRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const p = pan.current
    if (!p) return
    if (e.buttons === 0) { releasePan(); return }
    const el = scrollRef.current
    if (el) el.scrollLeft = p.sl - (e.clientX - p.x)
    const now = performance.now()
    const dt = now - p.lastT
    if (dt > 0) { p.v = p.v * 0.7 + (-(e.clientX - p.lastX) / dt) * 0.3; p.lastX = e.clientX; p.lastT = now }
  }
  const releasePan = () => {
    const p = pan.current
    pan.current = null
    if (!p) return
    let v = p.v
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last; last = now
      v *= Math.pow(0.93, dt / 16)
      const el = scrollRef.current
      if (!el || Math.abs(v) < 0.02) { momentum.current = null; magnetWeek(); return }
      const before = el.scrollLeft
      el.scrollLeft += v * dt
      if (el.scrollLeft === before) { momentum.current = null; magnetWeek(); return }
      momentum.current = requestAnimationFrame(step)
    }
    momentum.current = requestAnimationFrame(step)
  }
  const onUp = () => { if (pan.current) releasePan() }

  const onNavDown = (e: RPointerEvent) => {
    const ov = ovRef.current
    const el = scrollRef.current
    if (!ov || !el) return
    e.preventDefault()
    if (momentum.current) { cancelAnimationFrame(momentum.current); momentum.current = null }
    const r = ov.getBoundingClientRect()
    el.scrollLeft = ((e.clientX - r.left) / r.width) * el.scrollWidth - el.clientWidth / 2
    navDrag.current = { x: e.clientX, sl: el.scrollLeft, ratio: el.scrollWidth / ov.clientWidth }
    ov.setPointerCapture(e.pointerId)
    syncWin()
  }
  const onNavMove = (e: RPointerEvent) => {
    const d = navDrag.current
    if (!d) return
    if (e.buttons === 0) { navDrag.current = null; return }
    const el = scrollRef.current
    if (el) el.scrollLeft = d.sl + (e.clientX - d.x) * d.ratio
  }
  const onNavUp = () => { navDrag.current = null }

  // ---- ciclos ----
  const persist = async (c: Cycle) => {
    await supabase.from('cycles').update({ name: c.name, color: c.color, starts_on: c.startsOn, ends_on: c.endsOn, goal: c.goal, parent_id: c.parentId, duration: c.duration, repeat: c.repeat }).eq('id', c.id)
  }
  const patch = (id: string, p: Partial<Cycle>) => {
    setItems((prev) => {
      const next = prev.map((c) => {
        if (c.id !== id) return c
        const merged = { ...c, ...p }
        if (merged.duration !== 'custom' && ('duration' in p || 'startsOn' in p)) merged.endsOn = ymd(occurrenceEnd(merged.duration, parseYmd(merged.startsOn), parseYmd(merged.endsOn)))
        return merged
      })
      const c = next.find((x) => x.id === id); if (c) persist(c)
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
        <button type="button" onClick={() => weekToStart(true)} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">Esta semana</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-graysage/25">
            {ZOOM_PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => setZoomT(tFor(p.days))} className={`px-2 py-1 text-xs transition ${Math.abs(tFor(p.days) - zoomT) < 7 ? 'bg-sage text-cream' : 'text-graysage hover:bg-sage/10'}`}>{p.label}</button>
            ))}
          </div>
          <span className="text-[0.65rem] text-graysage">Día</span>
          <input type="range" min={0} max={100} step={1} value={100 - zoomT} onChange={(e) => setZoomT(100 - Number(e.target.value))} className="h-1 w-36 cursor-pointer accent-sage" title={`Zoom: ${UNIT_LABEL[unit]}`} />
          <span className="text-[0.65rem] text-graysage">Año</span>
        </div>
      </div>

      <div className="relative">
        {stickyMonth && (
          <div className="pointer-events-none absolute left-px top-px z-20 flex h-5 items-center bg-cream/95 pl-2 pr-3 text-[0.72rem] capitalize text-charcoal">{headLabel}</div>
        )}
        <div ref={scrollRef} onScroll={syncWin} className="overflow-x-auto rounded-xl border border-graysage/20 bg-cream/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div ref={trackRef} onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} className="relative touch-none cursor-grab select-none active:cursor-grabbing" style={{ width, height: bodyH }}>
          {axis.top.map((b, i) => (
            <div key={i} style={{ left: b.x, width: b.w }} className={`absolute top-0 h-5 overflow-hidden border-l border-graysage/20 px-1 text-[0.72rem] leading-5 ${b.strong ? 'font-semibold text-charcoal' : 'text-graysage'}`}>{stickyMonth ? '' : b.label}</div>
          ))}
          {axis.ticks.map((t, i) => {
            const sunday = t.label.startsWith('Dom')
            return (
              <div key={i} style={{ left: t.x }} className="absolute top-5">
                <span className="absolute left-0 top-0 h-2 w-px bg-graysage/25" />
                <span className={`absolute left-1 top-2.5 whitespace-nowrap text-[0.82rem] ${sunday ? 'text-red-500' : 'text-graysage'}`}>{t.label}</span>
              </div>
            )
          })}

          {/* divisorias verticales por día */}
          {pxPerDay >= 10 && (() => {
            const lines: Date[] = []
            let cur = startOfDay(rangeStart)
            while (cur < rangeEnd) { lines.push(cur); cur = addDays(cur, 1) }
            return lines.map((_d, i) => (
              <span key={`d${i}`} style={{ left: xStart[i], top: HEADER_H, height: bodyH - HEADER_H }} className="absolute w-px bg-graysage/15" />
            ))
          })()}

          {(() => {
            const ti = Math.round((today.getTime() - rangeStart.getTime()) / DAY_MS)
            if (ti < 0 || ti >= totalDays) return null
            return <span style={{ left: xStart[ti], width: dayPxAt(ti), top: HEADER_H, height: bodyH - HEADER_H }} className="pointer-events-none absolute rounded-md border-2 border-clay/70 bg-clay/5" aria-hidden />
          })()}

          {/* actividades del ritmo: ficha dentro del recuadro del día (clic edita) */}
          {Array.from(dayBars.entries()).map(([ms, arr]) => {
            const i = Math.round((ms - rangeStart.getTime()) / DAY_MS)
            const left = xStart[i]
            const dp = dayPxAt(i)
            if (dp < 26) return null // muy angosto: basta la banda de color
            return arr.map((b, k) => (
              <div
                key={b.key}
                onPointerDown={(e) => { e.stopPropagation(); onEditSchedule?.(b.scheduleId) }}
                style={{ left: left + 2, width: Math.max(8, dp - 4), top: ACTS_TOP + k * (CARD_H + CARD_GAP), height: CARD_H, borderLeftColor: b.color }}
                className="absolute flex cursor-pointer flex-col justify-center overflow-hidden rounded-md border-l-4 bg-graysage/10 px-2.5 text-charcoal hover:bg-graysage/20"
                title={b.title}
              >
                <span className="truncate text-sm font-semibold leading-tight">{b.title}</span>
                <span className="truncate text-[0.72rem] leading-tight text-charcoal/70">{b.timed ? `${hhmm(b.start)}–${hhmm(b.end)}` : 'Todo el día'}</span>
              </div>
            ))
          })}

          {/* ciclos (abajo) */}
          {items.map((c) => {
            const occ = cycleOccurrences(c, rangeEnd)
            const topPx = cyclesTop + laneOf(c) * LANE_H
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
      </div>

      {/* barra de navegación propia */}
      <div ref={ovRef} onPointerDown={onNavDown} onPointerMove={onNavMove} onPointerUp={onNavUp} className="relative mt-1.5 h-3 cursor-pointer touch-none rounded bg-graysage/10">
        <div style={{ left: `${win.left}%`, width: `${win.width}%` }} className="absolute top-0 h-3 min-w-[32px] rounded bg-graysage/40 hover:bg-graysage/55" />
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
