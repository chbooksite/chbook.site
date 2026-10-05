import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { minToClock, type Segment } from '../lib/activity'

// Línea de tiempo HORIZONTAL del servicio, con actividades en SIMULTÁNEO:
// nivel 1 = barra principal; niveles 2 y 3 = barras paralelas (media altura)
// bajo la principal, alineadas a la misma escala de tiempo. En cada barra:
//  · arrastrar el borde derecho transfiere minutos con la actividad vecina;
//  · arrastrar el cuerpo reordena;
//  · zoom + minimapa para navegar.
export default function ServiceTimeline({
  segments,
  totalMin,
  startMin,
  colorOf,
  onResize,
  onReorder,
  onSelect,
  onBarBottom,
  selectedKey,
  keyOf,
}: {
  segments: Segment[]
  totalMin: number | null
  startMin: number | null
  colorOf: (s: Segment) => string
  onResize: (key: string, minThis: number, nextKey: string | null, minNext: number) => void
  onReorder: (level: number, key: string, toIdx: number) => void
  onSelect?: (key: string, originFrac?: number) => void
  onBarBottom?: (px: number) => void
  selectedKey?: string | null
  keyOf: (s: Segment, i: number) => string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const ovRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'resize' | 'reorder'; key: string; level: number } | null>(null)
  const navDrag = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [win, setWin] = useState({ left: 0, width: 100 })

  const lvl = (s: Segment) => s.level ?? 1
  const levelSegs = (L: number) => segments.filter((s) => lvl(s) === L)
  const activeLevels = [1, 2, 3].filter((L) => L === 1 || levelSegs(L).length > 0)
  const sumOf = (L: number) => levelSegs(L).reduce((a, s) => a + (s.durationMin ?? 0), 0)
  const scale = Math.max(totalMin ?? 0, ...activeLevels.map(sumOf), 1)
  const boundaryLabel = (offset: number) => (startMin != null ? minToClock(startMin + offset) : `${offset}′`)

  const syncWin = () => {
    const el = scrollRef.current
    if (!el || el.scrollWidth === 0) return
    setWin({ left: (el.scrollLeft / el.scrollWidth) * 100, width: (el.clientWidth / el.scrollWidth) * 100 })
  }
  useEffect(syncWin, [zoom, segments])
  useLayoutEffect(() => {
    if (barsRef.current && rootRef.current && onBarBottom) {
      onBarBottom(barsRef.current.getBoundingClientRect().bottom - rootRef.current.getBoundingClientRect().top)
    }
  }, [zoom, segments, onBarBottom])

  const cursorMin = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * scale
  }

  const onResizeDown = (key: string, level: number) => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { mode: 'resize', key, level }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onBodyDown = (key: string, level: number, pinned: boolean) => (e: RPointerEvent) => {
    const sc = scrollRef.current
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const frac = sc ? Math.max(0, Math.min(1, (r.left + r.width / 2 - sc.getBoundingClientRect().left) / sc.clientWidth)) : undefined
    onSelect?.(key, frac)
    if (pinned) return
    drag.current = { mode: 'reorder', key, level }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || !trackRef.current) return
    const segs = levelSegs(d.level)
    const idx = segs.findIndex((s, i) => keyOf(s, i) === d.key)
    if (idx < 0) return
    if (d.mode === 'resize') {
      const before = segs.slice(0, idx).reduce((a, s) => a + (s.durationMin ?? 0), 0)
      const next = segs[idx + 1]
      if (next) {
        const pair = (segs[idx].durationMin ?? 0) + (next.durationMin ?? 0)
        const newI = Math.max(1, Math.min(pair - 1, Math.round(cursorMin(e.clientX) - before)))
        onResize(d.key, newI, keyOf(next, idx + 1), pair - newI)
      } else {
        onResize(d.key, Math.max(1, Math.round(cursorMin(e.clientX) - before)), null, 0)
      }
      return
    }
    const cm = cursorMin(e.clientX)
    let acc = 0
    let to = segs.length - 1
    for (let i = 0; i < segs.length; i++) {
      const dur = segs[i].durationMin ?? 0
      if (cm < acc + dur / 2) { to = i; break }
      acc += dur
    }
    if (to !== idx) onReorder(d.level, d.key, to)
  }
  const onUp = () => {
    drag.current = null
  }

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

  if (levelSegs(1).length === 0 && activeLevels.length === 1) {
    return <p className="rounded-lg border border-dashed border-graysage/30 py-4 text-center text-xs text-graysage/60">Agrega actividades para ver la línea de tiempo.</p>
  }

  const renderBar = (L: number, mini: boolean) => {
    const segs = levelSegs(L)
    const h = mini ? (L === 1 ? 'h-3' : 'h-2') : L === 1 ? 'h-16' : 'h-8'
    const sumL = sumOf(L)
    const rem = scale - sumL
    return (
      <div className={`flex ${h} w-full overflow-hidden rounded-lg border border-graysage/20 bg-cream/50 ${L > 1 && !mini ? 'mt-1' : ''}`}>
        {segs.map((s, i) => {
          const w = ((s.durationMin ?? 0) / scale) * 100
          const k = keyOf(s, i)
          return (
            <div
              key={k}
              data-seg={mini ? undefined : ''}
              onPointerDown={mini ? undefined : onBodyDown(k, L, !!s.pinned)}
              onPointerMove={mini ? undefined : onMove}
              onPointerUp={mini ? undefined : onUp}
              style={{ width: `${w}%`, backgroundColor: colorOf(s) }}
              className={`relative flex flex-col justify-center overflow-hidden ${mini ? '' : 'cursor-grab px-1.5 active:cursor-grabbing'} ${!mini && selectedKey === k ? 'ring-2 ring-inset ring-white' : ''}`}
              title={mini ? undefined : `${s.name} · ${s.durationMin ?? 0} min`}
            >
              {!mini && (
                <>
                  <span className="truncate text-[0.7rem] font-medium leading-tight text-white/95">{s.name}</span>
                  {L === 1 && <span className="text-[0.6rem] leading-tight text-white/80">{s.durationMin ?? 0}′{s.pinned ? ' 📌' : ''}</span>}
                  <span onPointerDown={onResizeDown(k, L)} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/15 hover:bg-black/30" title="Arrastra para ajustar la duración" />
                </>
              )}
            </div>
          )
        })}
        {rem > 0 && (
          <div style={{ width: `${(rem / scale) * 100}%` }} className="flex items-center justify-center">
            {!mini && L === 1 && <span className="text-[0.6rem] text-graysage/50">{rem}′</span>}
          </div>
        )}
      </div>
    )
  }

  const offsets1 = (() => { let a = 0; return levelSegs(1).map((s) => { const o = a; a += s.durationMin ?? 0; return o }) })()
  const sum1 = sumOf(1)
  const zoomed = zoom > 1.01

  return (
    <div ref={rootRef} className="select-none">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.65rem] text-graysage">Zoom</span>
        <input type="range" min={1} max={6} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="h-1 flex-1 cursor-pointer accent-sage" />
        <span className="w-8 text-right font-mono text-[0.65rem] text-graysage">{zoom}×</span>
      </div>

      <div ref={scrollRef} onScroll={syncWin} className="overflow-x-auto">
        <div ref={trackRef} style={{ width: `${zoom * 100}%` }} className="touch-none transition-[width] duration-300 ease-out">
          <div ref={barsRef}>
            {activeLevels.map((L) => (
              <div key={L}>{renderBar(L, false)}</div>
            ))}
            {/* horas en cada divisoria (según la línea principal) */}
            <div className="relative mt-1 h-4">
              {offsets1.map((o, i) => (
                <span key={i} style={{ left: `${(o / scale) * 100}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(o)}</span>
              ))}
              <span style={{ left: `${(sum1 / scale) * 100}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(sum1)}</span>
            </div>
          </div>
        </div>
      </div>

      {zoomed && (
        <div ref={ovRef} onPointerDown={onNavDown} onPointerMove={onNavMove} onPointerUp={onNavUp} className="relative mt-1.5 cursor-pointer touch-none">
          {renderBar(1, true)}
          <div style={{ left: `${win.left}%`, width: `${win.width}%` }} className="pointer-events-none absolute top-0 h-3 rounded border-2 border-charcoal/50 bg-charcoal/10 transition-[left,width] duration-150 ease-out" />
        </div>
      )}

      <p className="mt-1 text-[0.65rem] text-graysage/70">
        Nivel 1: {sum1} min{totalMin != null ? ` · servicio ${totalMin} min` : ''}
        {totalMin != null && totalMin - sum1 < 0 ? ` · ⚠ excede ${sum1 - totalMin} min` : ''}
      </p>
    </div>
  )
}
