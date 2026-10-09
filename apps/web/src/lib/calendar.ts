// Calendario en línea de tiempo: ciclos (rangos de fechas anidables) y el eje
// temporal con zoom (horas/días/semanas/meses según px por día).

export type CycleDuration = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom'

export interface Cycle {
  id: string
  parentId: string | null
  name: string
  color: string
  startsOn: string // 'YYYY-MM-DD'
  endsOn: string // 'YYYY-MM-DD' (inclusive) — fin de UNA ocurrencia
  goal: string | null
  duration: CycleDuration
  repeat: number // nº de repeticiones; 0 = continuo (indefinido)
}

export const CYCLE_DURATIONS: { value: CycleDuration; label: string }[] = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: '15 días' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: '6 meses' },
  { value: 'annual', label: 'Anual' },
  { value: 'custom', label: 'Personalizada' },
]

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

// Fin (inclusive) de UNA ocurrencia a partir de su inicio, según la duración.
// Para 'custom' se conserva la longitud actual (end - start).
export function occurrenceEnd(duration: CycleDuration, start: Date, customEnd: Date): Date {
  switch (duration) {
    case 'weekly': return addDays(start, 6)
    case 'biweekly': return addDays(start, 14)
    case 'monthly': return addDays(addMonths(start, 1), -1)
    case 'quarterly': return addDays(addMonths(start, 3), -1)
    case 'semiannual': return addDays(addMonths(start, 6), -1)
    case 'annual': return addDays(addMonths(start, 12), -1)
    default: return customEnd
  }
}

// Inicio de la ocurrencia i (0-based) según la duración.
export function occurrenceStart(duration: CycleDuration, start: Date, customLenDays: number, i: number): Date {
  switch (duration) {
    case 'weekly': return addDays(start, 7 * i)
    case 'biweekly': return addDays(start, 15 * i)
    case 'monthly': return addMonths(start, i)
    case 'quarterly': return addMonths(start, 3 * i)
    case 'semiannual': return addMonths(start, 6 * i)
    case 'annual': return addMonths(start, 12 * i)
    default: return addDays(start, customLenDays * i)
  }
}

// Ocurrencias visibles de un ciclo dentro de [.., rangeEnd]. Continuo (repeat=0)
// se limita a lo que entra en la ventana (con tope de seguridad).
export function cycleOccurrences(c: Cycle, rangeEnd: Date, maxN = 400): { start: Date; end: Date; i: number }[] {
  const start0 = parseYmd(c.startsOn)
  const end0 = parseYmd(c.endsOn)
  const customLen = Math.max(1, dayDiff(start0, end0) + 1)
  const count = c.repeat && c.repeat > 0 ? c.repeat : maxN
  const out: { start: Date; end: Date; i: number }[] = []
  for (let i = 0; i < count; i++) {
    const s = occurrenceStart(c.duration, start0, customLen, i)
    if (s > rangeEnd) break
    const e = occurrenceEnd(c.duration, s, addDays(s, customLen - 1))
    out.push({ start: s, end: e, i })
  }
  return out.length ? out : [{ start: start0, end: end0, i: 0 }]
}

export const DAY_MS = 86400000

export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

export interface Band { x: number; w: number; label: string; strong?: boolean }
export interface Tick { x: number; label: string }

export type AxisUnit = 'hours' | 'days' | 'weeks' | 'months'

// Unidad del eje según cuántos días caben en pantalla (los días visibles).
// Las horas solo aparecen cuando se ve ~un día (zoom máximo de acercamiento).
export function chooseUnit(visibleDays: number): AxisUnit {
  if (visibleDays <= 2.5) return 'hours'
  if (visibleDays <= 45) return 'days'
  if (visibleDays <= 160) return 'weeks'
  return 'months'
}

// Construye el eje (banda superior = unidad grande, ticks = unidad fina) para la
// unidad dada. xOf convierte una fecha a píxeles desde el inicio.
export function buildAxis(rangeStart: Date, rangeEnd: Date, pxPerDay: number, unit: AxisUnit): { top: Band[]; ticks: Tick[]; unit: AxisUnit } {
  const xOf = (d: Date) => ((d.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay
  const top: Band[] = []
  const ticks: Tick[] = []

  const monthBands = () => {
    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (cur < rangeEnd) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      top.push({ x: xOf(cur), w: xOf(next) - xOf(cur), label: cur.toLocaleDateString('es', { month: 'long', year: 'numeric' }), strong: cur.getMonth() === 0 })
      cur = next
    }
  }
  const dayBands = () => {
    let cur = startOfDay(rangeStart)
    while (cur < rangeEnd) {
      const next = addDays(cur, 1)
      top.push({ x: xOf(cur), w: xOf(next) - xOf(cur), label: cur.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) })
      cur = next
    }
  }
  const yearBands = () => {
    let cur = new Date(rangeStart.getFullYear(), 0, 1)
    while (cur < rangeEnd) {
      const next = new Date(cur.getFullYear() + 1, 0, 1)
      top.push({ x: xOf(cur), w: xOf(next) - xOf(cur), label: String(cur.getFullYear()), strong: true })
      cur = next
    }
  }

  if (unit === 'hours') {
    // top = días, ticks = horas (cada 3h)
    dayBands()
    let cur = startOfDay(rangeStart)
    while (cur < rangeEnd) {
      for (let h = 0; h < 24; h += 3) {
        const t = new Date(cur); t.setHours(h)
        ticks.push({ x: xOf(t), label: `${h}:00` })
      }
      cur = addDays(cur, 1)
    }
  } else if (unit === 'days') {
    // top = meses, ticks = días
    monthBands()
    let cur = startOfDay(rangeStart)
    while (cur < rangeEnd) { ticks.push({ x: xOf(cur), label: String(cur.getDate()) }); cur = addDays(cur, 1) }
  } else if (unit === 'weeks') {
    // top = meses, ticks = semanas (lunes)
    monthBands()
    let cur = startOfDay(rangeStart)
    cur = addDays(cur, ((8 - cur.getDay()) % 7)) // próximo lunes (getDay: 0=dom)
    while (cur < rangeEnd) { ticks.push({ x: xOf(cur), label: `${cur.getDate()} ${cur.toLocaleDateString('es', { month: 'short' })}` }); cur = addDays(cur, 7) }
  } else {
    // top = años, ticks = meses
    yearBands()
    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (cur < rangeEnd) { ticks.push({ x: xOf(cur), label: cur.toLocaleDateString('es', { month: 'short' }) }); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1) }
  }
  return { top, ticks, unit }
}

// Profundidad de anidamiento de un ciclo (para apilar en carriles).
export function cycleDepth(c: Cycle, byId: Map<string, Cycle>): number {
  let d = 0
  let p = c.parentId
  const seen = new Set<string>()
  while (p && byId.has(p) && !seen.has(p)) { seen.add(p); d++; p = byId.get(p)!.parentId }
  return d
}
