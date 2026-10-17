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
  eventBounds,
  occurrenceEnd,
  parseYmd,
  startOfDay,
  ymd,
  type CalEvent,
  type Cycle,
  type CycleDuration,
} from '../lib/calendar'

const UNIT_LABEL: Record<string, string> = { hours: 'horas', days: 'días', weeks: 'semanas', months: 'meses' }
const WEEKDAY_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'] // getDay(): 0=domingo

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']
const LANE_H = 30
const HEADER_H = 46
const TIMELINE_H = 250 // ~3× la altura anterior
const EV_H = 22 // alto de una barra de evento
const EVENTS_TOP = HEADER_H + 18 // bajo las letras de día

// Calendario en línea de tiempo: eje con zoom (horas→meses) y ciclos como bandas
// de color anidables. La duración se elige por preset (y nº de repeticiones o
// continuo); solo se ingresa la fecha de inicio y el resto se calcula.
export default function CalendarTimeline({ churchId, cycles, events }: { churchId: string; cycles: Cycle[]; events: CalEvent[] }) {
  const [items, setItems] = useState<Cycle[]>(cycles)
  useEffect(() => setItems(cycles), [cycles])
  const [evItems, setEvItems] = useState<CalEvent[]>(events)
  useEffect(() => setEvItems(events), [events])
  const [selEvent, setSelEvent] = useState<string | null>(null)

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
  const [win, setWin] = useState({ left: 0, width: 100 }) // ventana visible (% del total) para la barra de navegación

  const syncWin = () => {
    const el = scrollRef.current
    if (!el || !el.scrollWidth) return
    setWin({ left: (el.scrollLeft / el.scrollWidth) * 100, width: Math.max(4, (el.clientWidth / el.scrollWidth) * 100) })
  }

  // Desplazamiento animado (ease-out suave, estilo inercia) hasta un objetivo.
  const animateScrollTo = (target: number, dur = 650) => {
    const el = scrollRef.current
    if (!el) return
    if (animScroll.current) cancelAnimationFrame(animScroll.current)
    const start = el.scrollLeft
    const dist = target - start
    const t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      el.scrollLeft = start + dist * ease(t)
      animScroll.current = t < 1 ? requestAnimationFrame(step) : null
    }
    animScroll.current = requestAnimationFrame(step)
  }

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
  const lanesH = (maxLane + 1) * LANE_H
  // Empaca eventos en carriles para que los solapes se apilen (no se tapen).
  const evSorted = [...evItems].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
  const laneEndMs: number[] = []
  const evLane = new Map<string, number>()
  for (const e of evSorted) {
    const { start, end } = eventBounds(e)
    let L = 0
    while (L < laneEndMs.length && laneEndMs[L] > start.getTime()) L++
    evLane.set(e.id, L)
    laneEndMs[L] = end.getTime()
  }
  const eventsAreaH = laneEndMs.length ? laneEndMs.length * EV_H + 10 : 0
  const bodyH = Math.max(TIMELINE_H, EVENTS_TOP + eventsAreaH + lanesH + 20)
  const cyclesTop = bodyH - lanesH - 10 // los ciclos se apoyan en la parte de abajo

  // Por defecto HOY en el "cero" (borde izquierdo) de la barra.
  const todayToStart = (animate = false) => {
    const el = scrollRef.current
    if (!el) return
    if (animate) animateScrollTo(xOf(today))
    else el.scrollLeft = xOf(today)
  }
  // Imán: si la línea de HOY queda de la mitad de la barra hacia la izquierda,
  // se acomoda a cero (borde izquierdo) con un movimiento suave.
  const magnetToday = () => {
    const el = scrollRef.current
    if (!el) return
    const target = xOf(today)
    const onScreen = target - el.scrollLeft // posición de "hoy" dentro del viewport
    if (onScreen > -el.clientWidth * 0.25 && onScreen <= el.clientWidth / 2) {
      animateScrollTo(target, 700)
    }
  }
  useLayoutEffect(() => {
    const measure = () => { if (scrollRef.current) setContainerW(scrollRef.current.clientWidth) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => { todayToStart(); syncWin() }, [zoomT, containerW]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- Eventos ----
  const persistEv = async (e: CalEvent) => {
    await supabase.from('events').update({ title: e.title, color: e.color, starts_at: e.startsAt, ends_at: e.endsAt, all_day: e.allDay, event_type: e.type }).eq('id', e.id)
  }
  const patchEv = (id: string, p: Partial<CalEvent>) => {
    setEvItems((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, ...p } : e))
      const e = next.find((x) => x.id === id)
      if (e) persistEv(e)
      return next
    })
  }
  const createEvent = async () => {
    const s = new Date(); s.setHours(0, 0, 0, 0)
    const iso = s.toISOString()
    const color = COLORS[(items.length + evItems.length) % COLORS.length]
    const { data, error } = await supabase.from('events').insert({ church_id: churchId, title: 'Nuevo evento', color, starts_at: iso, ends_at: iso, all_day: true, event_type: 'special' }).select('id').single()
    if (error || !data) return
    setEvItems((prev) => [...prev, { id: data.id, title: 'Nuevo evento', color, startsAt: iso, endsAt: iso, allDay: true, type: 'special' }])
    setSelEvent(data.id); setSelected(null)
  }
  const removeEvent = async (id: string) => {
    await supabase.from('events').delete().eq('id', id)
    setEvItems((prev) => prev.filter((e) => e.id !== id))
    if (selEvent === id) setSelEvent(null)
  }
  // ISO ↔ valores de input (en hora local)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const toDateInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
  const toDTInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` }
  const fromDateInput = (v: string) => { const [y, m, dd] = v.split('-').map(Number); return new Date(y, (m || 1) - 1, dd || 1).toISOString() }
  const fromDTInput = (v: string) => new Date(v).toISOString()

  // Los ciclos NO se arrastran (se editan por fechas en el panel). El arrastre de
  // la barra solo sirve para desplazarse en el tiempo (1:1, sin seleccionar texto).
  const onBgDown = (e: RPointerEvent) => {
    const el = scrollRef.current
    if (!el) return
    e.preventDefault() // evita selección de texto al arrastrar
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
    if (dt > 0) {
      const inst = -(e.clientX - p.lastX) / dt // px de scroll por ms
      p.v = p.v * 0.7 + inst * 0.3 // suavizado
      p.lastX = e.clientX
      p.lastT = now
    }
  }
  // Al soltar: continuar el movimiento con la última velocidad y frenar suave.
  const releasePan = () => {
    const p = pan.current
    pan.current = null
    if (!p) return
    let v = p.v
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      last = now
      v *= Math.pow(0.93, dt / 16) // fricción
      const el = scrollRef.current
      if (!el || Math.abs(v) < 0.02) { momentum.current = null; magnetToday(); return }
      const before = el.scrollLeft
      el.scrollLeft += v * dt
      if (el.scrollLeft === before) { momentum.current = null; magnetToday(); return } // tope
      momentum.current = requestAnimationFrame(step)
    }
    momentum.current = requestAnimationFrame(step)
  }
  const onUp = () => { if (pan.current) releasePan() }

  // Barra de navegación propia (tirador cómodo): clic para ir y arrastrar.
  const onNavDown = (e: RPointerEvent) => {
    const ov = ovRef.current
    const el = scrollRef.current
    if (!ov || !el) return
    e.preventDefault()
    if (momentum.current) { cancelAnimationFrame(momentum.current); momentum.current = null }
    const r = ov.getBoundingClientRect()
    const frac = (e.clientX - r.left) / r.width
    el.scrollLeft = frac * el.scrollWidth - el.clientWidth / 2 // centra la ventana donde haces clic
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

  const sel = items.find((c) => c.id === selected) ?? null
  const selEv = evItems.find((e) => e.id === selEvent) ?? null
  const EVENT_TYPES = [
    { value: 'special', label: 'Especial' },
    { value: 'service', label: 'Servicio' },
    { value: 'rehearsal', label: 'Ensayo' },
    { value: 'cell', label: 'Célula' },
    { value: 'other', label: 'Otro' },
  ]
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
        <button type="button" onClick={createEvent} className="rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-medium text-cream transition hover:bg-sage">+ Evento</button>
        <button type="button" onClick={createCycle} className="rounded-lg border border-sage/40 px-3 py-1.5 text-sm font-medium text-sage-dark transition hover:bg-sage/10">+ Ciclo</button>
        <button type="button" onClick={() => todayToStart(true)} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">Hoy</button>
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

      <div ref={scrollRef} onScroll={syncWin} className="overflow-x-auto rounded-xl border border-graysage/20 bg-cream/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          {/* líneas verticales por día + inicial del día (referencia) */}
          {pxPerDay >= 12 && (() => {
            const lines: Date[] = []
            let cur = startOfDay(rangeStart)
            while (cur < rangeEnd) { lines.push(cur); cur = addDays(cur, 1) }
            return lines.map((d, i) => {
              const x = xOf(d)
              const weekend = d.getDay() === 0 || d.getDay() === 6
              return (
                <div key={`d${i}`}>
                  <span style={{ left: x, top: HEADER_H, height: bodyH - HEADER_H }} className="absolute w-px bg-graysage/15" />
                  <span style={{ left: x + 2, top: HEADER_H + 2 }} className={`absolute text-[0.55rem] ${weekend ? 'text-clay/70' : 'text-graysage/60'}`}>{WEEKDAY_LETTER[d.getDay()]}</span>
                </div>
              )
            })
          })()}

          <span style={{ left: xOf(today), height: bodyH }} className="absolute top-0 z-10 w-0.5 bg-clay/50" aria-hidden />

          {/* eventos (un día o multi-día), apilados por carriles cuando se solapan */}
          {evItems.map((e) => {
            const { start, end } = eventBounds(e)
            const left = xOf(start)
            const w = Math.max(10, xOf(end) - left)
            const top = EVENTS_TOP + (evLane.get(e.id) ?? 0) * EV_H
            const col = e.color || '#64748b'
            return (
              <div
                key={e.id}
                onPointerDown={(ev) => { ev.stopPropagation(); setSelEvent(e.id); setSelected(null) }}
                style={{ left, width: w, top, backgroundColor: col, borderColor: col }}
                className={`absolute flex h-[20px] cursor-pointer items-center overflow-hidden rounded border px-1.5 text-white ${selEvent === e.id ? 'ring-2 ring-white' : ''}`}
                title={`${e.title}`}
              >
                {!e.allDay && <span className="mr-1 text-[0.55rem] text-white/80">{toDTInput(e.startsAt).slice(11)}</span>}
                <span className="truncate text-[0.65rem] font-medium">{e.title}</span>
              </div>
            )
          })}

          {items.map((c) => {
            const occ = cycleOccurrences(c, rangeEnd)
            const topPx = cyclesTop + laneOf(c) * LANE_H
            return occ.map((o) => {
              const left = xOf(o.start)
              const w = Math.max(6, xOf(addDays(o.end, 1)) - left)
              return (
                <div
                  key={`${c.id}:${o.i}`}
                  onPointerDown={(e) => { e.stopPropagation(); setSelected(c.id); setSelEvent(null) }}
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

      {/* barra de navegación propia (tirador cómodo, menos sensible) */}
      <div ref={ovRef} onPointerDown={onNavDown} onPointerMove={onNavMove} onPointerUp={onNavUp} className="relative mt-1.5 h-3 cursor-pointer touch-none rounded bg-graysage/10">
        <div style={{ left: `${win.left}%`, width: `${win.width}%` }} className="absolute top-0 h-3 min-w-[32px] rounded bg-graysage/40 hover:bg-graysage/55" />
      </div>

      {selEv && (
        <div className="mt-3 rounded-xl border border-sage/30 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="color" value={selEv.color ?? '#64748b'} onChange={(e) => patchEv(selEv.id, { color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-graysage/25" title="Color" />
            <input value={selEv.title} onChange={(e) => patchEv(selEv.id, { title: e.target.value })} className="min-w-40 flex-1 rounded-lg border border-graysage/25 bg-cream/40 px-2.5 py-1.5 text-sm outline-none focus:border-sage" />
            <button type="button" onClick={() => removeEvent(selEv.id)} className="rounded-lg px-2 py-1 text-lg text-graysage hover:text-clay" title="Eliminar evento">🗑</button>
            <button type="button" onClick={() => setSelEvent(null)} className="px-2 text-lg leading-none text-graysage hover:text-charcoal" title="Cerrar">✕</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-graysage">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={selEv.allDay} onChange={(e) => patchEv(selEv.id, { allDay: e.target.checked })} />
              Todo el día
            </label>
            {selEv.allDay ? (
              <>
                <label className="flex items-center gap-1">Inicio <input type="date" value={toDateInput(selEv.startsAt)} onChange={(e) => patchEv(selEv.id, { startsAt: fromDateInput(e.target.value) })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" /></label>
                <label className="flex items-center gap-1">Fin <input type="date" value={toDateInput(selEv.endsAt ?? selEv.startsAt)} onChange={(e) => patchEv(selEv.id, { endsAt: fromDateInput(e.target.value) })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" /></label>
              </>
            ) : (
              <>
                <label className="flex items-center gap-1">Inicio <input type="datetime-local" value={toDTInput(selEv.startsAt)} onChange={(e) => patchEv(selEv.id, { startsAt: fromDTInput(e.target.value) })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" /></label>
                <label className="flex items-center gap-1">Fin <input type="datetime-local" value={toDTInput(selEv.endsAt ?? selEv.startsAt)} onChange={(e) => patchEv(selEv.id, { endsAt: fromDTInput(e.target.value) })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" /></label>
              </>
            )}
            <label className="flex items-center gap-1">Tipo
              <select value={selEv.type ?? 'special'} onChange={(e) => patchEv(selEv.id, { type: e.target.value })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal">
                {EVENT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </label>
          </div>
        </div>
      )}

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
