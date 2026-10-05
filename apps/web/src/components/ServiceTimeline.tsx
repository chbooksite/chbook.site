import { useRef, type PointerEvent as RPointerEvent } from 'react'
import type { Segment } from '../lib/activity'

// Línea de tiempo del servicio: barras proporcionales a la duración, en orden y
// SIN solaparse. El borde derecho de cada barra se arrastra para ajustar minutos.
// Es la misma línea que correrá en vivo en "Servicio en tiempo real".
export default function ServiceTimeline({
  segments,
  totalMin,
  colorOf,
  onDuration,
}: {
  segments: Segment[]
  totalMin: number | null // duración del servicio (inicio→fin), si se conoce
  colorOf: (s: Segment) => string
  onDuration: (index: number, min: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)

  const sum = segments.reduce((a, s) => a + (s.durationMin ?? 0), 0)
  const scale = Math.max(totalMin ?? 0, sum, 1)
  const remaining = totalMin != null ? totalMin - sum : null

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
    const next = Math.max(1, Math.round(minutesAtX - before))
    onDuration(drag.current, next)
  }
  const onPointerUp = () => {
    drag.current = null
  }

  if (segments.length === 0) {
    return <p className="rounded-lg border border-dashed border-graysage/30 py-4 text-center text-xs text-graysage/60">Agrega actividades para ver la línea de tiempo.</p>
  }

  return (
    <div>
      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="flex h-10 w-full touch-none select-none overflow-hidden rounded-lg border border-graysage/20 bg-cream/50"
      >
        {segments.map((s, i) => {
          const w = ((s.durationMin ?? 0) / scale) * 100
          return (
            <div
              key={s.id ?? i}
              style={{ width: `${w}%`, backgroundColor: colorOf(s) }}
              className="relative flex items-center overflow-hidden opacity-80"
              title={`${s.name} · ${s.durationMin ?? 0} min`}
            >
              <span className="truncate px-1.5 text-[0.65rem] font-medium text-white/95">{s.name}</span>
              <span
                onPointerDown={onPointerDown(i)}
                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/15 hover:bg-black/30"
              />
            </div>
          )
        })}
        {remaining != null && remaining > 0 && (
          <div style={{ width: `${(remaining / scale) * 100}%` }} className="flex items-center justify-center" title="Tiempo sin asignar">
            <span className="text-[0.6rem] text-graysage/50">{remaining}′</span>
          </div>
        )}
      </div>
      <p className="mt-1 text-[0.65rem] text-graysage/70">
        Total actividades: {sum} min{totalMin != null ? ` · servicio: ${totalMin} min` : ''}
        {remaining != null && remaining < 0 ? ` · ⚠ excede ${-remaining} min` : ''}
      </p>
    </div>
  )
}
