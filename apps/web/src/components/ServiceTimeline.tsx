import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { minToClock, type Segment } from '../lib/activity'

// Suaviza un color del usuario hacia un tono pastel (mezcla con blanco).
function soft(hex: string, mix = 0.6): string {
  const h = (hex || '#94a3b8').replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const m = (c: number) => Math.round(c * (1 - mix) + 255 * mix)
  return `rgb(${m(parseInt(n.slice(0, 2), 16) || 0)}, ${m(parseInt(n.slice(2, 4), 16) || 0)}, ${m(parseInt(n.slice(4, 6), 16) || 0)})`
}

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
  onSelect?: (key: string, originRect?: { left: number; top: number; width: number; height: number }) => void
  onBarBottom?: (px: number) => void
  openKeys?: string[]
  dropActive?: boolean
  dropTarget?: { kind: 'activity' | 'team'; level: number | null; segmentKey: string | null; timeMin: number | null; durationMin?: number | null } | null
  assigneeText?: (s: Segment) => string
  assigneeColors?: (s: Segment) => string[]
  toolbarLeft?: ReactNode
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
  openKeys,
  dropActive,
  dropTarget,
  assigneeText,
  assigneeColors,
  toolbarLeft,
  keyOf,
}, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'resize' | 'resizeR' | 'resizeL' | 'body'; key: string; level: number; grab?: number; gx?: number; gw?: number; gspan?: number } | null>(null)
  const pending = useRef<{ key: string; level: number; pinned: boolean; x: number; y: number; rect: { left: number; top: number; width: number; height: number }; moved: boolean; pointerId: number } | null>(null)
  const overTrash = useRef(false)
  const segEls = useRef(new Map<string, HTMLElement>())
  const levelBarEls = useRef(new Map<number, HTMLElement>())
  const geom = useRef({ t0: 0, span: 1 })
  const prevLefts = useRef(new Map<string, number>())
  const prevOrder = useRef<string[]>([])
  const prevPreview = useRef<number | null>(null)
  const [equalize, setEqualize] = useState(false) // ver todas las actividades del mismo tamaño
  const [resizeTip, setResizeTip] = useState<{ x: number; y: number; text: string } | null>(null) // hora al arrastrar bordes
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

  // El eje se basa SIEMPRE en la línea principal (nivel 1): su duración total define
  // el rango de tiempo. Los niveles 2 y 3 se normalizan a ESE mismo rango (misma
  // escala), así quedan alineados bajo la línea principal y la línea llena el recuadro.
  const t0 = 0
  // El eje representa la VENTANA DEL SERVICIO (duración real inicio→fin) para que la
  // regla muestre las horas de reloj correctas. Si los segmentos suman menos, queda
  // tiempo libre al final; si suman más, el excedente se ve más allá del fin.
  const windowMin = totalMin != null && totalMin > 0 ? totalMin : sum1
  const t1 = Math.max(windowMin, sum1 + (previewL1Idx != null ? previewDur : 0), 1)
  const span = Math.max(t1 - t0, 1)
  const xPct = (t: number) => ((t - t0) / span) * 100
  const boundaryLabel = (offset: number) => (startMin != null ? minToClock(startMin + offset) : `${offset}′`)
  const segStart = (s: Segment, k: string) => (lvl(s) === 1 ? l1Starts.get(k) ?? 0 : Math.max(0, s.startOffset ?? 0))

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

  useLayoutEffect(() => {
    if (barsRef.current && rootRef.current && onBarBottom) {
      onBarBottom(barsRef.current.getBoundingClientRect().bottom - rootRef.current.getBoundingClientRect().top)
    }
  }, [segments, onBarBottom])

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

  // Geometría del eje (rect + span) para traducir píxeles a minutos. Al arrastrar se
  // CONGELA en drag.current para no entrar en bucle cuando el propio arrastre cambia
  // el span (p. ej. estirar la última actividad del nivel 1 cambia sum1).
  const freezeGeom = () => { const r = trackRef.current!.getBoundingClientRect(); return { gx: r.left, gw: r.width, gspan: span } }
  const cursorTime = (clientX: number) => {
    const d = drag.current
    const r = trackRef.current!.getBoundingClientRect()
    const left = d?.gx ?? r.left
    const width = d?.gw ?? r.width
    const sp = d?.gspan ?? span
    return t0 + ((clientX - left) / width) * sp
  }

  const onLeftDown = (key: string, level: number) => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { mode: 'resizeL', key, level, ...freezeGeom() }
    rootRef.current?.setPointerCapture(e.pointerId)
  }
  const onRightDown = (key: string, level: number) => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = { mode: level === 1 ? 'resize' : 'resizeR', key, level, ...freezeGeom() }
    rootRef.current?.setPointerCapture(e.pointerId)
  }
  const onBodyDown = (key: string, level: number, pinned: boolean) => (e: RPointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const rect = { left: r.left, top: r.top, width: r.width, height: r.height }
    // Sin captura aún: así un clic simple llega a la etiqueta (abre la tarjeta).
    // La captura se toma solo cuando empieza un arrastre real (en onMove).
    pending.current = { key, level, pinned, x: e.clientX, y: e.clientY, rect, moved: false, pointerId: e.pointerId }
  }

  const onMove = (e: RPointerEvent) => {
    const p = pending.current
    if (p && !p.moved) {
      if (Math.abs(e.clientX - p.x) < 4 && Math.abs(e.clientY - p.y) < 4) return
      p.moved = true
      if (!p.pinned) {
        const seg = segments.find((s, i) => keyOf(s, i) === p.key)
        const startAtDown = p.level === 1 ? l1Starts.get(p.key) ?? 0 : seg?.startOffset ?? 0
        const g = freezeGeom()
        const grab = t0 + ((p.x - g.gx) / g.gw) * g.gspan - startAtDown
        drag.current = { mode: 'body', key: p.key, level: p.level, grab, ...g }
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
      const ns = Math.max(0, Math.min(end - 1, Math.round(ct))) // no antes del inicio (0)
      onPatchSeg(d.key, { startOffset: ns, durationMin: end - ns })
      setResizeTip({ x: e.clientX, y: e.clientY, text: boundaryLabel(ns) })
      return
    }
    if (d.mode === 'resizeR') {
      const start = seg.startOffset ?? 0
      let dur = Math.max(1, Math.round(ct - start))
      dur = Math.min(dur, Math.max(1, sum1 - start)) // no pasar del fin de la línea principal
      onPatchSeg(d.key, { durationMin: dur })
      setResizeTip({ x: e.clientX, y: e.clientY, text: boundaryLabel(start + dur) })
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
        setResizeTip({ x: e.clientX, y: e.clientY, text: boundaryLabel(before + newI) })
      } else {
        let dur = Math.max(1, Math.round(ct - before))
        if (totalMin != null) dur = Math.min(dur, Math.max(1, totalMin - before)) // no pasar del fin
        onResize(d.key, dur, null, 0)
        setResizeTip({ x: e.clientX, y: e.clientY, text: boundaryLabel(before + dur) })
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
      let ns = Math.max(0, Math.round(ct - (d.grab ?? 0))) // no antes del inicio (0)
      ns = Math.min(ns, Math.max(0, sum1 - (seg.durationMin ?? 0))) // no después del fin de la línea principal
      onPatchSeg(d.key, { level: targetLevel, startOffset: ns })
    }
  }

  const onUp = () => {
    const d = drag.current
    const p = pending.current
    if (d?.mode === 'body' && overTrash.current) onDelete?.(d.key)
    else if (p && !p.moved) onSelect?.(p.key, p.rect)
    pending.current = null
    drag.current = null
    overTrash.current = false
    setDragActive(false)
    setDraggingKey(null)
    setGhost(null)
    setTrashing(false)
    setOverLevel(null)
    setResizeTip(null)
  }

  // NB: cuando la línea está VACÍA ya NO se retorna temprano un <p>: hay que
  // renderizar la barra real (trackRef + levelBarEls) para que el hit-test
  // funcione y se puedan SOLTAR actividades del catálogo sobre la barra vacía.
  // El estado vacío se muestra como una pista dentro de la propia barra.

  // Tiempo (min, 0 = inicio del servicio) → posición %. En modo normal es lineal.
  // En reparto equitativo, se mapea a la posición EQUITATIVA de la línea principal:
  // el instante t cae en la actividad de nivel 1 que lo contiene y se desfasa
  // proporcionalmente dentro de ella, para no perder el orden de los simultáneos.
  const timeToXpct = (t: number): number => {
    if (!equalize) return ((t - t0) / span) * 100
    const n = Math.max(1, l1.length)
    for (let i = 0; i < l1.length; i++) {
      const s0 = l1Starts.get(keyOf(l1[i], i)) ?? 0
      const d = l1[i].durationMin ?? 0
      if (t <= s0) return (i / n) * 100
      if (t < s0 + d) return ((i + (d > 0 ? (t - s0) / d : 0)) / n) * 100
    }
    return 100
  }

  const renderBar = (L: number, mini: boolean) => {
    const segs = levelSegs(L)
    const h = mini ? (L === 1 ? 'h-3' : 'h-2') : L === 1 ? 'h-11' : 'h-8'
    return (
      <div className={`relative ${h} w-full overflow-hidden rounded-lg ${mini ? 'border border-graysage/20 bg-cream/50' : ''} ${L > 1 && !mini ? 'mt-2' : ''}`}>
        {segs.map((s, i) => {
          const k = keyOf(s, i)
          const n1 = Math.max(1, segs.length)
          const eq = equalize && L === 1 // nivel 1: tamaño igual repartido en el espacio
          const segS = segStart(s, k)
          const segE = segS + (s.durationMin ?? 0)
          // nivel 1 en equitativo: ancho fijo; niveles 2/3: normalizados al rango equitativo del nivel 1
          const left = eq ? (i / n1) * 100 : timeToXpct(segS)
          const w = eq ? (1 / n1) * 100 : Math.max(0, timeToXpct(segE) - timeToXpct(segS))
          return (
            <div
              key={k}
              ref={mini ? undefined : (el) => { const m = segEls.current; if (el) m.set(k, el); else m.delete(k) }}
              data-seg={mini ? undefined : ''}
              onPointerDown={mini ? undefined : onBodyDown(k, L, !!s.pinned)}
              style={{ left: `${left}%`, width: mini ? `${w}%` : `calc(${w}% - 2px)`, backgroundColor: mini ? colorOf(s) : soft(colorOf(s), 0.65) }}
              className={`absolute top-0 flex h-full flex-col items-center justify-center overflow-hidden text-center ${mini ? '' : 'cursor-grab rounded-md px-1 shadow-sm transition hover:brightness-95 active:cursor-grabbing'} ${!mini && openKeys?.includes(k) ? 'ring-2 ring-inset ring-sage-dark' : ''} ${draggingKey === k ? 'opacity-50 ring-2 ring-inset ring-charcoal/40' : ''} ${!mini && dropTarget?.kind === 'team' && dropTarget.segmentKey === k ? 'z-10 ring-2 ring-inset ring-sage-dark brightness-95' : ''}`}
              title={mini ? undefined : `${s.name} · ${s.durationMin ?? 0} min`}
            >
              {!mini && (
                <>
                  {L > 1 && <span onPointerDown={onLeftDown(k, L)} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-charcoal/10 hover:bg-charcoal/25" title="Inicio" />}
                  <span className="w-full truncate text-[0.7rem] font-medium leading-tight text-charcoal">{s.name}</span>
                  <span className="text-[0.56rem] leading-tight text-graysage">{s.durationMin ?? 0}′{s.pinned ? ' 📌' : ''}</span>
                  {/* participantes: puntos de color pegados al borde derecho */}
                  {assigneeColors && assigneeColors(s).length > 0 && (
                    <span className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.5" title={assigneeText ? assigneeText(s) : undefined}>
                      {assigneeColors(s).map((c, di) => <span key={di} className="h-1.5 w-1.5 rounded-full ring-1 ring-white/70" style={{ backgroundColor: c }} />)}
                    </span>
                  )}
                  {!eq && !(L === 1 && i === segs.length - 1) && <span onPointerDown={onRightDown(k, L)} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-charcoal/10 hover:bg-charcoal/25" title={L === 1 ? 'Duración' : 'Fin'} />}
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
        {!mini && L === 1 && segs.length === 0 && (
          <span className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-dashed px-2 text-center text-[0.66rem] transition ${dropTarget?.kind === 'activity' ? 'border-sage bg-sage/10 text-sage-dark' : 'border-graysage/35 text-graysage/70'}`}>
            Arrastra actividades del catálogo aquí para armar el servicio
          </span>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} onPointerMove={onMove} onPointerUp={onUp} className="select-none">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {toolbarLeft}
        <button type="button" onClick={() => setEqualize((v) => !v)} aria-pressed={equalize} className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.7rem] transition ${equalize ? 'border-sage bg-sage-light text-sage-dark' : 'border-graysage/30 text-graysage hover:bg-cream'}`} title="Ajustar: repartir las actividades del mismo tamaño">
          <span className={`h-2 w-2 rounded-full ${equalize ? 'bg-sage-dark' : 'bg-graysage/40'}`} />Ajustar
        </button>
      </div>

      <div ref={scrollRef}>
        <div ref={trackRef} className="w-full touch-none">
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
              {/* sin segmentos: muestra al menos la hora de inicio a la izquierda */}
              {l1.length === 0 && <span style={{ left: '0%' }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(0)}</span>}
              {levelSegs(1).map((s, i) => {
                const k = keyOf(s, i)
                const n = Math.max(1, levelSegs(1).length)
                const leftP = equalize ? (i / n) * 100 : xPct(l1Starts.get(k) ?? 0)
                return <span key={k} style={{ left: `${leftP}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(l1Starts.get(k) ?? 0)}</span>
              })}
              {/* FIN DEL SERVICIO: etiqueta en la hora real de fin (ventana), no en
                  la suma de segmentos; así la regla coincide con el horario real. */}
              <span style={{ left: `${equalize ? 100 : xPct(windowMin)}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] font-medium text-sage-dark">{boundaryLabel(windowMin)}</span>
              {/* si los segmentos no llenan la ventana, marca dónde acaba el servicio */}
              {!equalize && sum1 < windowMin && <span style={{ left: `${xPct(windowMin)}%` }} className="pointer-events-none absolute -top-1 h-5 w-px -translate-x-1/2 bg-sage-dark/40" />}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-1 text-[0.65rem] text-graysage/70">
        Nivel 1: {sum1} min{totalMin != null ? ` · servicio ${totalMin} min` : ''}
        {totalMin != null && totalMin - sum1 < 0 ? ` · ⚠ excede ${sum1 - totalMin} min` : ''}
      </p>

      {resizeTip && (
        <div style={{ left: resizeTip.x, top: resizeTip.y - 26 }} className="pointer-events-none fixed z-[70] -translate-x-1/2 rounded bg-charcoal px-1.5 py-0.5 font-mono text-[0.62rem] font-medium text-cream shadow-lg">
          {resizeTip.text}
        </div>
      )}

      {ghost && draggingKey && (() => {
        const s = segments.find((x, i) => keyOf(x, i) === draggingKey)
        if (!s) return null
        return (
          <div style={{ left: ghost.x, top: ghost.y, backgroundColor: soft(colorOf(s), 0.6) }} className="pointer-events-none fixed z-[70] max-w-[40vw] -translate-x-1/2 -translate-y-1/2 truncate rounded-md px-2.5 py-1 text-xs font-medium text-charcoal opacity-70 shadow-lg">
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
