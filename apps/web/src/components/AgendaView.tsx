import { useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { AUDIENCE_ALL, occursOn, type Audience, type Schedule } from '../lib/activity'
import AudiencePicker from './AudiencePicker'

type RecSchedule = Schedule & { color: string; responsibles?: string | null; preacher?: string | null }
type View = 'compact' | 'expanded' | 'month'
// Atributos que la tarjeta "Nueva actividad" lleva consigo al arrastrarse: el tipo
// de servicio y los equipos que se eligen inline en la franja lateral. Al soltar,
// la actividad nace con estos campos llenos.
export type NewActivityAttrs = { typeId: string | null; teamIds: string[]; audience: Audience }
type TypeOpt = { id: string; name: string; color: string }
type TeamOpt = { id: string; name: string }
type RoleOpt = { id: string; name: string }
type AgeOpt = { key: string; name: string }

// Agenda tipo calendario con TIRA de días que se arrastra (izquierda/derecha) en
// vez de flechas. Dos vistas de la tira: COMPACTA (tarjetas apiladas bajo la fecha)
// y AMPLIADA (rejilla con horas en el eje Y). Más una vista MES (rejilla). Columna
// izquierda con mini-mes + tarjeta "Nueva actividad".

const WD_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] // lunes primero
const MONTH_DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const PPH_DEFAULT = 46 // px por hora inicial (vista ampliada); ajustable con zoom
const PPH_MIN = 24, PPH_MAX = 150
const COMPACT_H = 215 // alto fijo de la tarjeta de día en modo compacto (con scroll)
const COL_W = 180 // ancho de columna de día (ampliada)
const COL_W_C = 170 // ancho de tarjeta de día (compacta)
const GUTTER = 38 // ancho del eje de horas (formato reducido)
const HEADER_H = 52 // alto de la cabecera de día
const RANGE_BACK = 45 // días hacia atrás desde hoy
const RANGE_DAYS = 400 // total de días en la tira

