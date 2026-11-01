import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { DEFAULT_AGE_RANGES, type AgeRangeDef } from '../lib/member'

const MAX = 100
const MAX_CUSTOM = 2
const DEFAULT_COLORS = ['#14b8a6', '#ef4444', '#8b5cf6', '#f97316']
const DEFAULT_KEYS = new Set(DEFAULT_AGE_RANGES.map((r) => r.key))
const isCustom = (r: AgeRangeDef) => !DEFAULT_KEYS.has(r.key)

// Editor visual de rangos de edad: línea de tiempo con pines + leyenda editable.
export default function AgeRangesEditor({
  value,
  onChange,
}: {
  value: AgeRangeDef[]
  onChange: (ranges: AgeRangeDef[]) => void
}) {
  const [ranges, setRanges] = useState<AgeRangeDef[]>(value)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragKey = useRef<string | null>(null)

  useEffect(() => setRanges(value), [value])

  const commit = (next: AgeRangeDef[]) => {
    setRanges(next)
    onChange(next)
  }
  const patch = (key: string, p: Partial<AgeRangeDef>) =>
    commit(ranges.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const enabled = sorted.filter((r) => r.enabled)
  const customCount = ranges.filter(isCustom).length

  const setStartLive = (key: string, start: number) => {
    const s = Math.max(0, Math.min(MAX, Math.round(start)))
    setRanges((prev) => prev.map((r) => (r.key === key ? { ...r, start: s } : r)))
  }

  const onPointerDown = (key: string) => (e: RPointerEvent) => {
    dragKey.current = key
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: RPointerEvent) => {
    if (!dragKey.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const age = ((e.clientX - rect.left) / rect.width) * MAX
    setStartLive(dragKey.current, age)
  }
  const onPointerUp = () => {
    if (dragKey.current) {
      onChange(ranges)
      dragKey.current = null
    }
  }

  const addRange = () => {
    if (customCount >= MAX_CUSTOM) return
    const maxStart = ranges.reduce((m, r) => Math.max(m, r.start), 0)
    const key = `custom_${Date.now()}`
    commit([
      ...ranges,
      {
        key,
        name: 'Nuevo rango',
        color: DEFAULT_COLORS[ranges.length % DEFAULT_COLORS.length],
        start: Math.min(MAX - 1, maxStart + 5),
        enabled: true,
      },
    ])
  }

  return (
    <div>
      {/* Línea de tiempo */}
      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="relative mb-1 h-12 touch-none select-none rounded-lg border border-graysage/20 bg-cream/60"
      >
        {enabled.map((r, i) => {
          const left = (r.start / MAX) * 100
          const nextStart = enabled[i + 1]?.start ?? MAX
          const width = ((nextStart - r.start) / MAX) * 100
          return (
            <div
              key={r.key}
              title={`${r.name}: ${r.start}+`}
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: r.color }}
              className="absolute top-4 h-4 opacity-60"
            />
          )
        })}
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            onPointerDown={onPointerDown(r.key)}
            title={`${r.name}: ${r.start} años`}
            style={{ left: `${(r.start / MAX) * 100}%` }}
            className={`absolute top-0 h-12 w-4 -translate-x-1/2 cursor-ew-resize ${r.enabled ? '' : 'opacity-30'}`}
          >
            <span style={{ backgroundColor: r.color }} className="mx-auto block h-full w-1 rounded-full" />
          </button>
        ))}
      </div>
      <div className="mb-4 flex justify-between text-[0.65rem] text-graysage/60">
        <span>0</span>
        <span>{MAX}+ años</span>
      </div>

      {/* Leyenda / lista editable */}
      <ul className="space-y-2">
        {sorted.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={r.color}
              onChange={(e) => patch(r.key, { color: e.target.value })}
              className="h-7 w-8 cursor-pointer rounded border border-graysage/25"
              title="Color"
            />
            <input
              value={r.name}
              onChange={(e) => patch(r.key, { name: e.target.value })}
              className="min-w-32 flex-1 rounded-lg border border-graysage/25 bg-cream px-2.5 py-1.5 text-sm outline-none focus:border-sage"
            />
            <span className="text-xs text-graysage">desde</span>
            <input
              type="number"
              min={0}
              max={MAX}
              value={r.start}
              onChange={(e) => patch(r.key, { start: Math.max(0, Math.min(MAX, Number(e.target.value))) })}
              className="w-16 rounded-lg border border-graysage/25 bg-cream px-2 py-1.5 text-sm outline-none focus:border-sage"
            />
            <span className="text-xs text-graysage">años</span>
            <button
              type="button"
              role="switch"
              aria-checked={r.enabled}
              onClick={() => patch(r.key, { enabled: !r.enabled })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${r.enabled ? 'bg-sage' : 'bg-graysage/30'}`}
              title={r.enabled ? 'Activo' : 'Inactivo'}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.enabled ? 'left-[1.125rem]' : 'left-0.5'}`} />
            </button>
            {isCustom(r) ? (
              <button
                type="button"
                onClick={() => commit(ranges.filter((x) => x.key !== r.key))}
                className="text-xs text-graysage hover:text-clay"
                title="Eliminar"
              >
                ✕
              </button>
            ) : (
              <span className="w-3" aria-hidden />
            )}
          </li>
        ))}
      </ul>

      {customCount < MAX_CUSTOM ? (
        <button
          type="button"
          onClick={addRange}
          className="mt-3 rounded-lg border border-sage/40 px-3 py-1.5 text-sm text-sage-dark transition hover:bg-sage/10"
        >
          + Agregar rango
        </button>
      ) : (
        <p className="mt-3 text-xs text-graysage/70">
          Máximo {MAX_CUSTOM} rangos personalizados. Desactiva los que no uses en lugar de borrarlos.
        </p>
      )}
    </div>
  )
}
