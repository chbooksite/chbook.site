import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { minToClock, type Segment } from '../lib/activity'

// Línea de tiempo HORIZONTAL del servicio.
//  · Barras proporcionales a la duración, en orden y sin solaparse.
//  · Se arrastra el borde derecho de cada barra para ajustar sus minutos.
//  · Se arrastra el cuerpo de una barra para moverla (reordenar).
//  · Zoom para leer actividades cortas + barra de navegación (minimapa) al ampliar.
//  · Debajo: hora de reloj en cada divisoria.
export default function ServiceTimeline({
  segments,
  totalMin,
  startMin,
  colorOf,
  onDuration,
  onReorder,
  onSelect,
  selectedKey,
  keyOf,
}: {
  segments: Segment[]
  totalMin: number | null
  startMin: number | null
  colorOf: (s: Segment) => string
  onDuration: (index: number, min: number) => void
  onReorder: (from: number, to: number) => void
  onSelect?: (index: number, originFrac?: number) => void
  selectedKey?: string | null
  keyOf: (s: Segment, i: number) => string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const ovRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'resize' | 'reorder'; i: number; key: string } | null>(null)
  const navDrag = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [win, setWin] = useState({ left: 0, width: 100 }) // ventana visible (% del total)

  const sum = segments.reduce((a, s) => a + (s.durationMin ?? 0), 0)
  const scale = Math.max(totalMin ?? 0, sum, 1)
  const remaining = totalMin != null ? totalMin - sum : null
  const boundaryLabel = (offset: number) => (startMin != null ? minToClock(startMin + offset) : `${offset}′`)

  const syncWin = () => {
    const el = scrollRef.current
    if (!el || el.scrollWidth === 0) return
    setWin({ left: (el.scrollLeft / el.scrollWidth) * 100, width: (el.clientWidth / el.scrollWidth) * 100 })
  }
  useEffect(syncWin, [zoom, segments])

  const cursorMin = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * scale
  }

  const onResizeDown = (i: number, key: string) => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { mode: 'resize', i, key }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onBodyDown = (i: number, key: string, pinned: boolean) => (e: RPointerEvent) => {
    const sc = scrollRef.current
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const frac = sc ? Math.max(0, Math.min(1, (r.left + r.width / 2 - sc.getBoundingClientRect().left) / sc.clientWidth)) : undefined
    onSelect?.(i, frac)
    if (pinned) return
    drag.current = { mode: 'reorder', i, key }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || !trackRef.current) return
    if (d.mode === 'resize') {
      const before = segments.slice(0, d.i).reduce((a, s) => a + (s.durationMin ?? 0), 0)
      onDuration(d.i, Math.max(1, Math.round(cursorMin(e.clientX) - before)))
      return
    }
    // reorder: hallar índice destino según la posición del cursor
    const from = segments.findIndex((s, i) => keyOf(s, i) === d.key)
    if (from < 0) return
    const cm = cursorMin(e.clientX)
    let acc = 0
    let to = segments.length - 1
    for (let i = 0; i < segments.length; i++) {
      const dur = segments[i].durationMin ?? 0
      if (cm < acc + dur / 2) { to = i; break }
      acc += dur
    }
    if (to !== from) onReorder(from, to)
  }
  const onUp = () => {
    drag.current = null
  }

  // navegación (minimapa)
  const scrollToFrac = (frac: number, behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    const w = win.width / 100
    el.scrollTo({ left: Math.max(0, Math.min(1, frac - w / 2)) * el.scrollWidth, behavior })
  }
  const onNavDown = (e: RPointerEvent) => {
    navDrag.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const r = ovRef.current!.getBoundingClientRect()
    scrollToFrac((e.clientX - r.left) / r.width, 'smooth')
  }
  const onNavMove = (e: RPointerEvent) => {
    if (!navDrag.current || !ovRef.current) return
    const r = ovRef.current.getBoundingClientRect()
    scrollToFrac((e.clientX - r.left) / r.width)
  }
  const onNavUp = () => {
    navDrag.current = false
  }

  if (segments.length === 0) {
    return <p className="rounded-lg border border-dashed border-graysage/30 py-4 text-center text-xs text-graysage/60">Agrega actividades para ver la línea de tiempo.</p>
  }

  let acc = 0
  const offsets = segments.map((s) => { const o = acc; acc += s.durationMin ?? 0; return o })
  const zoomed = zoom > 1.01

  const renderBar = (mini: boolean) => (
    <div className={`flex ${mini ? 'h-3' : 'h-16'} w-full overflow-hidden rounded-lg border border-graysage/20 bg-cream/50`}>
      {segments.map((s, i) => {
        const w = ((s.durationMin ?? 0) / scale) * 100
        const k = keyOf(s, i)
        return (
          <div
            key={k}
            onPointerDown={mini ? undefined : onBodyDown(i, k, !!s.pinned)}
            onPointerMove={mini ? undefined : onMove}
            onPointerUp={mini ? undefined : onUp}
            style={{ width: `${w}%`, backgroundColor: colorOf(s) }}
            className={`relative flex flex-col justify-center overflow-hidden ${mini ? '' : 'cursor-grab px-1.5 active:cursor-grabbing'} ${!mini && selectedKey === k ? 'ring-2 ring-inset ring-white' : ''}`}
            title={mini ? undefined : `${s.name} · ${s.durationMin ?? 0} min`}
          >
            {!mini && (
              <>
                <span className="truncate text-[0.7rem] font-medium leading-tight text-white/95">{s.name}</span>
                <span className="text-[0.6rem] leading-tight text-white/80">{s.durationMin ?? 0}′{s.pinned ? ' 📌' : ''}</span>
                <span onPointerDown={onResizeDown(i, k)} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/15 hover:bg-black/30" title="Arrastra para ajustar la duración" />
              </>
            )}
          </div>
        )
      })}
      {remaining != null && remaining > 0 && (
        <div style={{ width: `${(remaining / scale) * 100}%` }} className="flex items-center justify-center">
          {!mini && <span className="text-[0.6rem] text-graysage/50">{remaining}′</span>}
        </div>
      )}
    </div>
  )

  return (
    <div className="select-none">
      {/* control de zoom */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.65rem] text-graysage">Zoom</span>
        <input type="range" min={1} max={6} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="h-1 flex-1 cursor-pointer accent-sage" />
        <span className="w-8 text-right font-mono text-[0.65rem] text-graysage">{zoom}×</span>
      </div>

      {/* barra con scroll */}
      <div ref={scrollRef} onScroll={syncWin} className="overflow-x-auto">
        <div ref={trackRef} style={{ width: `${zoom * 100}%` }} className="touch-none transition-[width] duration-300 ease-out">
          {renderBar(false)}
          {/* horas en cada divisoria */}
          <div className="relative mt-1 h-4">
            {offsets.map((o, i) => (
              <span key={i} style={{ left: `${(o / scale) * 100}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(o)}</span>
            ))}
            <span style={{ left: `${(sum / scale) * 100}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(sum)}</span>
          </div>
        </div>
      </div>

      {/* barra de navegación (minimapa) — solo al ampliar */}
      {zoomed && (
        <div ref={ovRef} onPointerDown={onNavDown} onPointerMove={onNavMove} onPointerUp={onNavUp} className="relative mt-1.5 cursor-pointer touch-none">
          {renderBar(true)}
          <div style={{ left: `${win.left}%`, width: `${win.width}%` }} className="pointer-events-none absolute top-0 h-3 rounded border-2 border-charcoal/50 bg-charcoal/10 transition-[left,width] duration-150 ease-out" />
        </div>
      )}

      <p className="mt-1 text-[0.65rem] text-graysage/70">
        Total: {sum} min{totalMin != null ? ` · servicio ${totalMin} min` : ''}
        {remaining != null && remaining < 0 ? ` · ⚠ excede ${-remaining} min` : ''}
      </p>
    </div>
  )
}
