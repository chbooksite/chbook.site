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
type Mode = 'week' | 'day' | 'month'

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']
const LANE_H = 30
const HEADER_H = 46
const TIMELINE_H = 250
const CARD_H = 54 // alto de una ficha de actividad
const CARD_GAP = 4
const ACTS_TOP = HEADER_H + 28 // bajo el encabezado
const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Calendario con tres modos sobre la MISMA línea de tiempo de días deformados:
// SEMANA (zoom 1–2 semanas; la regla muestra el día, p.ej. "Mié 21"), MES (zoom
// 1–6 meses; la regla muestra el MES y cada cuadro muestra el número del día) y
// DÍA (horas del día, zoom 1h–24h; se entra tocando un día en la regla).
// Navegación con inercia, imán al lunes en semana y transición al cambiar de modo.
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

  const [mode, setMode] = useState<Mode>('week')
  const [dayDate, setDayDate] = useState<Date>(startOfDay(new Date()))
  const [zoomT, setZoomT] = useState(100) // significado según el modo (0=alejado, 100=acercado)
  const [animKey, setAnimKey] = useState(0)
  const [containerW, setContainerW] = useState(900)
  const [selected, setSelected] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ sl: number; x: number; y: number; lastX: number; lastT: number; v: number } | null>(null)
  const momentum = useRef<number | null>(null)
  const animScroll = useRef<number | null>(null)
  const ovRef = useRef<HTMLDivElement>(null)
  const navDrag = useRef<{ x: number; sl: number; ratio: number } | null>(null)
  const [win, setWin] = useState({ left: 0, width: 100 })
  const [headLabel, setHeadLabel] = useState('')

  const today = startOfDay(new Date())
  const weekStart = addDays(today, -((today.getDay() + 6) % 7)) // lunes de la semana actual
  const monthStartToday = new Date(today.getFullYear(), today.getMonth(), 1)
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 6, 1)
  const rangeEnd = addMonths(rangeStart, 12)
  const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS)
  const grid = mode === 'week' || mode === 'month' // vistas sobre la línea de días

  // ---- actividades del ritmo en el rango (compartido por los modos) ----
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
  const dayBars = new Map<number, Bar[]>()
  for (const b of bars) { const k = startOfDay(b.start).getTime(); const a = dayBars.get(k) ?? []; a.push(b); dayBars.set(k, a) }
  const dayColors = new Map<number, string[]>()
  for (const [k, arr] of dayBars) dayColors.set(k, Array.from(new Set(arr.map((b) => b.color))))

  // ---- línea de días deformada (SEMANA y MES); el zoom define la escala ----
  const scaleMin = mode === 'month' ? containerW / 183 : containerW / 14 // alejado: 6 meses / 2 semanas
  const scaleMax = mode === 'month' ? containerW / 30 : containerW / 7 // acercado: 1 mes / 1 semana
  const pxPerDay = Math.max(0.5, scaleMin) * Math.pow(Math.max(scaleMax, scaleMin * 1.01) / Math.max(0.5, scaleMin), zoomT / 100)
  const activeIdx = new Set<number>()
  for (const k of dayColors.keys()) activeIdx.add(Math.round((k - rangeStart.getTime()) / DAY_MS))
  const weightAt = (i: number) => (activeIdx.has(i) ? 1 : 0.25)
  let rawTotal = 0
  for (let i = 0; i < totalDays; i++) rawTotal += weightAt(i)
  const warpScale = rawTotal > 0 ? totalDays / rawTotal : 1
  const xStart = new Float64Array(totalDays + 1)
  for (let i = 0; i < totalDays; i++) xStart[i + 1] = xStart[i] + weightAt(i) * warpScale * pxPerDay
  const gridWidth = xStart[totalDays]
  const dayPxAt = (i: number) => xStart[i + 1] - xStart[i]
  const xOf = (d: Date) => {
    const f = (d.getTime() - rangeStart.getTime()) / DAY_MS
    if (f <= 0) return 0
    if (f >= totalDays) return gridWidth
    const i = Math.floor(f)
    return xStart[i] + (f - i) * dayPxAt(i)
  }
  const xToIdx = (px: number) => {
    let lo = 0, hi = totalDays - 1, idx = 0
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (xStart[mid] <= px) { idx = mid; lo = mid + 1 } else hi = mid - 1 }
    return idx
  }
  const wUnit = chooseUnit(containerW / pxPerDay)
  const wAxis = buildAxis(rangeStart, rangeEnd, pxPerDay, wUnit, xOf)
  const monthStarts: Date[] = []
  { let m = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1); while (m < rangeEnd) { monthStarts.push(new Date(m)); m = addMonths(m, 1) } }

  // ---- DÍA: horas del día, zoom 1h (acercado) – 24h (alejado) ----
  const dOutPx = containerW / 24
  const dInPx = containerW
  const pxPerHour = dOutPx * Math.pow(dInPx / dOutPx, zoomT / 100)
  const dayWidth = 24 * pxPerHour
  const xHour = (d: Date) => ((d.getTime() - dayDate.getTime()) / 3600000) * pxPerHour
  const dayList = dayBars.get(dayDate.getTime()) ?? []
  const dayAllDay = dayList.filter((b) => !b.timed)
  const dayTimed = dayList.filter((b) => b.timed).sort((a, b) => a.start.getTime() - b.start.getTime())
  const dLaneEnd: number[] = []
  const dLaneOf = new Map<string, number>()
  for (const b of dayTimed) { let L = 0; while (L < dLaneEnd.length && dLaneEnd[L] > b.start.getTime()) L++; dLaneOf.set(b.key, L); dLaneEnd[L] = b.end.getTime() }
  const dayAllTop = HEADER_H + 8
  const dayTimedTop = dayAllTop + dayAllDay.length * 26 + (dayAllDay.length ? 8 : 0)
  const dayBodyH = Math.max(300, dayTimedTop + Math.max(1, dLaneEnd.length) * (CARD_H + CARD_GAP) + 16)

  // ---- ciclos (solo en semana) ----
  const byId = new Map(items.map((c) => [c.id, c]))
  const laneOf = (c: Cycle) => cycleDepth(c, byId)
  const maxLane = items.reduce((m, c) => Math.max(m, laneOf(c)), 0)
  const lanesH = (maxLane + 1) * LANE_H
  const maxCards = Array.from(dayBars.values()).reduce((m, a) => Math.max(m, a.length), 0)
  const barsAreaH = maxCards ? maxCards * (CARD_H + CARD_GAP) + 10 : 0
  const gridBodyH = Math.max(TIMELINE_H, ACTS_TOP + barsAreaH + (mode === 'week' ? lanesH : 0) + 20)
  const cyclesTop = gridBodyH - lanesH - 10

  const width = grid ? gridWidth : dayWidth
  const bodyH = grid ? gridBodyH : dayBodyH

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
  const homeTarget = () => {
    if (mode === 'week') return xOf(weekStart)
    if (mode === 'month') return xOf(monthStartToday)
    return Math.max(0, 6 * pxPerHour)
  }
  const resetHome = (animate = false) => {
    const el = scrollRef.current
    if (!el) return
    const t = homeTarget()
    if (animate) animateScrollTo(t); else el.scrollLeft = t
  }
  // Imán al lunes (solo semana): encuadra el próximo lunes a la derecha del borde
  // cuando cae en la mitad izquierda del recuadro.
  const magnetWeek = () => {
    if (mode !== 'week') return
    const el = scrollRef.current
    if (!el) return
    const leftDate = addDays(rangeStart, xToIdx(el.scrollLeft))
    const back = (leftDate.getDay() + 6) % 7
    let mon = addDays(leftDate, -back)
    if (xOf(mon) < el.scrollLeft) mon = addDays(mon, 7)
    const onScreen = xOf(mon) - el.scrollLeft
    if (onScreen >= 0 && onScreen <= el.clientWidth / 2) animateScrollTo(xOf(mon), 1000, EASE_IN_OUT)
  }
  useLayoutEffect(() => {
    const measure = () => { if (scrollRef.current) setContainerW(scrollRef.current.clientWidth) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => { resetHome(); syncWin() }, [mode, dayDate, containerW]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncWin() }, [zoomT]) // eslint-disable-line react-hooks/exhaustive-deps

  function syncWin() {
    const el = scrollRef.current
    if (!el || !el.scrollWidth) return
    setWin({ left: (el.scrollLeft / el.scrollWidth) * 100, width: Math.max(4, (el.clientWidth / el.scrollWidth) * 100) })
    if (grid) {
      setHeadLabel(cap(addDays(rangeStart, xToIdx(el.scrollLeft)).toLocaleDateString('es', { month: 'long', year: 'numeric' })))
    } else {
      setHeadLabel(cap(dayDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })))
    }
  }

  const bump = () => setAnimKey((k) => k + 1)
  const goWeek = () => { setMode('week'); setZoomT(100); bump() }
  const goMonth = () => { setMode('month'); setZoomT(100); bump() }
  const enterDay = (d: Date) => { setDayDate(startOfDay(d)); setMode('day'); setZoomT(0); bump() }

  // ---- pan con inercia + detección de toque (entrar a un día) ----
  const onBgDown = (e: RPointerEvent) => {
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()
    if (momentum.current) { cancelAnimationFrame(momentum.current); momentum.current = null }
    if (animScroll.current) { cancelAnimationFrame(animScroll.current); animScroll.current = null }
    pan.current = { sl: el.scrollLeft, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: performance.now(), v: 0 }
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
  const handleTap = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const dayEl = el?.closest('[data-day]') as HTMLElement | null
    if (dayEl?.dataset.day) enterDay(parseYmd(dayEl.dataset.day))
  }
  const onUp = (e: RPointerEvent) => {
    const p = pan.current
    if (!p) return
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
    if (moved < 5) { pan.current = null; handleTap(e.clientX, e.clientY); return }
    releasePan()
  }
  const releasePan = () => {
    const p = pan.current
    pan.current = null
    if (!p) return
    const el = scrollRef.current
    if (!el) return
    let v = p.v * 0.55
    let pos = el.scrollLeft
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(48, now - last); last = now
      v *= Math.pow(0.95, dt / 16)
      if (Math.abs(v) < 0.01) { momentum.current = null; magnetWeek(); return }
      pos += v * dt
      const max = el.scrollWidth - el.clientWidth
      if (pos <= 0 || pos >= max) { el.scrollLeft = Math.max(0, Math.min(max, pos)); momentum.current = null; magnetWeek(); return }
      el.scrollLeft = pos
      momentum.current = requestAnimationFrame(step)
    }
    momentum.current = requestAnimationFrame(step)
  }

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

  const zoomEnds = mode === 'week' ? ['1 sem', '2 sem'] : mode === 'day' ? ['1 h', '24 h'] : ['1 mes', '6 meses']

  return (
    <div>
      <style>{`@keyframes calIn{0%{opacity:0;transform:scale(.82)}60%{opacity:1}100%{opacity:1;transform:none}}`}</style>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {mode === 'day' ? (
          <>
            <button type="button" onClick={goWeek} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">‹ Volver a semana</button>
            <span className="font-serif text-sm capitalize text-charcoal">{cap(dayDate.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
          </>
        ) : (
          <>
            <button type="button" onClick={createCycle} className="rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-medium text-cream transition hover:bg-sage">+ Nuevo ciclo</button>
            <button type="button" onClick={() => resetHome(true)} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">{mode === 'week' ? 'Esta semana' : 'Este mes'}</button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-graysage/25">
            <button type="button" onClick={goWeek} className={`px-3 py-1 text-xs transition ${mode === 'week' ? 'bg-sage text-cream' : 'text-graysage hover:bg-sage/10'}`}>Semana</button>
            <button type="button" onClick={goMonth} className={`px-3 py-1 text-xs transition ${mode === 'month' ? 'bg-sage text-cream' : 'text-graysage hover:bg-sage/10'}`}>Mes</button>
          </div>
          <span className="text-[0.65rem] text-graysage">{zoomEnds[0]}</span>
          <input type="range" min={0} max={100} step={1} value={100 - zoomT} onChange={(e) => setZoomT(100 - Number(e.target.value))} className="h-1 w-36 cursor-pointer accent-sage" title="Zoom" />
          <span className="text-[0.65rem] text-graysage">{zoomEnds[1]}</span>
        </div>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute left-px top-px z-20 flex h-5 items-center bg-cream/95 pl-2 pr-3 text-[0.72rem] capitalize text-charcoal">{headLabel}</div>
        <div ref={scrollRef} onScroll={syncWin} className="overflow-x-auto rounded-xl border border-graysage/20 bg-cream/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div
            key={animKey}
            ref={trackRef}
            onPointerDown={onBgDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            style={{ width, height: bodyH, animation: 'calIn 520ms cubic-bezier(.22,1,.36,1)', transformOrigin: 'center' }}
            className="relative touch-none cursor-grab select-none active:cursor-grabbing"
          >
            {/* ============ SEMANA / MES ============ */}
            {grid && (
              <>
                {/* regla: SEMANA = día (Mié 21); MES = nombre del mes */}
                {mode === 'week' ? (
                  wAxis.ticks.map((t, i) => {
                    const sunday = t.label.startsWith('Dom')
                    return (
                      <div key={i} style={{ left: t.x }} className="absolute top-5">
                        <span className="absolute left-0 top-0 h-2 w-px bg-graysage/25" />
                        <span className={`absolute left-1 top-2.5 whitespace-nowrap text-[0.82rem] ${sunday ? 'text-red-500' : 'text-graysage'}`}>{t.label}</span>
                      </div>
                    )
                  })
                ) : (
                  monthStarts.map((ms, i) => (
                    <div key={i} style={{ left: xOf(ms) }} className="absolute top-0">
                      <span style={{ height: bodyH }} className="absolute top-0 w-px bg-graysage/30" />
                      <span className="absolute left-1.5 top-1 whitespace-nowrap font-serif text-[0.9rem] capitalize text-charcoal">{cap(ms.toLocaleDateString('es', { month: 'long' }))}</span>
                    </div>
                  ))
                )}

                {/* divisorias por día */}
                {pxPerDay >= 10 && Array.from({ length: totalDays }, (_, i) => (
                  <span key={`d${i}`} style={{ left: xStart[i], top: HEADER_H, height: bodyH - HEADER_H }} className="absolute w-px bg-graysage/15" />
                ))}

                {/* MES: tinte del día con actividad + número del día dentro del cuadro */}
                {mode === 'month' && Array.from({ length: totalDays }, (_, i) => {
                  const d = addDays(rangeStart, i)
                  const dp = dayPxAt(i)
                  const cols = dayColors.get(startOfDay(d).getTime())
                  const sunday = d.getDay() === 0
                  const isToday = d.getTime() === today.getTime()
                  return (
                    <div key={`n${i}`}>
                      {cols && <span style={{ left: xStart[i], width: dp, top: HEADER_H, height: bodyH - HEADER_H, backgroundColor: `${cols[0]}1f` }} className="absolute" aria-hidden />}
                      {dp >= 11 && <span style={{ left: xStart[i], width: dp, top: HEADER_H + 4 }} className={`absolute text-center text-[0.82rem] ${isToday ? 'font-bold text-clay' : sunday ? 'text-red-500' : 'text-charcoal/80'}`}>{d.getDate()}</span>}
                    </div>
                  )
                })}

                {/* zonas clicables para abrir el día: en Semana sobre la regla; en Mes el cuadro entero */}
                {Array.from({ length: totalDays }, (_, i) => (
                  <span
                    key={`hit${i}`}
                    data-day={ymd(addDays(rangeStart, i))}
                    style={mode === 'week' ? { left: xStart[i], width: dayPxAt(i), top: 0, height: HEADER_H } : { left: xStart[i], width: dayPxAt(i), top: HEADER_H, height: bodyH - HEADER_H }}
                    className="absolute cursor-pointer"
                    title="Abrir este día"
                  />
                ))}

                {(() => {
                  const ti = Math.round((today.getTime() - rangeStart.getTime()) / DAY_MS)
                  if (ti < 0 || ti >= totalDays) return null
                  return <span style={{ left: xStart[ti], width: dayPxAt(ti), top: HEADER_H, height: bodyH - HEADER_H }} className="pointer-events-none absolute rounded-md border-2 border-clay/70 bg-clay/5" aria-hidden />
                })()}

                {/* fichas de actividad (se ocultan cuando el cuadro es muy angosto) */}
                {Array.from(dayBars.entries()).map(([ms, arr]) => {
                  const i = Math.round((ms - rangeStart.getTime()) / DAY_MS)
                  const left = xStart[i]
                  const dp = dayPxAt(i)
                  if (dp < 26) return null
                  const top0 = mode === 'month' ? ACTS_TOP + 6 : ACTS_TOP
                  return arr.map((b, k) => (
                    <div
                      key={b.key}
                      onPointerDown={(e) => { e.stopPropagation(); onEditSchedule?.(b.scheduleId) }}
                      style={{ left: left + 2, width: Math.max(8, dp - 4), top: top0 + k * (CARD_H + CARD_GAP), height: CARD_H, borderLeftColor: b.color }}
                      className="absolute flex cursor-pointer flex-col justify-center overflow-hidden rounded-md border-l-4 bg-graysage/10 px-2.5 text-charcoal hover:bg-graysage/20"
                      title={b.title}
                    >
                      <span className="truncate text-sm font-semibold leading-tight">{b.title}</span>
                      <span className="truncate text-[0.72rem] leading-tight text-charcoal/70">{b.timed ? `${hhmm(b.start)}–${hhmm(b.end)}` : 'Todo el día'}</span>
                    </div>
                  ))
                })}

                {/* ciclos (solo semana) */}
                {mode === 'week' && items.map((c) => {
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
              </>
            )}

            {/* ============ DÍA ============ */}
            {mode === 'day' && (
              <>
                {Array.from({ length: 25 }, (_, h) => (
                  <div key={`h${h}`} style={{ left: h * pxPerHour }} className="absolute top-0">
                    <span style={{ height: bodyH }} className="absolute top-5 w-px bg-graysage/15" />
                    {h < 24 && <span className="absolute left-1 top-1 whitespace-nowrap text-[0.82rem] text-graysage">{h}:00</span>}
                  </div>
                ))}

                {dayDate.getTime() === today.getTime() && (() => {
                  const now = new Date()
                  const x = ((now.getTime() - dayDate.getTime()) / 3600000) * pxPerHour
                  return <span style={{ left: x, height: bodyH }} className="pointer-events-none absolute top-0 z-10 w-0.5 bg-clay/70" aria-hidden />
                })()}

                {dayAllDay.map((b, k) => (
                  <div key={b.key} onPointerDown={(e) => { e.stopPropagation(); onEditSchedule?.(b.scheduleId) }} style={{ left: 2, right: 2, top: dayAllTop + k * 26, borderLeftColor: b.color }} className="absolute flex h-[22px] cursor-pointer items-center overflow-hidden rounded-md border-l-4 bg-graysage/10 px-2 text-charcoal hover:bg-graysage/20">
                    <span className="truncate text-[0.8rem] font-medium">{b.title}</span>
                    <span className="ml-2 text-[0.68rem] text-charcoal/60">Todo el día</span>
                  </div>
                ))}

                {dayTimed.map((b) => {
                  const left = xHour(b.start)
                  const w = Math.max(28, xHour(b.end) - left)
                  const top = dayTimedTop + (dLaneOf.get(b.key) ?? 0) * (CARD_H + CARD_GAP)
                  return (
                    <div key={b.key} onPointerDown={(e) => { e.stopPropagation(); onEditSchedule?.(b.scheduleId) }} style={{ left, width: w, top, height: CARD_H, borderLeftColor: b.color }} className="absolute flex cursor-pointer flex-col justify-center overflow-hidden rounded-md border-l-4 bg-graysage/10 px-2.5 text-charcoal hover:bg-graysage/20">
                      <span className="truncate text-sm font-semibold leading-tight">{b.title}</span>
                      <span className="truncate text-[0.72rem] leading-tight text-charcoal/70">{hhmm(b.start)}–{hhmm(b.end)}</span>
                    </div>
                  )
                })}

                {dayList.length === 0 && (
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-graysage/50">Sin actividades este día</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* barra de navegación propia */}
      <div ref={ovRef} onPointerDown={onNavDown} onPointerMove={onNavMove} onPointerUp={onNavUp} className="relative mt-1.5 h-3 cursor-pointer touch-none rounded bg-graysage/10">
        <div style={{ left: `${win.left}%`, width: `${win.width}%` }} className="absolute top-0 h-3 min-w-[32px] rounded bg-graysage/40 hover:bg-graysage/55" />
      </div>

      {mode === 'week' && sel && (
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
