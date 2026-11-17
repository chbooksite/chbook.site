import { weekStart } from '../lib/activity'
import { ymd } from '../lib/calendar'

// Rango de comparación personalizable para los históricos: unidad (semanas/meses/
// años) + cantidad. Reutilizable en Salud, Actividades y Equipos.
export type RangeUnit = 'sem' | 'mes' | 'año'
export interface Range { unit: RangeUnit; count: number }
export const DEFAULT_RANGE: Range = { unit: 'sem', count: 12 }
export const COUNTS: Record<RangeUnit, number[]> = { sem: [8, 12, 26, 52], mes: [3, 6, 12, 24], año: [1, 2, 3, 5] }
const UNIT_LABEL: Record<RangeUnit, string> = { sem: 'semanas', mes: 'meses', año: 'años' }

const pad = (n: number) => String(n).padStart(2, '0')

// Clave del bucket temporal al que pertenece una fecha, según la unidad.
export function bucketKey(d: Date, unit: RangeUnit): string {
  if (unit === 'año') return String(d.getFullYear())
  if (unit === 'mes') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  return ymd(weekStart(d)) // semana (domingo)
}
// Etiqueta legible del bucket.
export function bucketLabel(key: string, unit: RangeUnit): string {
  if (unit === 'año') return key
  if (unit === 'mes') { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'short', year: '2-digit' }) }
  const [y, m, dd] = key.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}
// Fecha de corte: solo se consideran fechas >= cutoff.
export function cutoff(r: Range): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (r.unit === 'año') d.setFullYear(d.getFullYear() - r.count)
  else if (r.unit === 'mes') d.setMonth(d.getMonth() - r.count)
  else d.setDate(d.getDate() - r.count * 7)
  return d
}

export default function RangeControl({ value, onChange, size = 'md' }: { value: Range; onChange: (r: Range) => void; size?: 'sm' | 'md' }) {
  const btn = (on: boolean) => `rounded-full px-2.5 py-1 font-medium transition ${on ? 'bg-white text-charcoal shadow-sm' : 'text-graysage hover:text-charcoal'}`
  const txt = size === 'sm' ? 'text-[0.7rem]' : 'text-xs'
  return (
    <div className={`flex flex-wrap items-center gap-2 ${txt}`}>
      <div className="flex rounded-full bg-cream p-0.5">
        {(['sem', 'mes', 'año'] as RangeUnit[]).map((u) => (
          <button key={u} type="button" onClick={() => onChange({ unit: u, count: COUNTS[u].includes(value.count) ? value.count : COUNTS[u][1] })} className={btn(value.unit === u)}>
            {UNIT_LABEL[u]}
          </button>
        ))}
      </div>
      <div className="flex rounded-full bg-cream p-0.5">
        {COUNTS[value.unit].map((c) => (
          <button key={c} type="button" onClick={() => onChange({ ...value, count: c })} className={btn(value.count === c)}>{c}</button>
        ))}
      </div>
    </div>
  )
}
