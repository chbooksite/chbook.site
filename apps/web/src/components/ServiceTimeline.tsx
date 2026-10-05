import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { minToClock, type Segment } from '../lib/activity'

// Línea de tiempo HORIZONTAL del servicio: barras proporcionales a la duración,
// en orden y sin solaparse. Se arrastra el borde derecho de cada barra para
// ajustar sus minutos. Debajo: hora de reloj en cada divisoria y la duración de
// cada actividad. Es la misma línea que correrá en vivo.
export default function ServiceTimeline({
  segments,
  totalMin,
  startMin,
  colorOf,
  onDuration,
  onSelect,
  selectedKey,
  keyOf,
}: {
  segments: Segment[]
  totalMin: number | null
  startMin: number | null
  colorOf: (s: Segment) => string
  onDuration: (index: number, min: number) => void
  onSelect?: (index: number) => void
  selectedKey?: string | null
  keyOf?: (s: Segment, i: number) => string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)

  const sum = segments.reduce((a, s) => a + (s.durationMin ?? 0), 0)
  const scale = Math.max(totalMin ?? 0, sum, 1)
  const remaining = totalMin != null ? totalMin - sum : null

  const boundaryLabel = (offset: number) => (startMin != null ? minToClock(startMin + offset) : `${offset}′`)

  const onPointerDown = (i: number) => (e: RPointerEvent) => {
    drag.current = i
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.stopPropagation()
  }
  const onPointerMove = (e: RPointerEvent) => {
    if (drag.current == null || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const before = segments.slice(0, drag.current).reduce((a, s) => a + (s.durationMin ?? 0), 0)
    const minutesAtX = ((e.clientX - rect.left) / rect.width) * scale
    onDuration(drag.current, Math.max(1, Math.round(minutesAtX - before)))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  if (segments.length === 0) {
    return <p className="rounded-lg border border-dashed border-graysage/30 py-4 text-center text-xs text-graysage/60">Agrega actividades para ver la línea de tiempo.</p>
  }

  // offsets acumulados (inicio de cada barra) + el final
  let acc = 0
  const offsets = segments.map((s) => { const o = acc; acc += s.durationMin ?? 0; return o })

  return (
    <div className="select-none">
      {/* barra */}
      <div ref={trackRef} className="flex h-16 w-full touch-none overflow-hidden rounded-lg border border-graysage/20 bg-cream/50">
        {segments.map((s, i) => {
          const w = ((s.durationMin ?? 0) / scale) * 100
          const k = keyOf ? keyOf(s, i) : String(i)
          return (
            <div
              key={k}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={() => onSelect?.(i)}
              style={{ width: `${w}%`, backgroundColor: colorOf(s) }}
              className={`relative flex cursor-pointer flex-col justify-center overflow-hidden px-1.5 transition ${selectedKey && selectedKey === k ? 'ring-2 ring-inset ring-white' : ''}`}
              title={`${s.name} · ${s.durationMin ?? 0} min`}
            >
              <span className="truncate text-[0.7rem] font-medium leading-tight text-white/95">{s.name}</span>
              <span className="text-[0.6rem] leading-tight text-white/80">{s.durationMin ?? 0}′{s.pinned ? ' 📌' : ''}</span>
              <span onPointerDown={onPointerDown(i)} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/15 hover:bg-black/30" title="Arrastra para ajustar la duración" />
            </div>
          )
        })}
        {remaining != null && remaining > 0 && (
          <div style={{ width: `${(remaining / scale) * 100}%` }} className="flex items-center justify-center" title="Tiempo sin asignar">
            <span className="text-[0.6rem] text-graysage/50">{remaining}′</span>
          </div>
        )}
      </div>

      {/* horas en cada divisoria */}
      <div className="relative mt-1 h-4">
        {offsets.map((o, i) => (
          <span key={i} style={{ left: `${(o / scale) * 100}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(o)}</span>
        ))}
        <span style={{ left: `${(sum / scale) * 100}%` }} className="absolute -translate-x-1/2 font-mono text-[0.6rem] text-graysage">{boundaryLabel(sum)}</span>
      </div>

      <p className="mt-0.5 text-[0.65rem] text-graysage/70">
        Total: {sum} min{totalMin != null ? ` · servicio ${totalMin} min` : ''}
        {remaining != null && remaining < 0 ? ` · ⚠ excede ${-remaining} min` : ''}
      </p>
    </div>
  )
}
