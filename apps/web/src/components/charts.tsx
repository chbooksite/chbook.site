import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SERIES } from '../lib/ui'

// Gráficos del Dashboard en SVG/HTML propio (sin librería). Paleta oficial:
// sage oscuro = serie principal, vela (bronce) = segunda serie. El par pasa la
// separación para daltonismo; el bronce tiene poco contraste con el fondo, así
// que siempre va con leyenda, etiquetas y tooltip (ver docs/DISENO.md).
const GRID = 'rgba(30, 42, 36, 0.08)'
const NUM = new Intl.NumberFormat('es')

// Tope "redondo" del eje: 0 / 5 / 10 / 20 / 25 / 50 / 100…
function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow
  return 10 * pow
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export function Legend({ items }: { items: { color: string; label: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-graysage">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
          {it.value && <span className="font-semibold text-charcoal">{it.value}</span>}
        </li>
      ))}
    </ul>
  )
}

// Tooltip sobre el gráfico; en los bordes se ancla al lado para no salirse.
function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const edge = x < 90 ? 'left' : x > width - 90 ? 'right' : 'center'
  return (
    <div
      className={`pointer-events-none absolute top-0 z-10 -translate-y-full whitespace-nowrap rounded-xl bg-charcoal/90 px-3 py-2 text-xs text-paper shadow-lg backdrop-blur ${edge === 'center' ? '-translate-x-1/2' : ''}`}
      style={edge === 'left' ? { left: 0 } : edge === 'right' ? { right: 0 } : { left: x }}
      role="status"
    >
      {children}
    </div>
  )
}

// ── Asistencia por culto: columnas apiladas presencial + en línea ────────

export interface ServicePoint {
  id: string
  label: string // fecha corta
  name: string
  presential: number
  online: number
  capacity: number | null
}

export function AttendanceColumns({ data, height = 250 }: { data: ServicePoint[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...data.map((d) => d.presential + d.online)))
  const ticks = [0, max / 2, max]
  const axisW = 28
  const plotW = Math.max(0, width - axisW)
  const slot = data.length ? plotW / data.length : 0
  const barW = Math.min(24, slot * 0.6)
  const y = (v: number) => height - (v / max) * height
  const last = data.length - 1
  const best = data.reduce((b, d, i) => (d.presential + d.online > data[b].presential + data[b].online ? i : b), 0)
  const avg = data.reduce((s, d) => s + d.presential + d.online, 0) / (data.length || 1)

  return (
    <div ref={ref} className="relative pt-8" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height + 22} className="overflow-visible" role="img" aria-label="Asistencia de los últimos cultos">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={axisW} x2={width} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={axisW - 8} y={y(t) + 4} textAnchor="end" className="fill-graysage text-[11px]">{NUM.format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = axisW + slot * i + slot / 2
            const total = d.presential + d.online
            const hP = (d.presential / max) * height
            const hO = (d.online / max) * height
            const gap = d.presential > 0 && d.online > 0 ? 2 : 0
            const dim = hover != null && hover !== i
            return (
              <g key={d.id} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity .15s' }}>
                {/* presencial desde la base; recto abajo, redondeado arriba si es el último tramo */}
                {hP > 0 && <path d={colPath(cx - barW / 2, height, barW, hP, d.online === 0)} style={{ fill: SERIES.main }} />}
                {hO > 0 && <path d={colPath(cx - barW / 2, height - hP - gap, barW, Math.max(0, hO - gap), true)} style={{ fill: SERIES.second }} />}
                {(i === last || i === best) && total > 0 && (
                  <text x={cx} y={y(total) - 6} textAnchor="middle" className="fill-charcoal text-[11px] font-semibold">{total}</text>
                )}
                <text x={cx} y={height + 16} textAnchor="middle" className="fill-graysage text-[11px] capitalize">{d.label}</text>
                {/* zona de hover más grande que la columna */}
                <rect x={cx - slot / 2} y={0} width={slot} height={height + 22} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.name}, ${d.label}: ${total} asistentes`} />
              </g>
            )
          })}
          {/* Línea de referencia: promedio de los cultos mostrados */}
          {data.length > 1 && (
            <g className="pointer-events-none">
              <line x1={axisW} x2={width} y1={y(avg)} y2={y(avg)} stroke="rgba(30,42,36,0.35)" strokeWidth={1} />
              <text x={axisW + 4} y={y(avg) - 5} className="fill-graysage text-[11px] font-semibold">prom. {NUM.format(Math.round(avg))}</text>
            </g>
          )}
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tip x={axisW + slot * hover + slot / 2} width={width}>
          <p className="font-semibold">{data[hover].name}</p>
          <p className="capitalize text-paper/70">{data[hover].label}</p>
          <p className="mt-1">Presencial <b>{data[hover].presential}</b> · En línea <b>{data[hover].online}</b></p>
          {data[hover].capacity ? (
            <p className="text-paper/70">{Math.round(((data[hover].presential) / data[hover].capacity!) * 100)}% de las sillas</p>
          ) : null}
        </Tip>
      )}
    </div>
  )
}

// Columna con 4px redondeados solo en el extremo de datos.
function colPath(x: number, base: number, w: number, h: number, roundTop: boolean): string {
  const r = roundTop ? Math.min(4, h, w / 2) : 0
  const top = base - h
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`
}

// ── Crecimiento: línea de 2px con lavado del 10% ─────────────────────────

export function GrowthLine({ data, height = 120 }: { data: { label: string; value: number }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = 8
  const min = Math.min(...data.map((d) => d.value))
  const maxV = Math.max(...data.map((d) => d.value))
  const lo = Math.max(0, min - Math.ceil((maxV - min || 1) * 0.3))
  const hi = maxV + Math.ceil((maxV - min || 1) * 0.15)
  const x = (i: number) => pad + (data.length > 1 ? (i / (data.length - 1)) * (width - pad * 2) : (width - pad * 2) / 2)
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ')
  const area = `${line} L${x(data.length - 1)},${height} L${x(0)},${height} Z`
  const lastI = data.length - 1

  return (
    <div ref={ref} className="relative pt-6" onMouseLeave={() => setHover(null)}>
      {width > 0 && data.length > 0 && (
        <svg
          width={width}
          height={height + 18}
          className="overflow-visible"
          role="img"
          aria-label="Miembros registrados por mes"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const rel = (e.clientX - r.left - pad) / (width - pad * 2)
            setHover(Math.max(0, Math.min(lastI, Math.round(rel * lastI))))
          }}
        >
          <line x1={0} x2={width} y1={height} y2={height} stroke={GRID} />
          <path d={area} style={{ fill: SERIES.main }} opacity={0.1} />
          <path d={line} fill="none" style={{ stroke: SERIES.main }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="rgba(30,42,36,0.25)" />}
          {[hover ?? lastI].map((i) => (
            <circle key={i} cx={x(i)} cy={y(data[i].value)} r={4.5} style={{ fill: SERIES.main }} stroke="#fff" strokeWidth={2} />
          ))}
          {hover == null && (
            <text x={x(lastI)} y={y(data[lastI].value) - 10} textAnchor="end" className="fill-charcoal text-[11px] font-semibold">{NUM.format(data[lastI].value)}</text>
          )}
          {data.map((d, i) => (
            <text key={d.label} x={x(i)} y={height + 14} textAnchor={i === 0 ? 'start' : i === lastI ? 'end' : 'middle'} className="fill-graysage text-[11px] capitalize">{d.label}</text>
          ))}
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tip x={x(hover)} width={width}>
          <span className="capitalize">{data[hover].label}</span> · <b>{NUM.format(data[hover].value)}</b> miembros
        </Tip>
      )}
    </div>
  )
}

