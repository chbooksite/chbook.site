import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { minToClock, type Segment } from '../lib/activity'

// Resultado de ubicar un punto (x,y) sobre la línea de tiempo: nivel, tiempo
// en minutos (0 = inicio del servicio) y el segmento que esté debajo, si hay.
export interface TimelineHandle {
  hitTest(clientX: number, clientY: number): { level: number; timeMin: number; segmentKey: string | null } | null
}

// Línea de tiempo del servicio sobre un eje de tiempo compartido.
//  · Nivel 1 = principal (secuencial desde el inicio del servicio).
//  · Niveles 2 y 3 = barras paralelas (media altura) con bloques LIBRES: su
//    borde izquierdo mueve el inicio (incluso antes del servicio) y el derecho
//    el fin (incluso después). Se pueden mover y pasar de nivel arrastrando.
const ServiceTimeline = forwardRef<TimelineHandle, {
  segments: Segment[]
  totalMin: number | null
  startMin: number | null
  colorOf: (s: Segment) => string
  onResize: (key: string, minThis: number, nextKey: string | null, minNext: number) => void
  onReorder: (level: number, key: string, toIdx: number) => void
  onPatchSeg: (key: string, patch: { level?: number; startOffset?: number; durationMin?: number }) => void
  onDelete?: (key: string) => void
  onSelect?: (key: string, originFrac?: number) => void
  onBarBottom?: (px: number) => void
  selectedKey?: string | null
  dropActive?: boolean
  dropTarget?: { kind: 'activity' | 'team'; level: number | null; segmentKey: string | null; timeMin: number | null; durationMin?: number | null } | null
  assigneeText?: (s: Segment) => string
  keyOf: (s: Segment, i: number) => string
}>(function ServiceTimeline({
  segments,
  totalMin,
  startMin,
  colorOf,
  onResize,
  onReorder,
  onPatchSeg,
  onDelete,
  onSelect,
  onBarBottom,
  selectedKey,
  dropActive,
  dropTarget,
  assigneeText,
  keyOf,
}, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const ovRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'resize' | 'resizeR' | 'resizeL' | 'body'; key: string; level: number; grab?: number } | null>(null)
  const pending = useRef<{ key: string; level: number; pinned: boolean; x: number; y: number; frac?: number; moved: boolean; pointerId: number } | null>(null)
  const navDrag = useRef(false)
  const overTrash = useRef(false)
  const segEls = useRef(new Map<string, HTMLElement>())
  const levelBarEls = useRef(new Map<number, HTMLElement>())
  const geom = useRef({ t0: 0, span: 1 })
  const prevLefts = useRef(new Map<string, number>())
  const prevOrder = useRef<string[]>([])
  const prevPreview = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [win, setWin] = useState({ left: 0, width: 100 })
  const [dragActive, setDragActive] = useState(false)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [trashing, setTrashing] = useState(false)
  const [overLevel, setOverLevel] = useState<number | null>(null)

  const lvl = (s: Segment) => s.level ?? 1
  const levelSegs = (L: number) => segments.filter((s) => lvl(s) === L)
  const activeLevels = [1, 2, 3].filter((L) => L === 1 || levelSegs(L).length > 0)
  const sumOf = (L: number) => levelSegs(L).reduce((a, s) => a + (s.durationMin ?? 0), 0)
  const sum1 = sumOf(1)

  // Vista previa: al arrastrar una actividad sobre el nivel 1, se abre un HUECO
  // en la posición de inserción para que las demás se deslicen (reusa el FLIP).
  const previewDur = dropTarget?.durationMin ?? 0
  const l1 = levelSegs(1)
  let previewL1Idx: number | null = null
  if (dropTarget?.kind === 'activity' && dropTarget.level === 1 && dropTarget.timeMin != null) {
    let acc = 0
    previewL1Idx = l1.length
    for (let i = 0; i < l1.length; i++) { const dur = l1[i].durationMin ?? 0; if (dropTarget.timeMin < acc + dur / 2) { previewL1Idx = i; break } acc += dur }
  }

  // inicio (min, 0 = inicio del servicio) de cada actividad del nivel 1, con el
  // hueco de la vista previa plegado dentro (fuente única de posiciones).
  const l1Starts = new Map<string, number>()
  let previewGapStart = 0
  {
    let a = 0
    l1.forEach((s, i) => { if (previewL1Idx === i) { previewGapStart = a; a += previewDur } l1Starts.set(keyOf(s, i), a); a += s.durationMin ?? 0 })
    if (previewL1Idx === l1.length) previewGapStart = a
  }

  const parallel = [...levelSegs(2), ...levelSegs(3)]
  const t0 = Math.min(0, ...parallel.map((s) => s.startOffset ?? 0))
  const t1 = Math.max(totalMin ?? 0, sum1 + (previewL1Idx != null ? previewDur : 0), ...parallel.map((s) => (s.startOffset ?? 0) + (s.durationMin ?? 0)))
  const span = Math.max(t1 - t0, 1)
  const xPct = (t: number) => ((t - t0) / span) * 100
  const boundaryLabel = (offset: number) => (startMin != null ? minToClock(startMin + offset) : `${offset}′`)
  const segStart = (s: Segment, k: string) => (lvl(s) === 1 ? l1Starts.get(k) ?? 0 : s.startOffset ?? 0)

  // Geometría actual para hit-testing externo (arrastrar chips a la barra).
  geom.current = { t0, span }
  useImperativeHandle(ref, (): TimelineHandle => ({
    hitTest(clientX, clientY) {
      let level: number | null = null
      for (const [L, el] of levelBarEls.current) {
        const r = el.getBoundingClientRect()
        if (clientY >= r.top - 6 && clientY <= r.bottom + 6) { level = L; break }
      }
      if (level == null || !trackRef.current) return null
      const rect = trackRef.current.getBoundingClientRect()
      const timeMin = geom.current.t0 + ((clientX - rect.left) / rect.width) * geom.current.span
      let segmentKey: string | null = null
      for (const [k, el] of segEls.current) {
        const r = el.getBoundingClientRect()
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) { segmentKey = k; break }
      }
      return { level, timeMin, segmentKey }
    },
  }))

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

  // FLIP: cuando cambia el ORDEN del nivel 1, las actividades se deslizan.
  useLayoutEffect(() => {
    const order = segments.map((s, i) => keyOf(s, i))
    const changed =
      order.length !== prevOrder.current.length ||
      order.some((k, i) => k !== prevOrder.current[i]) ||
      prevPreview.current !== previewL1Idx
    prevPreview.current = previewL1Idx
    const els = segEls.current
    if (changed) {
      els.forEach((el, k) => {
        if (k === draggingKey) return
        const prev = prevLefts.current.get(k)
        if (prev == null) return
        const dx = prev - el.getBoundingClientRect().left
        if (Math.abs(dx) < 1) return
        el.style.transition = 'none'
        el.style.transform = `translateX(${dx}px)`
        void el.offsetWidth
        requestAnimationFrame(() => { el.style.transition = 'transform 360ms ease'; el.style.transform = '' })
      })
    }
    const lefts = new Map<string, number>()
    els.forEach((el, k) => lefts.set(k, el.getBoundingClientRect().left))
    prevLefts.current = lefts
    prevOrder.current = order
  })

  const cursorTime = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return t0 + ((clientX - rect.left) / rect.width) * span
  }

  const onLeftDown = (key: string, level: number) => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { mode: 'resizeL', key, level }
    rootRef.current?.setPointerCapture(e.pointerId)
  }
  const onRightDown = (key: string, level: number) => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { mode: level === 1 ? 'resize' : 'resizeR', key, level }
    rootRef.current?.setPointerCapture(e.pointerId)
  }
  const onBodyDown = (key: string, level: number, pinned: boolean) => (e: RPointerEvent) => {
    const sc = scrollRef.current
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const frac = sc ? Math.max(0, Math.min(1, (r.left + r.width / 2 - sc.getBoundingClientRect().left) / sc.clientWidth)) : undefined
    // Sin captura aún: así un clic simple llega a la etiqueta (abre la tarjeta).
    // La captura se toma solo cuando empieza un arrastre real (en onMove).
    pending.current = { key, level, pinned, x: e.clientX, y: e.clientY, frac, moved: false, pointerId: e.pointerId }
  }

  const onMove = (e: RPointerEvent) => {
    const p = pending.current
    if (p && !p.moved) {
      if (Math.abs(e.clientX - p.x) < 4 && Math.abs(e.clientY - p.y) < 4) return
      p.moved = true
      if (!p.pinned) {
        const seg = segments.find((s, i) => keyOf(s, i) === p.key)
        const startAtDown = p.level === 1 ? l1Starts.get(p.key) ?? 0 : seg?.startOffset ?? 0
        drag.current = { mode: 'body', key: p.key, level: p.level, grab: cursorTime(p.x) - startAtDown }
        rootRef.current?.setPointerCapture(p.pointerId)
        setDragActive(true)
        setDraggingKey(p.key)
      }
    }
    const d = drag.current
    if (!d || !trackRef.current) return
    const seg = segments.find((s, i) => keyOf(s, i) === d.key)
    if (!seg) return
    const ct = cursorTime(e.clientX)

    if (d.mode === 'resizeL') {
      const start = seg.startOffset ?? 0
      const end = start + (seg.durationMin ?? 0)
      const ns = Math.min(end - 1, Math.round(ct))
      onPatchSeg(d.key, { startOffset: ns, durationMin: end - ns })
      return
    }
    if (d.mode === 'resizeR') {
      onPatchSeg(d.key, { durationMin: Math.max(1, Math.round(ct - (seg.startOffset ?? 0))) })
      return
    }
    if (d.mode === 'resize') {
      const segs = levelSegs(1)
      const idx = segs.findIndex((s, i) => keyOf(s, i) === d.key)
      if (idx < 0) return
      const before = segs.slice(0, idx).reduce((a, s) => a + (s.durationMin ?? 0), 0)
      const next = segs[idx + 1]
      if (next) {
        const pair = (segs[idx].durationMin ?? 0) + (next.durationMin ?? 0)
        const newI = Math.max(1, Math.min(pair - 1, Math.round(ct - before)))
        onResize(d.key, newI, keyOf(next, idx + 1), pair - newI)
      } else {
        onResize(d.key, Math.max(1, Math.round(ct - before)), null, 0)
      }
      return
    }

    // body: mover / reordenar / cambiar de nivel / eliminar
    setGhost({ x: e.clientX, y: e.clientY })
    if (e.clientY > window.innerHeight - 90) { overTrash.current = true; setTrashing(true); return }
    overTrash.current = false
    setTrashing(false)
    let targetLevel = d.level
    for (const [L, el] of levelBarEls.current) {
      const r = el.getBoundingClientRect()
      if (e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) { targetLevel = L; break }
    }
    d.level = targetLevel
    setOverLevel(targetLevel)
    if (targetLevel === 1) {
      const others = levelSegs(1).filter((s, i) => keyOf(s, i) !== d.key)
      let acc = 0
      let ins = others.length
      for (let i = 0; i < others.length; i++) {
        const dur = others[i].durationMin ?? 0
        if (ct < acc + dur / 2) { ins = i; break }
        acc += dur
      }
      onReorder(1, d.key, ins)
    } else {
      onPatchSeg(d.key, { level: targetLevel, startOffset: Math.round(ct - (d.grab ?? 0)) })
    }
  }

  const onUp = () => {
    const d = drag.current
    const p = pending.current
    if (d?.mode === 'body' && overTrash.current) onDelete?.(d.key)
    else if (p && !p.moved) onSelect?.(p.key, p.frac)
    pending.current = null
    drag.current = null
    overTrash.current = false
    setDragActive(false)
    setDraggingKey(null)
    setGhost(null)
    setTrashing(false)
    setOverLevel(null)
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
    return (
      <div className={`relative ${h} w-full overflow-hidden rounded-lg border border-graysage/20 bg-cream/50 ${L > 1 && !mini ? 'mt-3' : ''}`}>
        {segs.map((s, i) => {
          const k = keyOf(s, i)
          const left = xPct(segStart(s, k))
          const w = ((s.durationMin ?? 0) / span) * 100
          return (
            <div
              key={k}
              ref={mini ? undefined : (el) => { const m = segEls.current; if (el) m.set(k, el); else m.delete(k) }}
              data-seg={mini ? undefined : ''}
              onPointerDown={mini ? undefined : onBodyDown(k, L, !!s.pinned)}
              style={{ left: `${left}%`, width: `${w}%`, backgroundColor: colorOf(s) }}
              className={`absolute top-0 flex h-full flex-col justify-center overflow-hidden ${mini ? '' : 'cursor-grab px-1.5 transition hover:brightness-110 active:cursor-grabbing'} ${!mini && selectedKey === k ? 'ring-2 ring-inset ring-white' : ''} ${draggingKey === k ? 'opacity-50 ring-2 ring-inset ring-charcoal/40' : ''} ${!mini && dropTarget?.kind === 'team' && dropTarget.segmentKey === k ? 'z-10 ring-4 ring-inset ring-white brightness-110' : ''}`}
              title={mini ? undefined : `${s.name} · ${s.durationMin ?? 0} min`}
            >
              {!mini && (
                <>
                  {L > 1 && <span onPointerDown={onLeftDown(k, L)} className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-black/15 hover:bg-black/30" title="Inicio" />}
                  <span className="truncate text-[0.7rem] font-medium leading-tight text-white/95">{s.name}</span>
                  {L === 1 && <span className="text-[0.6rem] leading-tight text-white/80">{s.durationMin ?? 0}′{s.pinned ? ' 📌' : ''}</span>}
                  {assigneeText && assigneeText(s) && (
                    <span className="mt-0.5 max-w-full truncate rounded bg-black/25 px-1 text-[0.55rem] leading-tight text-white/90" title={assigneeText(s)}>👥 {assigneeText(s)}</span>
                  )}
                  <span onPointerDown={onRightDown(k, L)} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/15 hover:bg-black/30" title={L === 1 ? 'Duración' : 'Fin'} />
                </>
              )}
            </div>
          )
        })}
        {!mini && dropTarget?.kind === 'activity' && dropTarget.level === L && (
          <span
            style={L === 1 ? { left: `${xPct(previewGapStart)}%`, width: `${(previewDur / span) * 100}%` } : { left: `${xPct(dropTarget.timeMin ?? 0)}%`, width: `${(previewDur / span) * 100}%` }}
            className="pointer-events-none absolute top-0 h-full rounded border-2 border-dashed border-sage-dark/70 bg-sage/20 transition-[left] duration-300 ease-out"
          />
        )}
      </div>
    )
  }

  const zoomed = zoom > 1.01

  return (
    <div ref={rootRef} onPointerMove={onMove} onPointerUp={onUp} className="select-none">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.65rem] text-graysage">Zoom</span>
        <input type="range" min={1} max={6} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="h-1 flex-1 cursor-pointer accent-sage" />
        <span className="w-8 text-right font-mono text-[0.65rem] text-graysage">{zoom}×</span>
      </div>

      <div ref={scrollRef} onScroll={syncWin} className="overflow-x-auto">
        <div ref={trackRef} style={{ width: `${zoom * 100}%` }} className="touch-none transition-[width] duration-300 ease-out">
          <div ref={barsRef}>
            {activeLevels.map((L) => (
              <div
                key={L}
                ref={(el) => { const m = levelBarEls.current; if (el) m.set(L, el); else m.delete(L) }}
                className={`rounded-lg transition ${(dragActive && overLevel === L) || (dropTarget?.kind === 'activity' && dropTarget.level === L) ? 'ring-2 ring-sage/60' : ''}`}
              >
                {renderBar(L, false)}
              </div>
            ))}
            {(dragActive || dropActive) &&
              [2, 3].filter((L) => !activeLevels.includes(L)).map((L) => (
                <div
                  key={`ph-${L}`}
                  ref={(el) => { const m = levelBarEls.current; if (el) m.set(L, el); else m.delete(L) }}
                  className={`mt-3 flex h-8 w-full items-center justify-center rounded-lg border border-dashed transition ${overLevel === L || (dropTarget?.kind === 'activity' && dropTarget.level === L) ? 'border-sage bg-sage/10 text-sage-dark' : 'border-graysage/30 text-graysage/50'}`}
                >
                  <span className="text-[0.65rem]">Soltar aquí → Nivel {L}</span>
                </div>
              ))}
            {/* horas en cada divisoria (según la línea principal) */}
            <div className="relative mt-1 h-4">
              {levelSegs(1).map((s, i) => {
                const k = keyOf(s, i)
                return <span key={k} style={{ left: `${xPct(l1Starts.get(k) ?? 0)}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(l1Starts.get(k) ?? 0)}</span>
              })}
              <span style={{ left: `${xPct(sum1)}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(sum1)}</span>
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

      {ghost && draggingKey && (() => {
        const s = segments.find((x, i) => keyOf(x, i) === draggingKey)
        if (!s) return null
        return (
          <div style={{ left: ghost.x, top: ghost.y, backgroundColor: colorOf(s) }} className="pointer-events-none fixed z-[70] max-w-[40vw] -translate-x-1/2 -translate-y-1/2 truncate rounded-lg px-2.5 py-1 text-xs font-medium text-white opacity-50 shadow-lg">
            {s.name}
          </div>
        )
      })()}

      <div className={`pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center text-sm font-medium transition-all duration-200 ease-out ${dragActive ? 'h-16 translate-y-0 opacity-100' : 'h-16 translate-y-full opacity-0'} ${trashing ? 'bg-clay/90 text-cream shadow-lg' : 'bg-charcoal/70 text-cream/80'}`}>
        <span className={`transition-transform ${trashing ? 'scale-110' : ''}`}>🗑 {trashing ? 'Suelta para eliminar' : 'Arrastra aquí para eliminar'}</span>
      </div>
    </div>
  )
})

export default ServiceTimeline
