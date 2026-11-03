import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
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
const PPH = 46 // px por hora (vista ampliada)
const COL_W = 180 // ancho de columna de día (ampliada)
const COL_W_C = 170 // ancho de tarjeta de día (compacta)
const GUTTER = 52 // ancho del eje de horas
const HEADER_H = 52 // alto de la cabecera de día
const MAX_LANES = 2 // actividades lado a lado antes de agruparlas en "+N"
const RANGE_BACK = 45 // días hacia atrás desde hoy
const RANGE_DAYS = 400 // total de días en la tira

function withAlpha(hex: string, a: number): string {
  const h = (hex || '#94a3b8').replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return `rgba(${parseInt(n.slice(0, 2), 16) || 0}, ${parseInt(n.slice(2, 4), 16) || 0}, ${parseInt(n.slice(4, 6), 16) || 0}, ${a})`
}
// Tarjeta plana teñida con el color de la actividad.
const glassCard = (color: string) => ({
  backgroundColor: withAlpha(color, 0.14),
  border: `1px solid ${withAlpha(color, 0.3)}`,
})
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const minutesOf = (t: string | null) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const fmtMin = (min: number) => { let h = Math.floor(min / 60); const m = min % 60; const ap = h < 12 ? 'a.m.' : 'p.m.'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}` }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function AgendaView({
  recurring,
  typeOptions = [],
  teamOptions = [],
  roleOptions = [],
  ageOptions = [],
  onEdit,
  onNewAt,
  onDropNew,
  onMoveActivity,
}: {
  recurring: RecSchedule[]
  typeOptions?: TypeOpt[]
  teamOptions?: TeamOpt[]
  roleOptions?: RoleOpt[]
  ageOptions?: AgeOpt[]
  onEdit?: (id: string) => void
  onNewAt?: (date: Date, startTime?: string) => void
  onDropNew?: (date: Date, startTime?: string, attrs?: NewActivityAttrs) => void
  // Mover una tarjeta existente: nuevo día y, en la vista ampliada, nueva hora
  // de inicio (null = conservar la hora).
  onMoveActivity?: (id: string, date: Date, startTime: string | null) => void
}) {
  const today = startOfDay(new Date())
  const rangeStart = addDays(today, -RANGE_BACK)
  const [view, setView] = useState<View>('expanded')
  const [monthCursor, setMonthCursor] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1))
  const [leftDate, setLeftDate] = useState<Date>(today) // día más a la izquierda visible (para resaltar en el mini-mes)
  const [ghost, setGhost] = useState<{ x: number; y: number; over: boolean; label?: string; color?: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ dayIdx: number; startMin: number } | null>(null)
  const cardDrag = useRef<{ x0: number; y0: number; moved: boolean } | null>(null)
  // Tarjeta existente que se está moviendo (y dónde caería).
  const blockDrag = useRef<{ id: string; x0: number; y0: number; offMin: number; dur: number; title: string; color: string; moved: boolean } | null>(null)
  const [moving, setMoving] = useState<{ id: string; dayIdx: number; startMin: number; dur: number; title: string; color: string } | null>(null)
  // atributos actuales de la tarjeta "Nueva actividad" (elegidos inline)
  const [newTypeId, setNewTypeId] = useState<string | null>(typeOptions[0]?.id ?? null)
  const [newTeamIds, setNewTeamIds] = useState<string[]>([])
  const [newAudience, setNewAudience] = useState<Audience>({ ...AUDIENCE_ALL })
  const selType = typeOptions.find((t) => t.id === newTypeId) ?? null
  const dragColor = selType?.color ?? null

  const scrollRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ sl: number; x: number; lastX: number; lastT: number; v: number } | null>(null)
  const momentum = useRef<number | null>(null)
  const animScroll = useRef<number | null>(null)
  const panMoved = useRef(false)

  const days = Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i))
  const colW = view === 'compact' ? COL_W_C : COL_W

  // Bloques/actividades por día. Los carriles se calculan por GRUPO de choques
  // (actividades que se pisan entre sí): una actividad sola usa todo el ancho.
  // Si un grupo necesita más de MAX_LANES carriles, el primero se muestra y el
  // resto se junta en una tarjeta "+N actividades" que abre la lista.
  interface Block { id: string; startMin: number; endMin: number; title: string; color: string; responsibles?: string | null; lane: number; lanes: number }
  interface Stack { key: string; startMin: number; endMin: number; items: Block[] }
  const dayData = (d: Date) => {
    const all: Block[] = []
    const allDay: RecSchedule[] = []
    for (const r of recurring) {
      if (!occursOn(r, d)) continue
      if (!r.startTime) { allDay.push(r); continue }
      const s = minutesOf(r.startTime)
      const e = r.endTime ? Math.max(minutesOf(r.endTime), s + 20) : s + 60
      all.push({ id: r.id, startMin: s, endMin: e, title: r.name, color: r.color, responsibles: r.responsibles, lane: 0, lanes: 1 })
    }
    all.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    const timed: Block[] = []
    const stacks: Stack[] = []
    const flush = (group: Block[]) => {
      if (!group.length) return
      const laneEnd: number[] = []
      for (const b of group) { let L = 0; while (L < laneEnd.length && laneEnd[L] > b.startMin) L++; b.lane = L; laneEnd[L] = b.endMin }
      if (laneEnd.length <= MAX_LANES) {
        for (const b of group) { b.lanes = laneEnd.length; timed.push(b) }
        return
      }
      const rest = group.filter((b) => b.lane > 0)
      for (const b of group) if (b.lane === 0) { b.lanes = 2; timed.push(b) }
      stacks.push({ key: rest[0].id, startMin: Math.min(...rest.map((b) => b.startMin)), endMin: Math.max(...rest.map((b) => b.endMin)), items: rest })
    }
    let group: Block[] = [], groupEnd = -1
    for (const b of all) {
      if (b.startMin >= groupEnd) { flush(group); group = []; groupEnd = -1 }
      group.push(b); groupEnd = Math.max(groupEnd, b.endMin)
    }
    flush(group)
    return { timed, stacks, allDay }
  }
  // Lista abierta de una tarjeta "+N actividades" (posición en pantalla).
  const [openStack, setOpenStack] = useState<{ items: Block[]; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!openStack) return
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.('[data-stack-pop]')) setOpenStack(null) }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenStack(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', close, true) }
  }, [openStack])

  // Rango horario (vista ampliada): encaja todas las actividades con hora.
  let hMin = 7, hMax = 20
  for (const r of recurring) { if (!r.startTime) continue; hMin = Math.min(hMin, Math.floor(minutesOf(r.startTime) / 60)); const e = r.endTime ? minutesOf(r.endTime) : minutesOf(r.startTime) + 60; hMax = Math.max(hMax, Math.ceil(e / 60)) }
  hMin = Math.max(0, hMin); hMax = Math.min(24, hMax)
  const hours = Array.from({ length: hMax - hMin + 1 }, (_, i) => hMin + i)
  const gridH = (hMax - hMin) * PPH
  const yOf = (min: number) => ((min - hMin * 60) / 60) * PPH

  // ----- navegación por arrastre (horizontal) + inercia -----
  const idxOf = (d: Date) => Math.round((startOfDay(d).getTime() - rangeStart.getTime()) / 86400000)
  const scrollToDate = (d: Date) => { const el = scrollRef.current; if (el) el.scrollLeft = Math.max(0, idxOf(d) * colW - 8) }
  useLayoutEffect(() => { scrollToDate(today); syncLeft() }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncLeft = () => { const el = scrollRef.current; if (!el) return; setLeftDate(addDays(rangeStart, Math.floor(el.scrollLeft / colW))) }

  // animación suave de scroll horizontal + imán al lunes
  const animateScrollTo = (target: number, dur = 600) => {
    const el = scrollRef.current; if (!el) return
    if (animScroll.current) cancelAnimationFrame(animScroll.current)
    const start = el.scrollLeft, dist = target - start, t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (now: number) => { const t = Math.min(1, (now - t0) / dur); el.scrollLeft = start + dist * ease(t); if (t < 1) animScroll.current = requestAnimationFrame(step); else { animScroll.current = null; syncLeft() } }
    animScroll.current = requestAnimationFrame(step)
  }
  const magnetMonday = () => {
    const el = scrollRef.current; if (!el) return
    const leftF = el.scrollLeft / colW
    const base = Math.round(leftF)
    const leftD = addDays(rangeStart, base)
    let mIdx = base - ((leftD.getDay() + 6) % 7)
    if (Math.abs(mIdx + 7 - leftF) < Math.abs(mIdx - leftF)) mIdx += 7
    const target = Math.max(0, mIdx * colW)
    if (Math.abs(target - el.scrollLeft) > 1) animateScrollTo(target, 600)
  }

  const onDown = (e: RPointerEvent) => {
    const el = scrollRef.current; if (!el) return
    if ((e.target as HTMLElement).closest('[data-block],[data-add]')) return // no robar clics de bloques/+
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
    let v = p.v * 0.7, pos = el.scrollLeft, last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(48, now - last); last = now
      v *= Math.pow(0.95, dt / 16)
      if (Math.abs(v) < 0.01) { momentum.current = null; magnetMonday(); return }
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
  // Al arrastrar cerca del borde izquierdo/derecho de la tira, se desplaza sola.
  const edgeScroll = (x: number) => {
    const el = scrollRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    if (x < r.left + 48) el.scrollLeft -= 14
    else if (x > r.right - 48) el.scrollLeft += 14
  }
  const attrs = (): NewActivityAttrs => ({ typeId: newTypeId, teamIds: newTeamIds, audience: newAudience })
  const onCardDown = (e: RPointerEvent) => { cardDrag.current = { x0: e.clientX, y0: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  const onCardMove = (e: RPointerEvent) => {
    const d = cardDrag.current; if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return
    d.moved = true
    edgeScroll(e.clientX)
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

  // ----- mover una tarjeta existente -----
  // Día + hora de inicio (cada 15 min) donde caería la tarjeta, respetando el
  // punto por donde se agarró (offMin) y su duración. startMin -1 = conservar hora.
  const moveTargetAt = (x: number, y: number, offMin: number, dur: number): { dayIdx: number; startMin: number } | null => {
    const el = scrollRef.current; if (!el) return null
    const r = el.getBoundingClientRect()
    if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return null
    const cx = x - r.left + el.scrollLeft
    if (view === 'compact') { const idx = Math.floor(cx / (colW + 8)); return idx >= 0 && idx < days.length ? { dayIdx: idx, startMin: -1 } : null }
    const idx = Math.floor((cx - GUTTER) / colW)
    if (idx < 0 || idx >= days.length) return null
    const cy = y - r.top + el.scrollTop - HEADER_H
    const raw = hMin * 60 + (cy / PPH) * 60 - offMin
    return { dayIdx: idx, startMin: Math.max(hMin * 60, Math.min(hMax * 60 - Math.min(dur, 60), Math.round(raw / 15) * 15)) }
  }
  const onBlockDown = (e: RPointerEvent, b: { id: string; startMin: number; endMin: number; title: string; color: string }) => {
    if (!onMoveActivity || e.button !== 0) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const offMin = view === 'compact' ? 0 : ((e.clientY - rect.top) / PPH) * 60
    blockDrag.current = { id: b.id, x0: e.clientX, y0: e.clientY, offMin, dur: b.endMin - b.startMin, title: b.title, color: b.color, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onBlockMove = (e: RPointerEvent) => {
    const d = blockDrag.current; if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return
    d.moved = true
    edgeScroll(e.clientX)
    const t = moveTargetAt(e.clientX, e.clientY, d.offMin, d.dur)
    setMoving(t ? { id: d.id, dayIdx: t.dayIdx, startMin: t.startMin, dur: d.dur, title: d.title, color: d.color } : null)
    if (view === 'compact') setGhost({ x: e.clientX, y: e.clientY, over: !!t, label: d.title, color: d.color })
  }
  const onBlockUp = (e: RPointerEvent) => {
    const d = blockDrag.current; blockDrag.current = null; setMoving(null); setGhost(null)
    if (!d) return
    if (!d.moved) { onEdit?.(d.id); return }
    const t = moveTargetAt(e.clientX, e.clientY, d.offMin, d.dur)
    if (t) onMoveActivity?.(d.id, addDays(rangeStart, t.dayIdx), t.startMin >= 0 ? hhmm(t.startMin) : null)
  }
  const onBlockCancel = () => { blockDrag.current = null; setMoving(null); setGhost(null) }
  // Handlers de una tarjeta. El clic con teclado (detail 0) sigue abriendo la edición.
  const blockProps = (b: { id: string; startMin: number; endMin: number; title: string; color: string }) => ({
    onPointerDown: (e: RPointerEvent) => onBlockDown(e, b),
    onPointerMove: onBlockMove,
    onPointerUp: onBlockUp,
    onPointerCancel: onBlockCancel,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (e.detail === 0 || !onMoveActivity) onEdit?.(b.id) },
  })

  const goToday = () => { scrollToDate(today); syncLeft() }
  const toggleCls = (v: View) => `rounded-lg px-3 py-1 text-xs font-medium transition ${view === v ? 'bg-white text-sage-dark shadow-sm' : 'text-graysage hover:bg-white/60'}`

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
        <MiniMonth cursor={monthCursor} setCursor={setMonthCursor} today={today} inRange={inRange} onPick={(d) => { setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1)); if (view === 'month') setView('expanded'); requestAnimationFrame(() => { scrollToDate(d); syncLeft() }) }} />
        {/* Tarjeta ÚNICA "Nueva actividad": toma el tipo y los equipos elegidos
            abajo. Al arrastrarla a la rejilla, la actividad nace con esos campos
            ya llenos (sin formulario). */}
        <div
          onPointerDown={onCardDown}
          onPointerMove={onCardMove}
          onPointerUp={onCardUp}
          className="flex w-full cursor-grab touch-none items-center gap-3 rounded-2xl border border-dashed p-4 text-left transition hover:-translate-y-0.5 active:cursor-grabbing"
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
        {typeOptions.length > 0 && (
          <div>
            <label className="mb-1 block px-1 text-[0.68rem] font-medium uppercase tracking-wide text-graysage">Tipo de servicio</label>
            <select
              value={newTypeId ?? ''}
              onChange={(e) => setNewTypeId(e.target.value || null)}
              className="tarjeta w-full rounded-xl px-3 py-2 text-sm text-charcoal outline-none focus:ring-4 focus:ring-sage-light"
            >
              <option value="">— Sin tipo —</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
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
                    className={`rounded-full px-2.5 py-1 text-xs transition ${on ? 'bg-sage-dark text-paper' : 'tarjeta text-graysage hover:bg-cream'}`}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </aside>

      {/* ===== Principal ===== */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goToday} className="tarjeta rounded-lg px-2.5 py-1 text-xs font-medium text-graysage hover:text-sage-dark">Hoy</button>
            <span className="font-serif text-base font-semibold capitalize text-charcoal">
              {view === 'month' ? cap(monthCursor.toLocaleDateString('es', { month: 'long', year: 'numeric' })) : cap(leftDate.toLocaleDateString('es', { month: 'long', year: 'numeric' }))}
            </span>
            {view !== 'month' && <span className="text-xs text-graysage">· arrastra el fondo para moverte, o una tarjeta para cambiarla de día{view === 'expanded' ? ' u hora' : ''}</span>}
          </div>
          <div className="tarjeta flex items-center gap-1 rounded-xl p-0.5">
            <button type="button" onClick={() => setView('compact')} className={toggleCls('compact')}>Compacto</button>
            <button type="button" onClick={() => setView('expanded')} className={toggleCls('expanded')}>Ampliado</button>
            <button type="button" onClick={() => setView('month')} className={toggleCls('month')}>Mes</button>
          </div>
        </div>

        {view === 'month' ? (
          <MonthAgenda cursor={monthCursor} today={today} recurring={recurring} onPick={(d) => { setView('expanded'); requestAnimationFrame(() => { scrollToDate(d); syncLeft() }) }} onNewAt={onNewAt} />
        ) : view === 'compact' ? (
          /* ---- TIRA COMPACTA ---- */
          <div ref={scrollRef} onScroll={syncLeft} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="cursor-grab touch-none select-none overflow-x-auto [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-2 pb-1" style={{ width: days.length * (colW + 8) }}>
              {days.map((d, i) => {
                const { timed, allDay } = dayData(d)
                const acts = [...allDay.map((r) => ({ id: r.id, color: r.color, name: r.name, t: null as string | null })), ...timed.map((b) => ({ id: b.id, color: b.color, name: b.title, t: `${fmtMin(b.startMin)}` }))]
                const isToday = sameDay(d, today)
                return (
                  <div key={i} style={{ width: colW }} className={`tarjeta shrink-0 overflow-hidden rounded-2xl transition ${dropTarget?.dayIdx === i || moving?.dayIdx === i ? 'ring-2 ring-sage-dark' : isToday ? 'ring-2 ring-sage' : ''}`}>
                    <div className={`px-2.5 py-2 ${isToday ? 'bg-sage-dark/90 text-white' : 'border-b border-white/70 bg-white/40 text-charcoal'}`}>
                      <span className={`text-[0.7rem] font-medium uppercase ${isToday ? 'text-white/80' : 'text-graysage'}`}>{WD_SHORT[(d.getDay() + 6) % 7]}</span>{' '}
                      <span className="text-base font-bold">{d.getDate()}</span>
                    </div>
                    <div className="space-y-1.5 p-1.5">
                      {acts.length === 0 && <p className="py-1 text-center text-[0.62rem] text-graysage/40">—</p>}
                      {acts.map((a) => (
                        <button
                          key={a.id}
                          data-block
                          type="button"
                          {...blockProps({ id: a.id, startMin: 0, endMin: 60, title: a.name, color: a.color })}
                          style={glassCard(a.color)}
                          className={`relative flex w-full touch-none items-center justify-between gap-1 rounded-lg py-1.5 pl-3 pr-1.5 text-left transition hover:-translate-y-px ${onMoveActivity ? 'cursor-grab active:cursor-grabbing' : ''} ${moving?.id === a.id ? 'opacity-40' : ''}`}
                        >
                          <span className="absolute bottom-1.5 left-1 top-1.5 w-[3px] rounded-full" style={{ backgroundColor: a.color }} />
                          <span className="truncate text-[0.72rem] font-medium text-charcoal">{a.name}</span>
                          {a.t && <span className="shrink-0 text-[0.6rem] text-graysage">{a.t}</span>}
                        </button>
                      ))}
                      <button data-add type="button" onClick={() => onNewAt?.(d)} className="mx-auto flex h-5 w-5 items-center justify-center rounded-full text-graysage hover:bg-white/80" title="Nueva actividad">+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* ---- TIRA AMPLIADA (rejilla de horas) ---- */
          <div ref={scrollRef} onScroll={syncLeft} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="tarjeta max-h-[620px] cursor-grab touch-none select-none overflow-auto rounded-2xl [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden">
            <div className="relative flex" style={{ width: GUTTER + days.length * colW }}>
              {/* eje de horas (fijo a la izquierda) */}
              <div className="sticky left-0 z-20 shrink-0 bg-white/85 backdrop-blur-md" style={{ width: GUTTER }}>
                <div className="sticky top-0 z-10 bg-white/85" style={{ height: HEADER_H }} />
                <div className="relative" style={{ height: gridH }}>
                  {hours.map((h) => (
                    <div key={h} style={{ top: yOf(h * 60) }} className="absolute right-1.5 -translate-y-1/2 text-[0.6rem] text-graysage">{fmtMin(h * 60)}</div>
                  ))}
                </div>
              </div>
              {/* columnas de día */}
              {days.map((d, i) => {
                const { timed, stacks } = dayData(d)
                const isToday = sameDay(d, today)
                const weekend = d.getDay() === 0 || d.getDay() === 6
                return (
                  <div key={i} className="shrink-0 border-l border-white/70" style={{ width: colW }}>
                    <div className={`sticky top-0 z-10 border-b border-clay-light py-2 text-center ${isToday ? 'bg-sage-light' : weekend ? 'bg-cream/90 backdrop-blur-md' : 'bg-white/85 backdrop-blur-md'}`} style={{ height: HEADER_H }}>
                      <div className="text-[0.68rem] font-medium uppercase text-graysage">{WD_SHORT[(d.getDay() + 6) % 7]}</div>
                      <div className={`text-lg font-semibold leading-none ${isToday ? 'text-sage-dark' : 'text-charcoal'}`}>{d.getDate()}</div>
                    </div>
                    <div className="relative cursor-pointer" style={{ height: gridH }} onClick={onSlotClick(d)}>
                      {hours.map((h) => <div key={h} style={{ top: yOf(h * 60) }} className="pointer-events-none absolute inset-x-0 border-t border-clay-light/60" />)}
                      {timed.map((b) => {
                        const top = yOf(b.startMin), hh = Math.max(20, yOf(b.endMin) - top), w = 100 / b.lanes
                        return (
                          <button
                            key={b.id}
                            data-block
                            type="button"
                            {...blockProps(b)}
                            style={{ top, height: hh, left: `calc(${b.lane * w}% + 3px)`, width: `calc(${w}% - 6px)`, ...glassCard(b.color) }}
                            className={`absolute touch-none overflow-hidden rounded-lg py-1 pl-3 pr-1.5 text-left transition hover:z-10 hover:-translate-y-px ${onMoveActivity ? 'cursor-grab active:cursor-grabbing' : ''} ${moving?.id === b.id ? 'opacity-40' : ''}`}
                            title={b.title}
                          >
                            <span className="absolute bottom-1 left-1 top-1 w-[3px] rounded-full" style={{ backgroundColor: b.color }} />
                            <span className="block truncate text-[0.7rem] font-semibold leading-tight text-charcoal">{b.title}</span>
                            <span className="block truncate text-[0.6rem] leading-tight text-graysage">{fmtMin(b.startMin)} – {fmtMin(b.endMin)}</span>
                            {b.responsibles && hh > 50 && <span className="block truncate text-[0.58rem] leading-tight text-graysage">{b.responsibles}</span>}
                          </button>
                        )
                      })}
                      {/* Choques de más: una sola tarjeta con el total y sus colores */}
                      {stacks.map((s) => {
                        const top = yOf(s.startMin), hh = Math.max(40, yOf(s.endMin) - top)
                        return (
                          <button
                            key={s.key}
                            data-block
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setOpenStack({ items: s.items, x: Math.min(r.left, window.innerWidth - 280), y: Math.min(r.top, window.innerHeight - 60 - s.items.length * 52) })
                            }}
                            style={{ top, height: hh, left: 'calc(50% + 3px)', width: 'calc(50% - 6px)' }}
                            className="absolute flex flex-col justify-center gap-1 overflow-hidden rounded-lg border border-charcoal/10 bg-white/85 px-2 text-left shadow-sm transition hover:z-10 hover:-translate-y-px hover:bg-white"
                            title={s.items.map((b) => b.title).join(', ')}
                          >
                            <span className="text-[0.95rem] font-bold leading-none tabular-nums text-charcoal">+{s.items.length}</span>
                            <span className="text-[0.6rem] font-medium leading-tight text-graysage">actividades</span>
                            <span className="flex flex-wrap gap-0.5">
                              {s.items.slice(0, 6).map((b) => <span key={b.id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: b.color }} />)}
                            </span>
                          </button>
                        )
                      })}
                      {/* dónde caerá la tarjeta que se está moviendo */}
                      {moving && moving.dayIdx === i && moving.startMin >= 0 && (
                        <div
                          className="pointer-events-none absolute left-[3px] right-[3px] z-20 rounded-lg border-2 border-dashed py-1 pl-2 pr-1.5 "
                          style={{ top: yOf(moving.startMin), height: Math.max(20, (moving.dur / 60) * PPH), borderColor: moving.color, backgroundColor: withAlpha(moving.color, 0.22) }}
                        >
                          <span className="block truncate text-[0.7rem] font-semibold leading-tight text-charcoal">{moving.title}</span>
                          <span className="block text-[0.6rem] font-semibold leading-tight" style={{ color: moving.color }}>{fmtMin(moving.startMin)} – {fmtMin(moving.startMin + moving.dur)}</span>
                        </div>
                      )}
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
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* lista de una tarjeta "+N actividades": cada una abre su edición */}
      {openStack && (
        <div data-stack-pop role="dialog" aria-label="Actividades a la misma hora" style={{ left: Math.max(8, openStack.x), top: Math.max(8, openStack.y) }} className="subir fixed z-[70] w-64 rounded-2xl border border-clay-light bg-paper p-1.5 shadow-[0_20px_50px_-20px_rgba(30,42,36,0.45)]">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-graysage">{openStack.items.length} a la misma hora</p>
          <ul className="max-h-80 overflow-y-auto">
            {openStack.items.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => { setOpenStack(null); onEdit?.(b.id) }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-cream">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-charcoal">{b.title}</span>
                    <span className="block text-xs text-graysage">{fmtMin(b.startMin)} – {fmtMin(b.endMin)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* previsualización al arrastrar "Nueva actividad" */}
      {ghost && (
        <div
          style={{ left: ghost.x, top: ghost.y, ...(ghost.label && ghost.color ? { borderColor: ghost.color } : {}) }}
          className={`pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-1/2 -rotate-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-transform ${ghost.label ? 'border-2 bg-white/85 text-charcoal' : ghost.over ? 'scale-110 bg-sage-dark text-white' : 'scale-100 bg-white text-charcoal ring-1 ring-black/10'} ${ghost.over ? 'scale-110' : ''}`}
        >
          {ghost.label ?? '+ Nueva actividad'}
        </div>
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
    <div className="tarjeta rounded-2xl p-3">
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
    <div className="tarjeta overflow-hidden rounded-2xl">
      <div className="grid grid-cols-7 border-b border-white/70 bg-white/40">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d, i) => <div key={i} className={`py-1.5 text-center text-[0.68rem] font-medium ${i === 6 ? 'text-clay' : 'text-graysage'}`}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7" style={{ gridAutoRows: 'minmax(96px, 1fr)' }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="border-b border-l border-white/60 bg-white/20" />
          const isToday = sameDay(d, today), sun = d.getDay() === 0, acts = actsOf(d)
          return (
            <div key={i} className="group relative cursor-pointer border-b border-l border-white/60 p-1 transition hover:bg-white/40" onClick={() => onPick(d)}>
              <div className="mb-0.5 flex items-center justify-between px-0.5">
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.7rem] ${isToday ? 'bg-sage-dark font-semibold text-white' : sun ? 'text-clay' : 'text-charcoal'}`}>{d.getDate()}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); onNewAt?.(d) }} className="hidden h-4 w-4 items-center justify-center rounded-full text-graysage hover:bg-cream group-hover:flex" title="Nueva actividad">+</button>
              </div>
              <div className="space-y-0.5">
                {acts.slice(0, 3).map((r) => (
                  <div key={r.id} style={{ ...glassCard(r.color), borderLeft: `3px solid ${r.color}` }} className="truncate rounded-md px-1 py-0.5 text-[0.62rem] leading-tight text-charcoal">{r.startTime ? `${fmtMin(minutesOf(r.startTime))} ` : ''}{r.name}</div>
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