function withAlpha(hex: string, a: number): string {
  const h = (hex || '#94a3b8').replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return `rgba(${parseInt(n.slice(0, 2), 16) || 0}, ${parseInt(n.slice(2, 4), 16) || 0}, ${parseInt(n.slice(4, 6), 16) || 0}, ${a})`
}
// Suaviza cualquier color elegido por el usuario hacia un tono pastel (mezcla con
// blanco). mix = fracción de blanco (0.6 → bastante suave).
function soft(hex: string, mix = 0.6): string {
  const h = (hex || '#94a3b8').replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const m = (c: number) => Math.round(c * (1 - mix) + 255 * mix)
  return `rgb(${m(parseInt(n.slice(0, 2), 16) || 0)}, ${m(parseInt(n.slice(2, 4), 16) || 0)}, ${m(parseInt(n.slice(4, 6), 16) || 0)})`
}
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const minutesOf = (t: string | null) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const fmtMin = (min: number) => { let h = Math.floor(min / 60); const m = min % 60; const ap = h < 12 ? 'a.m.' : 'p.m.'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}` }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Hora en formato reducido para la regla: 0→12a, 5→5a, 12→12p, 15→3p, 23→11p.
const fmtHourShort = (h: number) => { const hh = ((h % 24) + 24) % 24; return `${hh % 12 || 12}${hh < 12 ? 'a' : 'p'}` }
// Color de letra del encabezado por día: domingo más claro que sábado para resaltar.
const dowText = (d: Date) => (d.getDay() === 0 ? 'text-beige-light' : d.getDay() === 6 ? 'text-sand' : 'text-sage-light')
// keyframes del despliegue (fuera del JSX: el parser de Vite no tolera las llaves
// de CSS dentro de un contenedor de expresión JSX).
const AGENDA_GROW_CSS = '@keyframes agendaGrow{from{transform:scaleY(.5);opacity:.4}to{transform:scaleY(1);opacity:1}}'
// Reducción (modo compacto): las tarjetas se colapsan hacia su tamaño reducido.
const AGENDA_SHRINK_CSS = '@keyframes agendaShrink{from{transform:scaleY(1.35)}to{transform:scaleY(1)}}'

export default function AgendaView({
  recurring,
  typeOptions = [],
  teamOptions = [],
  roleOptions = [],
  ageOptions = [],
  onCreateType,
  onEdit,
  onNewAt,
  onDropNew,
  onBlockChange,
  onToggleRecurring,
  onDuplicate,
  onDeleteBlock,
  onMoveToDay,
  renderDayEditor,
}: {
  recurring: RecSchedule[]
  typeOptions?: TypeOpt[]
  teamOptions?: TeamOpt[]
  roleOptions?: RoleOpt[]
  ageOptions?: AgeOpt[]
  onCreateType?: (name: string, color?: string) => Promise<{ id: string; name: string; color: string } | null>
  onEdit?: (id: string) => void
  onNewAt?: (date: Date, startTime?: string) => void
  onDropNew?: (date: Date, startTime?: string, attrs?: NewActivityAttrs) => void
  onBlockChange?: (id: string, patch: { date: Date; startMin: number; endMin: number; toOneOff: boolean }) => void
  onToggleRecurring?: (id: string, date: Date, recurring: boolean) => void
  onDuplicate?: (id: string, date: Date) => void
  onDeleteBlock?: (id: string) => void
  onMoveToDay?: (id: string, date: Date) => void
  renderDayEditor?: (opts: { date: Date; activityId: string | null; onClose: () => void; leftSlot: HTMLElement | null }) => ReactNode
}) {
  const today = startOfDay(new Date())
  const rangeStart = addDays(today, -RANGE_BACK)
  const [view, setView] = useState<View>('expanded')
  const [monthCursor, setMonthCursor] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1))
  const [leftDate, setLeftDate] = useState<Date>(today) // día más a la izquierda visible (para resaltar en el mini-mes)
  const [ghost, setGhost] = useState<{ x: number; y: number; over: boolean } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ dayIdx: number; startMin: number } | null>(null)
  const cardDrag = useRef<{ x0: number; y0: number; moved: boolean } | null>(null)
  // atributos actuales de la tarjeta "Nueva actividad" (elegidos inline)
  const [newTypeId, setNewTypeId] = useState<string | null>(typeOptions[0]?.id ?? null)
  const [newTeamIds, setNewTeamIds] = useState<string[]>([])
  const [creatingType, setCreatingType] = useState(false)
  const [typeName, setTypeName] = useState('')
  const [typeColor, setTypeColor] = useState<string | null>(null) // null = color automático
  const doCreateType = async () => {
    if (!onCreateType || !typeName.trim()) return
    const t = await onCreateType(typeName.trim(), typeColor ?? undefined)
    if (t) setNewTypeId(t.id)
    setCreatingType(false); setTypeName(''); setTypeColor(null)
  }
  const [newAudience, setNewAudience] = useState<Audience>({ ...AUDIENCE_ALL })
  const selType = typeOptions.find((t) => t.id === newTypeId) ?? null
  const dragColor = selType?.color ?? null

  // mover / redimensionar bloques (vista ampliada)
  const [blockDrag, setBlockDrag] = useState<{ id: string; dayIdx: number; startMin: number; endMin: number; color: string } | null>(null)
  const blockRef = useRef<{ id: string; mode: 'move' | 'top' | 'bottom'; sx: number; sy: number; lx: number; ly: number; grabMin: number; s0: number; e0: number; day0: number; color: string; moved: boolean } | null>(null)
  // arrastrar etiquetas en modo compacto (mover a otro día / eliminar abajo)
  type CTarget = { kind: 'day'; dayIdx: number } | null
  const [cDrag, setCDrag] = useState<{ id: string; color: string; name: string; x: number; y: number; target: CTarget } | null>(null)
  const cRef = useRef<{ id: string; color: string; name: string; sx: number; sy: number; day0: number; moved: boolean } | null>(null)
  // portapapeles (copiar/pegar) y menús flotantes (soltar = mover/copiar; clic derecho)
  const [clip, setClip] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; kind: 'activity' | 'empty'; id?: string; date?: Date } | null>(null)
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; id: string; date: Date; startMin?: number; endMin?: number } | null>(null)
  const [selDay, setSelDay] = useState<number | null>(null) // día seleccionado (modo compacto)
  const [editInline, setEditInline] = useState<{ id: string | null } | null>(null) // editor embebido en el panel
  const [leftSlotEl, setLeftSlotEl] = useState<HTMLElement | null>(null) // contenedor en la franja para las entradas del editor
  // mover / redimensionar actividades dentro del recuadro del día (eje horizontal)
  const [dayBlock, setDayBlock] = useState<{ id: string; startMin: number; endMin: number } | null>(null)
  const dayRef = useRef<{ id: string; mode: 'move' | 'l' | 'r'; sx: number; sy: number; s0: number; e0: number; gx: number; gw: number; moved: boolean } | null>(null)

  // Jornada visible (regla de horas) + zoom. startH/endH definen la ventana; incluye
  // madrugada (0) para vigilias. pph = px por hora (zoom arrastrando la regla).
  const [startH, setStartH] = useState(6)
  const [endH, setEndH] = useState(23)
  const [pph, setPph] = useState(PPH_DEFAULT)
  const PPH = pph
  const zoomRef = useRef<{ y: number; pph: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ sl: number; x: number; lastX: number; lastT: number; v: number } | null>(null)
  const momentum = useRef<number | null>(null)
  const animScroll = useRef<number | null>(null)
  const panMoved = useRef(false)
  const [viewW, setViewW] = useState(0) // ancho visible de la tira (para encajar 7 días)

  const days = Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i))
  // Ancho de columna para que SIEMPRE se vea una semana completa (7 días).
  const colW = view === 'compact'
    ? (viewW ? Math.max(90, Math.floor(viewW / 7) - 8) : COL_W_C)
    : (viewW ? Math.max(90, Math.floor((viewW - GUTTER) / 7)) : COL_W)
  // Paso real por día (el compacto tiene separación de 8px entre tarjetas).
  const stride = view === 'compact' ? colW + 8 : colW

  // Bloques/actividades por día.
  interface Block { id: string; startMin: number; endMin: number; title: string; color: string; responsibles?: string | null; recurring: boolean; lane: number; lanes: number }
  const dayData = (d: Date) => {
    const timed: Block[] = []
    const allDay: RecSchedule[] = []
    for (const r of recurring) {
      if (!occursOn(r, d)) continue
      if (!r.startTime) { allDay.push(r); continue }
      const s = minutesOf(r.startTime)
      const e = r.endTime ? Math.max(minutesOf(r.endTime), s + 20) : s + 60
      timed.push({ id: r.id, startMin: s, endMin: e, title: r.name, color: r.color, responsibles: r.responsibles, recurring: !r.onDate, lane: 0, lanes: 1 })
    }
    timed.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    const laneEnd: number[] = []
    for (const b of timed) { let L = 0; while (L < laneEnd.length && laneEnd[L] > b.startMin) L++; b.lane = L; laneEnd[L] = b.endMin }
    const nLanes = Math.max(1, laneEnd.length)
    for (const b of timed) b.lanes = nLanes
    return { timed, allDay }
  }

  // Rango horario (vista ampliada): la jornada que el usuario eligió (startH→endH).
  const hMin = startH, hMax = endH
  const hours = Array.from({ length: hMax - hMin + 1 }, (_, i) => hMin + i)
  const gridH = (hMax - hMin) * PPH
  const yOf = (min: number) => ((min - hMin * 60) / 60) * PPH

  // ----- navegación por arrastre (horizontal) + inercia -----
  const idxOf = (d: Date) => Math.round((startOfDay(d).getTime() - rangeStart.getTime()) / 86400000)
  const scrollToDate = (d: Date) => { const el = scrollRef.current; if (el) el.scrollLeft = Math.max(0, idxOf(d) * stride) }
  // Mide el ancho visible (para encajar 7 días) y reposiciona al cambiar de vista.
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el); setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [view])
  useLayoutEffect(() => { scrollToDate(today); syncLeft() }, [view, viewW]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncLeft = () => { const el = scrollRef.current; if (!el) return; setLeftDate(addDays(rangeStart, Math.floor(el.scrollLeft / stride))) }

  // animación suave de scroll horizontal + imán al lunes
  const animateScrollTo = (target: number, dur = 600) => {
    const el = scrollRef.current; if (!el) return
    if (animScroll.current) cancelAnimationFrame(animScroll.current)
    const start = el.scrollLeft, dist = target - start, t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (now: number) => { const t = Math.min(1, (now - t0) / dur); el.scrollLeft = start + dist * ease(t); if (t < 1) animScroll.current = requestAnimationFrame(step); else { animScroll.current = null; syncLeft() } }
    animScroll.current = requestAnimationFrame(step)
  }
  // Imán suave: alinea el inicio del día MÁS CERCANO con el inicio de la línea
  // (no fuerza al lunes). Como siempre se ven 7 días, la vista queda encuadrada.
  const snapToDay = () => {
    const el = scrollRef.current; if (!el) return
    const target = Math.max(0, Math.round(el.scrollLeft / stride) * stride)
    if (Math.abs(target - el.scrollLeft) > 1) animateScrollTo(target, 550)
  }

  const onDown = (e: RPointerEvent) => {
    const el = scrollRef.current; if (!el) return
    if ((e.target as HTMLElement).closest('[data-block],[data-add],[data-ruler],[data-sel]')) return // no robar clics de bloques/+/regla/selección
    if (momentum.current) { cancelAnimationFrame(momentum.current); momentum.current = null }
    if (animScroll.current) { cancelAnimationFrame(animScroll.current); animScroll.current = null }
    panMoved.current = false
    pan.current = { sl: el.scrollLeft, x: e.clientX, lastX: e.clientX, lastT: performance.now(), v: 0 }
    el.setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const p = pan.current; if (!p) return
    if (e.buttons === 0) { release(); return }
    if (Math.abs(e.clientX - p.x) > 4) panMoved.current = true
    const el = scrollRef.current; if (el) el.scrollLeft = p.sl - (e.clientX - p.x)
    const now = performance.now(), dt = now - p.lastT
    if (dt > 0) { p.v = p.v * 0.7 + (-(e.clientX - p.lastX) / dt) * 0.3; p.lastX = e.clientX; p.lastT = now }
  }
  const release = () => {
    const p = pan.current; pan.current = null
    const el = scrollRef.current; if (!p || !el) return
    let v = p.v * 0.45, pos = el.scrollLeft, last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(48, now - last); last = now
      v *= Math.pow(0.90, dt / 16)
      if (Math.abs(v) < 0.01) { momentum.current = null; snapToDay(); return }
      pos += v * dt
      const max = el.scrollWidth - el.clientWidth
      if (pos <= 0 || pos >= max) { el.scrollLeft = Math.max(0, Math.min(max, pos)); momentum.current = null; return }
      el.scrollLeft = pos; momentum.current = requestAnimationFrame(step)
    }
    momentum.current = requestAnimationFrame(step)
  }
  const onUp = () => { if (pan.current) release() }

  // ----- arrastrar la tarjeta "Nueva actividad" a la rejilla -----
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  // Día + hora (alineada a la hora) bajo el cursor, o null si está fuera de la rejilla.
  const targetAt = (x: number, y: number): { dayIdx: number; startMin: number } | null => {
    const el = scrollRef.current; if (!el) return null
    const r = el.getBoundingClientRect()
    if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return null
    const cx = x - r.left + el.scrollLeft
    if (view === 'compact') { const idx = Math.floor(cx / (colW + 8)); return idx >= 0 && idx < days.length ? { dayIdx: idx, startMin: -1 } : null }
    const idx = Math.floor((cx - GUTTER) / colW)
    if (idx < 0 || idx >= days.length) return null
    const cy = y - r.top + el.scrollTop
    if (cy < HEADER_H) return { dayIdx: idx, startMin: -1 }
    const raw = hMin * 60 + ((cy - HEADER_H) / PPH) * 60
    return { dayIdx: idx, startMin: Math.max(hMin * 60, Math.min((hMax - 1) * 60, Math.round(raw / 60) * 60)) }
  }
  const attrs = (): NewActivityAttrs => ({ typeId: newTypeId, teamIds: newTeamIds, audience: newAudience })
  const onCardDown = (e: RPointerEvent) => { cardDrag.current = { x0: e.clientX, y0: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  const onCardMove = (e: RPointerEvent) => {
    const d = cardDrag.current; if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return
    d.moved = true
    const t = targetAt(e.clientX, e.clientY)
    setDropTarget(t)
    setGhost({ x: e.clientX, y: e.clientY, over: !!t })
  }
  const onCardUp = (e: RPointerEvent) => {
    const d = cardDrag.current; cardDrag.current = null; setGhost(null); setDropTarget(null)
    if (!d) return
    if (!d.moved) { if (onDropNew) onDropNew(leftDate, undefined, attrs()); else onNewAt?.(leftDate); return }
    const t = targetAt(e.clientX, e.clientY)
    if (!t) return
    onDropNew?.(addDays(rangeStart, t.dayIdx), t.startMin >= 0 ? hhmm(t.startMin) : undefined, attrs())
  }

  // ----- mover / redimensionar un bloque (precisión 5 min) -----
  const SNAP = 5
  const snap5 = (m: number) => Math.round(m / SNAP) * SNAP
  // clientX/clientY → { dayIdx, min } en coordenadas de la rejilla (sin snap).
  const pointToGrid = (x: number, y: number): { dayIdx: number; min: number } | null => {
    const el = scrollRef.current; if (!el) return null
    const r = el.getBoundingClientRect()
    const cx = x - r.left + el.scrollLeft
    const dayIdx = Math.max(0, Math.min(days.length - 1, Math.floor((cx - GUTTER) / colW)))
    const cy = y - r.top + el.scrollTop - HEADER_H
    const min = Math.max(hMin * 60, Math.min(hMax * 60, hMin * 60 + (cy / PPH) * 60))
    return { dayIdx, min }
  }
  const onBlockDown = (b: { id: string; startMin: number; endMin: number; color: string }, dayIdx: number, mode: 'move' | 'top' | 'bottom') => (e: RPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const g = pointToGrid(e.clientX, e.clientY)
    blockRef.current = { id: b.id, mode, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, grabMin: g ? g.min - b.startMin : 0, s0: b.startMin, e0: b.endMin, day0: dayIdx, color: b.color, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onBlockMove = (e: RPointerEvent) => {
    const d = blockRef.current; if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
    d.moved = true
    d.lx = e.clientX; d.ly = e.clientY
    const g = pointToGrid(e.clientX, e.clientY); if (!g) return
    const dur = d.e0 - d.s0
    if (d.mode === 'move') {
      const s = Math.max(hMin * 60, Math.min(hMax * 60 - dur, snap5(g.min - d.grabMin)))
      setBlockDrag({ id: d.id, dayIdx: g.dayIdx, startMin: s, endMin: s + dur, color: d.color })
    } else if (d.mode === 'bottom') {
      const eMin = Math.max(d.s0 + SNAP, Math.min(hMax * 60, snap5(g.min)))
      setBlockDrag({ id: d.id, dayIdx: d.day0, startMin: d.s0, endMin: eMin, color: d.color })
    } else {
      const s = Math.min(d.e0 - SNAP, Math.max(hMin * 60, snap5(g.min)))
      setBlockDrag({ id: d.id, dayIdx: d.day0, startMin: s, endMin: d.e0, color: d.color })
    }
  }
  const onBlockUp = () => {
    const d = blockRef.current; blockRef.current = null
    const drag = blockDrag
    if (!d) return
    if (!d.moved) {
      setBlockDrag(null)
      // Seleccionar en ampliado → pasar a reducido y abrir el editor bajo el día.
      if (renderDayEditor) { setView('compact'); setSelDay(d.day0); setEditInline({ id: d.id }) }
      else onEdit?.(d.id)
      return
    }
    setBlockDrag(null)
    if (!drag) return
    // Mover el cuerpo a OTRO día → menú Mover/Copiar; mismo día o redimensionar → aplica.
    if (d.mode === 'move' && drag.dayIdx !== d.day0) {
      setDropMenu({ x: d.lx, y: d.ly, id: d.id, date: addDays(rangeStart, drag.dayIdx), startMin: drag.startMin, endMin: drag.endMin })
      return
    }
    onBlockChange?.(d.id, { date: addDays(rangeStart, drag.dayIdx), startMin: drag.startMin, endMin: drag.endMin, toOneOff: false })
  }

  // ----- zoom arrastrando la regla de horas (arriba = acercar, abajo = alejar) -----
  const onRulerDown = (e: RPointerEvent) => { e.stopPropagation(); zoomRef.current = { y: e.clientY, pph }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  const onRulerMove = (e: RPointerEvent) => { const z = zoomRef.current; if (!z) return; const dy = z.y - e.clientY; setPph(Math.max(PPH_MIN, Math.min(PPH_MAX, Math.round(z.pph + dy * 0.5)))) }
  const onRulerUp = () => { zoomRef.current = null }

  // ----- arrastrar etiquetas (modo compacto): soltar en otro día → Mover/Copiar -----
  const cTargetAt = (x: number, y: number): CTarget => {
    const el = scrollRef.current; if (!el) return null
    const r = el.getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
    const cx = x - r.left + el.scrollLeft
    return { kind: 'day', dayIdx: Math.max(0, Math.min(days.length - 1, Math.floor(cx / stride))) }
  }
  const cDown = (a: { id: string; color: string; name: string }, dayIdx: number) => (e: RPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    cRef.current = { id: a.id, color: a.color, name: a.name, sx: e.clientX, sy: e.clientY, day0: dayIdx, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const cMove = (e: RPointerEvent) => {
    const d = cRef.current; if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
    d.moved = true
    setCDrag({ id: d.id, color: d.color, name: d.name, x: e.clientX, y: e.clientY, target: cTargetAt(e.clientX, e.clientY) })
  }
  const cUp = () => {
    const d = cRef.current; cRef.current = null
    const drag = cDrag; setCDrag(null)
    if (!d) return
    if (!d.moved) { if (renderDayEditor) { setSelDay(d.day0); setEditInline({ id: d.id }) } else onEdit?.(d.id); return }
    if (!drag || !drag.target) return
    if (drag.target.dayIdx !== d.day0) setDropMenu({ x: drag.x, y: drag.y, id: d.id, date: addDays(rangeStart, drag.target.dayIdx) })
  }

  // ----- mover / redimensionar una actividad en el recuadro del día (horizontal) -----
  const dayDown = (b: { id: string; startMin: number; endMin: number }, mode: 'move' | 'l' | 'r') => (e: RPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const track = (e.currentTarget as HTMLElement).closest('[data-daytrack]') as HTMLElement | null
    const r = track?.getBoundingClientRect()
    dayRef.current = { id: b.id, mode, sx: e.clientX, sy: e.clientY, s0: b.startMin, e0: b.endMin, gx: r?.left ?? 0, gw: r?.width ?? 1, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const dayMove = (e: RPointerEvent) => {
    const d = dayRef.current; if (!d) return
    if (!d.moved && Math.abs(e.clientX - d.sx) < 4 && Math.abs(e.clientY - d.sy) < 4) return
    d.moved = true
    const spanMin = (hMax - hMin) * 60
    const deltaMin = ((e.clientX - d.sx) / d.gw) * spanMin
    const snap = (m: number) => Math.round(m / 5) * 5
    const lo = hMin * 60, hi = hMax * 60, dur = d.e0 - d.s0
    let s = d.s0, en = d.e0
    if (d.mode === 'move') { s = Math.max(lo, Math.min(hi - dur, snap(d.s0 + deltaMin))); en = s + dur }
    else if (d.mode === 'l') { s = Math.max(lo, Math.min(d.e0 - 5, snap(d.s0 + deltaMin))); en = d.e0 }
    else { en = Math.max(d.s0 + 5, Math.min(hi, snap(d.e0 + deltaMin))); s = d.s0 }
    setDayBlock({ id: d.id, startMin: s, endMin: en })
  }
  const dayUp = () => {
    const d = dayRef.current; dayRef.current = null
    const prev = dayBlock; setDayBlock(null)
    if (!d) return
    if (!d.moved) { if (renderDayEditor) setEditInline({ id: d.id }); else onEdit?.(d.id); return }
    const sd = selDay != null ? days[selDay] : null
    if (prev && sd) onBlockChange?.(d.id, { date: sd, startMin: prev.startMin, endMin: prev.endMin, toOneOff: false })
  }

  const goToday = () => { scrollToDate(today); syncLeft() }
  const toggleCls = (v: View) => `rounded-lg px-3 py-1 text-xs font-medium transition ${view === v ? 'bg-sage-light text-sage-dark' : 'text-graysage hover:bg-sage-light/60'}`

  // clic en hueco de la rejilla → nueva actividad con día+hora
  const onSlotClick = (d: Date) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-block]')) return
    if (panMoved.current) { panMoved.current = false; return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const min = hMin * 60 + Math.round(((e.clientY - rect.top) / PPH) * 60 / 15) * 15
    onNewAt?.(d, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`)
  }

  const inRange = (d: Date) => view === 'month'
    ? d.getMonth() === monthCursor.getMonth() && d.getFullYear() === monthCursor.getFullYear()
    : d >= leftDate && d < addDays(leftDate, 7)

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ===== Columna izquierda ===== */}
      <aside className="w-full shrink-0 space-y-4 lg:w-72">
        {/* Al editar una actividad, la franja aloja las ENTRADAS del editor (el
            recuadro solo muestra la línea de tiempo). Si no, el mini-mes + crear. */}
        {editInline ? (
          <div ref={setLeftSlotEl} className="flex flex-col gap-3" />
        ) : (
        <>
        <MiniMonth cursor={monthCursor} setCursor={setMonthCursor} today={today} inRange={inRange} onPick={(d) => { setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1)); if (view === 'month') setView('expanded'); requestAnimationFrame(() => { scrollToDate(d); syncLeft() }) }} />
        {/* Tarjeta ÚNICA "Nueva actividad": toma el tipo y los equipos elegidos
            abajo. Al arrastrarla a la rejilla, la actividad nace con esos campos
            ya llenos (sin formulario). */}
        <div
          onPointerDown={onCardDown}
          onPointerMove={onCardMove}
          onPointerUp={onCardUp}
          className="flex w-full touch-none items-center gap-3 rounded-2xl border border-dashed p-4 text-left transition hover:brightness-[0.98] active:cursor-grabbing"
          style={{ borderColor: withAlpha(dragColor ?? '#88C0A4', 0.6), backgroundColor: withAlpha(dragColor ?? '#88C0A4', 0.18) }}
          title="Arrastra al día y la hora"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white" style={{ backgroundColor: dragColor ?? '#5CA27B' }}>+</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-charcoal">{selType?.name ?? 'Nueva actividad'}</span>
            <span className="block truncate text-xs text-graysage">{newTeamIds.length ? `${newTeamIds.length} equipo${newTeamIds.length > 1 ? 's' : ''} · arrástrala` : 'Arrástrala al día y la hora'}</span>
          </span>
        </div>

        {/* Config inline: tipo de servicio + equipos. La tarjeta de arriba los toma. */}
        {(typeOptions.length > 0 || onCreateType) && (
          <div>
            <label className="mb-1 block px-1 text-[0.68rem] font-medium uppercase tracking-wide text-graysage">Tipo de servicio</label>
            <select
              value={newTypeId ?? ''}
              onChange={(e) => { const v = e.target.value; if (v === '__new__') { setCreatingType(true); return } setNewTypeId(v || null) }}
              className="w-full rounded-xl border border-graysage/25 bg-white px-3 py-2 text-sm text-charcoal"
            >
              <option value="">— Sin tipo —</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              {onCreateType && <option value="__new__">➕ Nuevo tipo…</option>}
            </select>
            {creatingType && (
              <div className="mt-1.5 space-y-1.5 rounded-xl border border-graysage/20 bg-cream/40 p-2">
                <input
                  autoFocus
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doCreateType(); if (e.key === 'Escape') { setCreatingType(false); setTypeName(''); setTypeColor(null) } }}
                  placeholder="Nombre del tipo"
                  className="w-full rounded-lg border border-graysage/25 bg-white px-2.5 py-1.5 text-sm text-charcoal"
                />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setTypeColor(typeColor == null ? '#88C0A4' : null)} className="rounded-lg border border-graysage/25 px-2 py-1 text-[0.7rem] text-graysage hover:bg-white">
                    {typeColor == null ? 'Color: automático' : 'Color:'}
                  </button>
                  {typeColor != null && <input type="color" value={typeColor} onChange={(e) => setTypeColor(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-graysage/25" />}
                  <div className="ml-auto flex gap-1.5">
                    <button type="button" onClick={() => { setCreatingType(false); setTypeName(''); setTypeColor(null) }} className="rounded-lg px-2 py-1 text-[0.7rem] text-graysage hover:bg-white">Cancelar</button>
                    <button type="button" onClick={doCreateType} disabled={!typeName.trim()} className="rounded-lg bg-sage-dark px-2.5 py-1 text-[0.7rem] font-medium text-white disabled:opacity-50">Crear</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* A quién va dirigido (etiquetas, combinable, colores por categoría). */}
        <div>
          <label className="mb-1 block px-1 text-[0.68rem] font-medium uppercase tracking-wide text-graysage">Dirigido a</label>
          <AudiencePicker value={newAudience} onChange={setNewAudience} roles={roleOptions} teams={teamOptions} ages={ageOptions} />
        </div>

        {/* Equipos participantes del servicio (distinto de "dirigido a"). */}
        {teamOptions.length > 0 && (
          <div>
            <label className="mb-1 block px-1 text-[0.68rem] font-medium uppercase tracking-wide text-graysage">Equipos participantes</label>
            <div className="flex flex-wrap gap-1.5">
              {teamOptions.map((t) => {
                const on = newTeamIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setNewTeamIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${on ? 'bg-sage text-white' : 'bg-cream text-graysage hover:bg-sage-light/60'}`}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        </>
        )}
      </aside>

      {/* ===== Principal ===== */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goToday} className="rounded-lg border border-graysage/25 px-2.5 py-1 text-xs text-graysage hover:bg-cream">Hoy</button>
            <span className="font-serif text-base font-semibold capitalize text-charcoal">
              {view === 'month' ? cap(monthCursor.toLocaleDateString('es', { month: 'long', year: 'numeric' })) : cap(leftDate.toLocaleDateString('es', { month: 'long', year: 'numeric' }))}
            </span>
            {view !== 'month' && <span className="text-xs text-graysage">· arrastra para moverte</span>}
          </div>
          <div className="flex items-center gap-2">
            {view === 'expanded' && (
              <div className="flex items-center gap-1 text-xs text-graysage">
                <span className="hidden sm:inline">Jornada</span>
                <select
                  value={startH}
                  onChange={(e) => { const v = Number(e.target.value); setStartH(v); if (v >= endH) setEndH(Math.min(24, v + 1)) }}
                  className="rounded-lg border border-graysage/25 bg-white px-1.5 py-1 tabular-nums"
                >
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
                </select>
                <span>–</span>
                <select
                  value={endH}
                  onChange={(e) => { const v = Number(e.target.value); setEndH(v); if (v <= startH) setStartH(Math.max(0, v - 1)) }}
                  className="rounded-lg border border-graysage/25 bg-white px-1.5 py-1 tabular-nums"
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center gap-1 rounded-xl border border-graysage/20 p-0.5">
              <button type="button" onClick={() => setView('compact')} className={toggleCls('compact')}>Compacto</button>
              <button type="button" onClick={() => setView('expanded')} className={toggleCls('expanded')}>Ampliado</button>
              <button type="button" onClick={() => setView('month')} className={toggleCls('month')}>Mes</button>
            </div>
          </div>
        </div>

        {view === 'month' ? (
          <MonthAgenda cursor={monthCursor} today={today} recurring={recurring} onPick={(d) => { setView('expanded'); requestAnimationFrame(() => { scrollToDate(d); syncLeft() }) }} onNewAt={onNewAt} />
        ) : view === 'compact' ? (
          /* ---- TIRA COMPACTA ---- */
          <div className="relative">
          <div ref={scrollRef} onScroll={syncLeft} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="cursor-grab touch-none select-none overflow-x-auto [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden">
            <style>{AGENDA_SHRINK_CSS}</style>
            <div className="flex gap-2 pb-1" style={{ width: days.length * (colW + 8) }}>
              {days.map((d, i) => {
                const { timed, allDay } = dayData(d)
                const acts = [
                  ...allDay.map((r) => ({ id: r.id, color: r.color, name: r.name, t: null as string | null, recurring: !r.onDate })),
                  ...timed.map((b) => ({ id: b.id, color: b.color, name: b.title, t: fmtMin(b.startMin), recurring: b.recurring })),
                ]
                const isToday = sameDay(d, today)
                const isSel = selDay === i
                const isTarget = (dropTarget?.dayIdx === i) || (cDrag?.target?.kind === 'day' && cDrag.target.dayIdx === i)
                const ringC = isSel || isTarget ? 'ring-2 ring-sage-dark' : isToday ? 'ring-2 ring-sage' : 'border border-black/5'
                return (
                  <div key={i} style={{ width: colW, height: COMPACT_H, animation: 'agendaShrink .7s cubic-bezier(.22,1,.36,1)' }} className={`relative flex origin-top flex-col overflow-hidden rounded-xl bg-white shadow-sm transition-transform duration-200 ${ringC} ${isSel ? 'z-10 scale-[1.05]' : 'hover:z-10 hover:scale-[1.05]'}`}>
                    <button type="button" data-sel onClick={() => { setEditInline(null); setSelDay(isSel ? null : i) }} className="shrink-0 bg-charcoal px-2.5 py-2 text-left" title="Seleccionar día">
                      <span className={`text-[0.7rem] font-medium uppercase ${dowText(d)}`}>{WD_SHORT[(d.getDay() + 6) % 7]}</span>{' '}
                      <span className={`text-base font-bold ${dowText(d)}`}>{d.getDate()}</span>
                    </button>
                    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]" onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'empty', date: d }) }}>
                      {acts.length === 0 && <p className="py-1 text-center text-[0.62rem] text-graysage/40">—</p>}
                      {acts.map((a) => (
                        <div
                          key={a.id}
                          data-block
                          onPointerDown={cDown(a, i)}
                          onPointerMove={cMove}
                          onPointerUp={cUp}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'activity', id: a.id }) }}
                          style={{ backgroundColor: soft(a.color, 0.65), borderLeft: `4px solid ${soft(a.color, 0.2)}` }}
                          className={`group relative flex min-h-[48px] w-full touch-none flex-col gap-0.5 rounded-md px-2 py-1.5 text-left active:cursor-grabbing ${cDrag?.id === a.id ? 'opacity-40' : 'cursor-grab'}`}
                        >
                          <span className="truncate text-[0.72rem] font-medium leading-tight text-charcoal">{a.name}</span>
                          {/* hora a la izquierda y recurrencia (verde/gris) en la esquina inferior derecha */}
                          <span className="mt-auto flex items-center gap-1">
                            {a.t && <span className="text-[0.6rem] leading-none text-graysage">{a.t}</span>}
                            <button
                              data-block
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); onToggleRecurring?.(a.id, d, a.recurring) }}
                              className={`ml-auto flex h-4 w-4 items-center justify-center rounded text-[0.62rem] leading-none transition ${a.recurring ? 'bg-sage-dark text-white' : 'bg-white text-graysage shadow-sm'}`}
                              title={a.recurring ? 'Recurrente — tocar para hacerla puntual' : 'Puntual — tocar para repetir cada semana'}
                            >↻</button>
                          </span>
                        </div>
                      ))}
                      <button data-add type="button" onClick={() => onNewAt?.(d)} className="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-graysage hover:bg-cream" title="Nueva actividad">+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {/* panel del día seleccionado: regla de horas HORIZONTAL (horas abajo) con
              las actividades por horario. Al abrir una actividad, la regla se reajusta
              a su ventana y debajo aparece su línea de tiempo del servicio. */}
          {selDay != null && days[selDay] && (() => {
            const sd = days[selDay]
            const { timed } = dayData(sd)
            const aStart = hMin * 60, aEnd = hMax * 60
            const span = Math.max(1, aEnd - aStart)
            const xPct = (min: number) => `${((min - aStart) / span) * 100}%`
            const hoursArr: number[] = []
            for (let h = Math.ceil(aStart / 60); h <= Math.floor(aEnd / 60); h++) hoursArr.push(h)
            const lanes = Math.max(1, ...timed.map((b) => b.lanes))
            const laneH = 30
            return (
              <div className="mt-3 w-full rounded-2xl border border-sage/30 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-serif text-base font-semibold capitalize text-charcoal">{cap(sd.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
                  <button type="button" onClick={() => (renderDayEditor ? setEditInline({ id: null }) : onNewAt?.(sd))} className="rounded-lg border border-sage/40 px-2 py-0.5 text-xs text-sage-dark hover:bg-sage/10">+ Actividad</button>
                  <button type="button" onClick={() => setSelDay(null)} className="ml-auto rounded-lg px-2 py-0.5 text-sm text-graysage hover:bg-cream" title="Cerrar">✕</button>
                </div>

                {/* pista horizontal del día: arrastra para mover / bordes para redimensionar; clic abre el editor */}
                <div data-daytrack className="relative w-full overflow-hidden" style={{ height: lanes * laneH + 6 }} onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'empty', date: sd }) }}>
                  {hoursArr.map((h) => <div key={h} style={{ left: xPct(h * 60) }} className="pointer-events-none absolute inset-y-0 border-l border-black/5" />)}
                  {timed.length === 0 && <div className="absolute inset-0 flex items-center text-sm text-graysage/60">Sin actividades. Usa «+ Actividad».</div>}
                  {timed.map((b) => {
                    const bs = dayBlock?.id === b.id ? dayBlock.startMin : b.startMin
                    const be = dayBlock?.id === b.id ? dayBlock.endMin : b.endMin
                    return (
                      <div
                        key={b.id}
                        onPointerDown={dayDown({ id: b.id, startMin: b.startMin, endMin: b.endMin }, 'move')}
                        onPointerMove={dayMove}
                        onPointerUp={dayUp}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'activity', id: b.id }) }}
                        style={{ left: xPct(bs), width: `calc(${((be - bs) / span) * 100}% - 2px)`, top: b.lane * laneH, height: laneH - 4, backgroundColor: soft(b.color, 0.65) }}
                        className={`group absolute cursor-grab touch-none overflow-hidden rounded-md text-center leading-[26px] transition hover:brightness-95 active:cursor-grabbing ${editInline?.id === b.id ? 'ring-2 ring-sage-dark' : ''}`}
                        title={`${b.title} · ${fmtMin(bs)}–${fmtMin(be)}`}
                      >
                        <span onPointerDown={dayDown({ id: b.id, startMin: b.startMin, endMin: b.endMin }, 'l')} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-charcoal/10 opacity-0 group-hover:opacity-100" title="Inicio" />
                        <span className="pointer-events-none block truncate px-2 text-[0.7rem] font-medium text-charcoal">{b.title}</span>
                        <span onPointerDown={dayDown({ id: b.id, startMin: b.startMin, endMin: b.endMin }, 'r')} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-charcoal/10 opacity-0 group-hover:opacity-100" title="Fin" />
                      </div>
                    )
                  })}
                </div>

                {/* regla de horas (abajo) */}
                <div className="relative mt-1 h-5 w-full border-t border-black/5">
                  {hoursArr.map((h) => (
                    <div key={h} style={{ left: xPct(h * 60) }} className="absolute top-0 -translate-x-1/2">
                      <div className="mx-auto h-1.5 w-px bg-graysage/50" />
                      <span className="mt-0.5 block text-[0.58rem] tabular-nums text-graysage">{fmtHourShort(h)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
          {/* editor de actividad: se despliega DEBAJO del recuadro del día, que sigue visible */}
          {selDay != null && days[selDay] && editInline && renderDayEditor && (
            <div className="mt-3 w-full rounded-2xl border border-sage/30 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <button type="button" onClick={() => setEditInline(null)} className="rounded-lg px-1.5 py-0.5 text-sm text-graysage hover:bg-cream" title="Volver">←</button>
                <span className="font-serif text-base font-semibold text-charcoal">{editInline.id ? 'Editar actividad' : 'Nueva actividad'}</span>
                <button type="button" onClick={() => setEditInline(null)} className="ml-auto rounded-lg px-2 py-0.5 text-sm text-graysage hover:bg-cream" title="Cerrar">✕</button>
              </div>
              {renderDayEditor({ date: days[selDay], activityId: editInline.id, onClose: () => setEditInline(null), leftSlot: leftSlotEl })}
            </div>
          )}
          </div>
        ) : (
          /* ---- TIRA AMPLIADA (tarjetas separadas que crecen hacia abajo) ---- */
          <div ref={scrollRef} onScroll={syncLeft} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="max-h-[640px] cursor-grab touch-none select-none overflow-auto [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden">
            <style>{AGENDA_GROW_CSS}</style>
            <div className="relative flex pb-1" style={{ width: GUTTER + days.length * colW }}>
              {/* regla de horas (fija a la izquierda). Arrastrar vertical = zoom. */}
              <div data-ruler onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} onPointerCancel={onRulerUp} className="sticky left-0 z-20 shrink-0 cursor-ns-resize touch-none bg-white" style={{ width: GUTTER }} title="Arrastra arriba/abajo para hacer zoom">
                <div style={{ height: HEADER_H }} />
                <div className="relative origin-top" style={{ height: gridH, animation: 'agendaGrow .45s cubic-bezier(.22,1,.36,1)' }}>
                  {hours.map((h) => (
                    <div key={h} style={{ top: yOf(h * 60) }} className="absolute right-1.5 -translate-y-1/2 text-[0.6rem] tabular-nums text-graysage">{fmtHourShort(h)}</div>
                  ))}
                </div>
              </div>
              {/* tarjetas de día (mismo estilo que el modo reducido, ampliadas) */}
              {days.map((d, i) => {
                const { timed } = dayData(d)
                const isToday = sameDay(d, today)
                const ring = dropTarget?.dayIdx === i ? 'ring-2 ring-sage-dark' : isToday ? 'ring-2 ring-sage' : 'border border-black/5'
                return (
                  <div key={i} className="shrink-0 px-1" style={{ width: colW }}>
                    <div className={`overflow-hidden rounded-xl bg-white shadow-sm ${ring}`}>
                      <div className="flex items-center gap-1.5 bg-charcoal px-2.5" style={{ height: HEADER_H }}>
                        <span className={`text-[0.7rem] font-medium uppercase ${dowText(d)}`}>{WD_SHORT[(d.getDay() + 6) % 7]}</span>
                        <span className={`text-base font-bold ${dowText(d)}`}>{d.getDate()}</span>
                      </div>
                      <div className="relative origin-top cursor-pointer" style={{ height: gridH, animation: 'agendaGrow .45s cubic-bezier(.22,1,.36,1)' }} onClick={onSlotClick(d)} onContextMenu={(e) => { if ((e.target as HTMLElement).closest('[data-block]')) return; e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'empty', date: d }) }}>
                      {hours.map((h) => <div key={h} style={{ top: yOf(h * 60) }} className="pointer-events-none absolute inset-x-0 border-t border-black/5" />)}
                      {timed.map((b) => {
                        const top = yOf(b.startMin), hh = Math.max(20, yOf(b.endMin) - top), w = 100 / b.lanes
                        const dragging = blockDrag?.id === b.id
                        return (
                          <div
                            key={b.id}
                            data-block
                            onPointerDown={onBlockDown(b, i, 'move')}
                            onPointerMove={onBlockMove}
                            onPointerUp={onBlockUp}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'activity', id: b.id }) }}
                            style={{ top, height: hh, left: `calc(${b.lane * w}% + 2px)`, width: `calc(${w}% - 4px)`, backgroundColor: soft(b.color, 0.65), borderLeft: `3px solid ${soft(b.color, 0.2)}` }}
                            className={`group absolute touch-none select-none overflow-hidden rounded-md text-left transition active:cursor-grabbing ${dragging ? 'opacity-30' : 'cursor-grab hover:brightness-95'}`}
                            title={b.title}
                          >
                            <div data-block onPointerDown={onBlockDown(b, i, 'top')} className="absolute inset-x-0 top-0 h-2 cursor-ns-resize" />
                            <div className="pointer-events-none px-1.5 py-1">
                              <span className="block truncate text-[0.7rem] font-semibold leading-tight text-charcoal">{b.title}</span>
                              <span className="flex items-center gap-1 truncate text-[0.6rem] leading-tight text-graysage">{b.recurring && <span title="Se repite cada semana">↻</span>}{fmtMin(b.startMin)} – {fmtMin(b.endMin)}</span>
                              {b.responsibles && hh > 50 && <span className="block truncate text-[0.58rem] leading-tight text-graysage">{b.responsibles}</span>}
                            </div>
                            <div data-block onPointerDown={onBlockDown(b, i, 'bottom')} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" />
                            {/* recurrencia (al pasar el cursor); copiar/eliminar por clic derecho */}
                            <div className="absolute right-0.5 top-0.5 hidden group-hover:block">
                              <button data-block onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleRecurring?.(b.id, d, b.recurring) }} className={`flex h-4 w-4 items-center justify-center rounded text-[0.65rem] leading-none shadow-sm ${b.recurring ? 'bg-sage-dark text-white' : 'bg-white text-graysage'}`} title={b.recurring ? 'Recurrente — tocar para hacerla puntual' : 'Puntual — tocar para repetir cada semana'}>↻</button>
                            </div>
                          </div>
                        )
                      })}
                      {dropTarget && dropTarget.dayIdx === i && dropTarget.startMin >= 0 && (
                        <div
                          className="pointer-events-none absolute left-0.5 right-0.5 rounded-md border-2 border-dashed"
                          style={{ top: yOf(dropTarget.startMin), height: PPH, borderColor: dragColor ?? '#5CA27B', backgroundColor: withAlpha(dragColor ?? '#88C0A4', 0.3) }}
                        >
                          <span className="block px-1.5 py-1 text-[0.6rem] font-semibold" style={{ color: dragColor ?? '#5CA27B' }}>{fmtMin(dropTarget.startMin)}</span>
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* previsualización del bloque mientras se mueve/redimensiona */}
              {blockDrag && (
                <div
                  className="pointer-events-none absolute z-30 overflow-hidden rounded-md border-2 shadow-sm"
                  style={{ left: GUTTER + blockDrag.dayIdx * colW + 6, top: HEADER_H + yOf(blockDrag.startMin), width: colW - 14, height: Math.max(20, yOf(blockDrag.endMin) - yOf(blockDrag.startMin)), borderColor: blockDrag.color, backgroundColor: withAlpha(blockDrag.color, 0.3) }}
                >
                  <span className="block px-1.5 py-1 text-[0.6rem] font-semibold text-charcoal">{fmtMin(blockDrag.startMin)} – {fmtMin(blockDrag.endMin)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* previsualización al arrastrar "Nueva actividad" */}
      {ghost && (
        <div style={{ left: ghost.x, top: ghost.y }} className={`pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-lg transition-transform ${ghost.over ? 'scale-110 bg-sage-dark text-white' : 'scale-100 bg-white text-charcoal ring-1 ring-black/10'}`}>
          + Nueva actividad
        </div>
      )}
      {cDrag && (
        <div style={{ left: cDrag.x, top: cDrag.y, backgroundColor: soft(cDrag.color, 0.55), borderLeft: `3px solid ${soft(cDrag.color, 0.2)}` }} className="pointer-events-none fixed z-[80] max-w-[160px] -translate-x-1/2 -translate-y-1/2 truncate rounded-md px-2 py-1 text-[0.72rem] font-medium text-charcoal shadow-lg">
          {cDrag.name}
        </div>
      )}

      {/* menú al soltar en otro día: Mover / Copiar */}
      {dropMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setDropMenu(null)} onContextMenu={(e) => { e.preventDefault(); setDropMenu(null) }} />
          <div style={{ left: dropMenu.x, top: dropMenu.y }} className="fixed z-[91] min-w-28 -translate-x-1/2 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-xl">
            <button type="button" onClick={() => { const m = dropMenu; setDropMenu(null); if (m.startMin != null) onBlockChange?.(m.id, { date: m.date, startMin: m.startMin, endMin: m.endMin ?? m.startMin, toOneOff: true }); else onMoveToDay?.(m.id, m.date) }} className="block w-full px-3 py-1.5 text-left text-charcoal hover:bg-cream">Mover aquí</button>
            <button type="button" onClick={() => { const m = dropMenu; setDropMenu(null); onDuplicate?.(m.id, m.date) }} className="block w-full px-3 py-1.5 text-left text-charcoal hover:bg-cream">Copiar aquí</button>
          </div>
        </>
      )}

      {/* menú contextual (clic derecho): Copiar/Eliminar en actividad; Pegar en vacío */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div style={{ left: ctxMenu.x, top: ctxMenu.y }} className="fixed z-[91] min-w-28 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-xl">
            {ctxMenu.kind === 'activity' ? (
              <>
                <button type="button" onClick={() => { if (ctxMenu.id) setClip(ctxMenu.id); setCtxMenu(null) }} className="block w-full px-3 py-1.5 text-left text-charcoal hover:bg-cream">Copiar</button>
                <button type="button" onClick={() => { if (ctxMenu.id) onDeleteBlock?.(ctxMenu.id); setCtxMenu(null) }} className="block w-full px-3 py-1.5 text-left text-clay hover:bg-cream">Eliminar</button>
              </>
            ) : (
              <button type="button" disabled={!clip} onClick={() => { if (clip && ctxMenu.date) onDuplicate?.(clip, ctxMenu.date); setCtxMenu(null) }} className="block w-full px-3 py-1.5 text-left text-charcoal hover:bg-cream disabled:opacity-40">Pegar{clip ? '' : ' (nada copiado)'}</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---- Mini-mes ----
function MiniMonth({ cursor, setCursor, today, inRange, onPick }: { cursor: Date; setCursor: (d: Date) => void; today: Date; inRange: (d: Date) => boolean; onPick: (d: Date) => void }) {
  const y = cursor.getFullYear(), mo = cursor.getMonth()
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7
  const last = new Date(y, mo + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((lead + last) / 7) * 7 }, (_, i) => { const dn = i - lead + 1; return dn >= 1 && dn <= last ? new Date(y, mo, dn) : null })
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-serif text-sm font-semibold capitalize text-charcoal">{cap(cursor.toLocaleDateString('es', { month: 'long', year: 'numeric' }))}</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setCursor(addMonths(cursor, -1))} className="rounded px-1.5 text-graysage hover:bg-cream">‹</button>
          <button type="button" onClick={() => setCursor(addMonths(cursor, 1))} className="rounded px-1.5 text-graysage hover:bg-cream">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {MONTH_DOW.map((d, i) => <span key={i} className={`text-[0.62rem] font-medium ${i === 6 ? 'text-clay' : 'text-graysage/70'}`}>{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const isToday = sameDay(d, today), sel = inRange(d), sun = d.getDay() === 0
          return (
            <button key={i} type="button" onClick={() => onPick(d)} className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[0.72rem] transition ${isToday ? 'bg-sage-dark font-semibold text-white' : sel ? 'bg-sage-light text-sage-dark' : sun ? 'text-clay hover:bg-cream' : 'text-charcoal hover:bg-cream'}`}>{d.getDate()}</button>
          )
        })}
      </div>
    </div>
  )
}

// ---- Vista Mes ----
function MonthAgenda({ cursor, today, recurring, onPick, onNewAt }: { cursor: Date; today: Date; recurring: RecSchedule[]; onPick: (d: Date) => void; onNewAt?: (d: Date, t?: string) => void }) {
  const y = cursor.getFullYear(), mo = cursor.getMonth()
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7
  const last = new Date(y, mo + 1, 0).getDate()
  const rows = Math.ceil((lead + last) / 7)
  const cells = Array.from({ length: rows * 7 }, (_, i) => { const dn = i - lead + 1; return dn >= 1 && dn <= last ? new Date(y, mo, dn) : null })
  const actsOf = (d: Date) => recurring.filter((r) => occursOn(r, d)).sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime))
  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-black/5 bg-cream/40">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d, i) => <div key={i} className={`py-1.5 text-center text-[0.68rem] font-medium ${i === 6 ? 'text-clay' : 'text-graysage'}`}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7" style={{ gridAutoRows: 'minmax(96px, 1fr)' }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="border-b border-l border-black/5 bg-cream/20" />
          const isToday = sameDay(d, today), sun = d.getDay() === 0, acts = actsOf(d)
          return (
            <div key={i} className="group relative cursor-pointer border-b border-l border-black/5 p-1" onClick={() => onPick(d)}>
              <div className="mb-0.5 flex items-center justify-between px-0.5">
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.7rem] ${isToday ? 'bg-sage-dark font-semibold text-white' : sun ? 'text-clay' : 'text-charcoal'}`}>{d.getDate()}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); onNewAt?.(d) }} className="hidden h-4 w-4 items-center justify-center rounded-full text-graysage hover:bg-cream group-hover:flex" title="Nueva actividad">+</button>
              </div>
              <div className="space-y-0.5">
                {acts.slice(0, 3).map((r) => (
                  <div key={r.id} style={{ backgroundColor: withAlpha(r.color, 0.16), borderLeft: `3px solid ${r.color}` }} className="truncate rounded px-1 py-0.5 text-[0.62rem] leading-tight text-charcoal">{r.startTime ? `${fmtMin(minutesOf(r.startTime))} ` : ''}{r.name}</div>
                ))}
                {acts.length > 3 && <div className="px-1 text-[0.6rem] text-graysage">+{acts.length - 3} más</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
