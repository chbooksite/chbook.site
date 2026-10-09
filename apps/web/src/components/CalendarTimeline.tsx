import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, buildAxis, cycleDepth, DAY_MS, parseYmd, startOfDay, ymd, type Cycle } from '../lib/calendar'

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']
const LANE_H = 30
const HEADER_H = 46

// Calendario en estilo línea de tiempo: eje con zoom (horas→días→semanas→meses)
// y ciclos como bandas de color, anidables (ciclos dentro de ciclos), con bordes
// arrastrables para ajustar inicio/fin.
export default function CalendarTimeline({ churchId, cycles }: { churchId: string; cycles: Cycle[] }) {
  const [items, setItems] = useState<Cycle[]>(cycles)
  useEffect(() => setItems(cycles), [cycles])

  const [pxPerDay, setPxPerDay] = useState(10)
  const [selected, setSelected] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; mode: 'left' | 'right' | 'body'; x0: number; s0: Date; e0: Date } | null>(null)

  // Ventana fija: 6 meses atrás → 18 adelante.
  const today = startOfDay(new Date())
  const rangeStart = new Date(today.getFullYear(), today.getMonth() - 6, 1)
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 18, 1)
  const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS)
  const width = totalDays * pxPerDay
  const xOf = (d: Date) => ((d.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay
  const axis = buildAxis(rangeStart, rangeEnd, pxPerDay)

  const byId = new Map(items.map((c) => [c.id, c]))
  const laneOf = (c: Cycle) => cycleDepth(c, byId)
  const maxLane = items.reduce((m, c) => Math.max(m, laneOf(c)), 0)
  const bodyH = HEADER_H + (maxLane + 1) * LANE_H + 8

  const centerToday = () => {
    const el = scrollRef.current
    if (el) el.scrollLeft = xOf(today) - el.clientWidth / 2
  }
  useEffect(() => { centerToday() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (c: Cycle) => {
    await supabase.from('cycles').update({ name: c.name, color: c.color, starts_on: c.startsOn, ends_on: c.endsOn, goal: c.goal, parent_id: c.parentId }).eq('id', c.id)
  }
  const patch = (id: string, p: Partial<Cycle>, save = true) => {
    setItems((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...p } : c))
      if (save) { const c = next.find((x) => x.id === id); if (c) persist(c) }
      return next
    })
  }
  const createCycle = async () => {
    const s = ymd(today)
    const e = ymd(addDays(today, 29))
    const color = COLORS[items.length % COLORS.length]
    const { data, error } = await supabase.from('cycles').insert({ church_id: churchId, name: 'Nuevo ciclo', color, starts_on: s, ends_on: e }).select('id').single()
    if (error || !data) return
    setItems((prev) => [...prev, { id: data.id, parentId: null, name: 'Nuevo ciclo', color, startsOn: s, endsOn: e, goal: null }])
    setSelected(data.id)
  }
  const removeCycle = async (id: string) => {
    await supabase.from('cycles').delete().eq('id', id)
    setItems((prev) => prev.filter((c) => c.id !== id))
    if (selected === id) setSelected(null)
  }

  // Arrastre de bordes / cuerpo de un ciclo.
  const onDown = (c: Cycle, mode: 'left' | 'right' | 'body') => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { id: c.id, mode, x0: e.clientX, s0: parseYmd(c.startsOn), e0: parseYmd(c.endsOn) }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSelected(c.id)
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || e.buttons === 0) { if (d && e.buttons === 0) finishDrag(); return }
    const days = Math.round((e.clientX - d.x0) / pxPerDay)
    let s = d.s0
    let en = d.e0
    if (d.mode === 'left') s = addDays(d.s0, days)
    else if (d.mode === 'right') en = addDays(d.e0, days)
    else { s = addDays(d.s0, days); en = addDays(d.e0, days) }
    if (s > en) { if (d.mode === 'left') s = en; else en = s }
    patch(d.id, { startsOn: ymd(s), endsOn: ymd(en) }, false)
  }
  const finishDrag = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const c = items.find((x) => x.id === d.id)
    if (c) persist(c)
  }

  const sel = items.find((c) => c.id === selected) ?? null
  // Posibles padres: todos menos sí mismo y sus descendientes.
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
        <button type="button" onClick={centerToday} className="rounded-lg border border-graysage/25 px-3 py-1 text-sm text-graysage hover:bg-white">Hoy</button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[0.65rem] text-graysage">Zoom ({axis.unit})</span>
          <input type="range" min={1.5} max={120} step={0.5} value={pxPerDay} onChange={(e) => setPxPerDay(Number(e.target.value))} className="h-1 w-40 cursor-pointer accent-sage" />
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-graysage/20 bg-cream/40">
        <div className="relative touch-none" style={{ width, height: bodyH }} onPointerMove={onMove} onPointerUp={finishDrag}>
          {/* banda superior (unidad grande) */}
          {axis.top.map((b, i) => (
            <div key={i} style={{ left: b.x, width: b.w }} className={`absolute top-0 h-5 overflow-hidden border-l border-graysage/20 px-1 text-[0.6rem] leading-5 ${b.strong ? 'font-semibold text-charcoal' : 'text-graysage'}`}>
              {b.label}
            </div>
          ))}
          {/* ticks (unidad fina) */}
          {axis.ticks.map((t, i) => (
            <div key={i} style={{ left: t.x }} className="absolute top-5 text-[0.55rem] text-graysage/70">
              <span className="absolute left-0 top-0 h-2 w-px bg-graysage/20" />
              <span className="absolute left-0.5 top-2 whitespace-nowrap">{t.label}</span>
            </div>
          ))}
          {/* línea de hoy */}
          <span style={{ left: xOf(today) }} className="absolute top-0 z-10 w-0.5 bg-clay/70" aria-hidden />
          <span style={{ left: xOf(today), height: bodyH }} className="absolute top-0 z-10 w-0.5 bg-clay/40" aria-hidden />

          {/* ciclos */}
          {items.map((c) => {
            const left = xOf(parseYmd(c.startsOn))
            const w = Math.max(6, xOf(addDays(parseYmd(c.endsOn), 1)) - left)
            const topPx = HEADER_H + laneOf(c) * LANE_H
            return (
              <div
                key={c.id}
                onPointerDown={onDown(c, 'body')}
                onPointerMove={onMove}
                onPointerUp={finishDrag}
                style={{ left, width: w, top: topPx, backgroundColor: c.color, borderColor: c.color }}
                className={`absolute flex h-[26px] cursor-grab items-center overflow-hidden rounded border px-1.5 text-white active:cursor-grabbing ${selected === c.id ? 'ring-2 ring-white' : ''}`}
                title={`${c.name} · ${c.startsOn} → ${c.endsOn}`}
              >
                <span onPointerDown={onDown(c, 'left')} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/20" />
                <span className="truncate text-[0.7rem] font-medium">{c.name}</span>
                <span onPointerDown={onDown(c, 'right')} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/20" />
              </div>
            )
          })}
        </div>
      </div>

      {/* edición del ciclo seleccionado */}
      {sel && (
        <div className="mt-3 rounded-xl border border-sage/30 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="color" value={sel.color} onChange={(e) => patch(sel.id, { color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-graysage/25" title="Color" />
            <input value={sel.name} onChange={(e) => patch(sel.id, { name: e.target.value })} className="min-w-40 flex-1 rounded-lg border border-graysage/25 bg-cream/40 px-2.5 py-1.5 text-sm outline-none focus:border-sage" />
            <button type="button" onClick={() => removeCycle(sel.id)} className="rounded-lg px-2 py-1 text-lg text-graysage hover:text-clay" title="Eliminar ciclo">🗑</button>
            <button type="button" onClick={() => setSelected(null)} className="px-2 text-lg leading-none text-graysage hover:text-charcoal" title="Cerrar">✕</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-graysage">
            <label className="flex items-center gap-1">Inicio <input type="date" value={sel.startsOn} onChange={(e) => patch(sel.id, { startsOn: e.target.value })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" /></label>
            <label className="flex items-center gap-1">Fin <input type="date" value={sel.endsOn} onChange={(e) => patch(sel.id, { endsOn: e.target.value })} className="rounded border border-graysage/25 bg-cream/40 px-1.5 py-1 text-sm text-charcoal" /></label>
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