// ── Composición: barra horizontal apilada con leyenda que lleva los números ──

export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-charcoal/5" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {shown.map((p) => (
          <span key={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / (total || 1)) * 100}%`, backgroundColor: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="text-graysage">{p.label}</span>
            <span className="ml-auto font-semibold text-charcoal">{NUM.format(p.value)}</span>
            <span className="w-10 text-right font-mono text-xs text-graysage">{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Mini gráficos de las tarjetas KPI ────────────────────────────────────

// Línea mínima de tendencia (sin ejes): 2px, lavado del 10% y punto final.
export function Sparkline({ values, color = SERIES.main, height = 36 }: { values: number[]; color?: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = 4
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2)
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const last = values.length - 1
  return (
    <div ref={ref} className="w-full" style={{ height }} aria-hidden>
      {width > 0 && values.length > 1 && (
        <svg width={width} height={height} className="overflow-visible">
          <path d={`${line} L${x(last)},${height} L${x(0)},${height} Z`} style={{ fill: color }} opacity={0.1} />
          <path d={line} fill="none" style={{ stroke: color }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(last)} cy={y(values[last])} r={3.5} style={{ fill: color }} stroke="#fff" strokeWidth={2} />
        </svg>
      )}
    </div>
  )
}

// ── Camino de discipulado: embudo horizontal ─────────────────────────────
// Cada paso es una barra proporcional al primero; una sola tonalidad que se
// aclara paso a paso. El % es respecto al total de miembros.
export function Funnel({ steps }: { steps: { label: string; value: number; hint: string }[] }) {
  const top = steps[0]?.value || 0
  return (
    <ol className="space-y-3.5">
      {steps.map((s, i) => {
        const p = top ? Math.round((s.value / top) * 100) : 0
        return (
          <li key={s.label}>
            <div className="mb-1.5 flex items-baseline gap-2 text-sm">
              <span className="font-semibold text-charcoal">{s.label}</span>
              <span className="truncate text-xs text-graysage">{s.hint}</span>
              <span className="ml-auto font-bold tabular-nums text-charcoal">{NUM.format(s.value)}</span>
              <span className="w-10 text-right font-mono text-xs text-graysage">{i === 0 ? '' : `${p}%`}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-charcoal/[0.06]">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(p, s.value ? 2 : 0)}%`, backgroundColor: SERIES.main, opacity: 1 - i * 0.17, transition: 'width .9s cubic-bezier(.2,.7,.2,1)', transitionDelay: `${i * 80}ms` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// Barra segmentada (0–100): 20 tramos de 5% cada uno.
export function Segments({ pct, color = SERIES.main }: { pct: number; color?: string }) {
  const on = Math.round(Math.max(0, Math.min(100, pct)) / 5)
  return (
    <div className="flex w-full gap-[3px]" aria-hidden>
      {Array.from({ length: 20 }, (_, i) => (
        <span key={i} className="h-1.5 flex-1 rounded-full transition-colors duration-500" style={{ backgroundColor: i < on ? color : 'rgba(30,42,36,0.08)', transitionDelay: `${i * 25}ms` }} />
      ))}
    </div>
  )
}

// Barra de proporción fina (parte / total).
export function Meter({ value, total, color = SERIES.main }: { value: number; total: number; color?: string }) {
  const p = total ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-charcoal/[0.07]" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: color, transition: 'width .8s cubic-bezier(.2,.7,.2,1)' }} />
    </div>
  )
}
