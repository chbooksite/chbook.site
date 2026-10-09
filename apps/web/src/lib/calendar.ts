// Calendario en línea de tiempo: ciclos (rangos de fechas anidables) y el eje
// temporal con zoom (horas/días/semanas/meses según px por día).

export interface Cycle {
  id: string
  parentId: string | null
  name: string
  color: string
  startsOn: string // 'YYYY-MM-DD'
  endsOn: string // 'YYYY-MM-DD' (inclusive)
  goal: string | null
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

// Construye el eje (banda superior = unidad grande, ticks = unidad fina) según
// el zoom (px por día). xOf convierte una fecha a píxeles desde el inicio.
export function buildAxis(rangeStart: Date, rangeEnd: Date, pxPerDay: number): { top: Band[]; ticks: Tick[]; unit: string } {
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

  if (pxPerDay >= 60) {
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
  } else if (pxPerDay >= 16) {
    // top = meses, ticks = días
    monthBands()
    let cur = startOfDay(rangeStart)
    while (cur < rangeEnd) { ticks.push({ x: xOf(cur), label: String(cur.getDate()) }); cur = addDays(cur, 1) }
  } else if (pxPerDay >= 4) {
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
  const unit = pxPerDay >= 60 ? 'horas' : pxPerDay >= 16 ? 'días' : pxPerDay >= 4 ? 'semanas' : 'meses'
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
