import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { supabase } from '../lib/supabase'
import { WEEKDAYS, WEEKDAYS_SHORT } from '../lib/activity'
import Insight from './Insight'

// Sección 4 · MEJORES NÚMEROS. La clave: un horario NO vale igual según el día
// (2pm domingo ≠ 2pm lunes). Por eso la asistencia se analiza por FRANJA = día ×
// hora, en un mapa de calor, y se destaca la mejor franja. Aparte, mejores tipos
// de actividad. Se apoya en service_attendance (starts_at + total).

const GREEN = '#5CA27B'

interface Row { starts_at: string | null; total: number; activity_name: string | null; service_name: string | null }

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'a' : 'p'; const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}${ampm}`
}

export default function BestNumbers({ churchId }: { churchId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('service_attendance').select('starts_at, total, activity_name, service_name')
      if (!alive) return
      setRows(((data ?? []) as unknown as Row[]).filter((r) => r.starts_at && Number(r.total) > 0))
    })()
    return () => { alive = false }
  }, [churchId])

  const model = useMemo(() => {
    const list = (rows ?? []).map((r) => ({ at: new Date(r.starts_at as string), total: Number(r.total), name: r.activity_name ?? r.service_name ?? 'Actividad' }))
    // Franjas día×hora
    const cell = new Map<string, { s: number; n: number }>() // `${wd}-${h}`
    const hoursSet = new Set<number>()
    let best: { wd: number; h: number; avg: number } | null = null
    for (const r of list) {
      const wd = r.at.getDay(), h = r.at.getHours(); hoursSet.add(h)
      const k = `${wd}-${h}`; const c = cell.get(k) ?? { s: 0, n: 0 }; c.s += r.total; c.n++; cell.set(k, c)
    }
    const avgAt = (wd: number, h: number): number | null => { const c = cell.get(`${wd}-${h}`); return c ? Math.round(c.s / c.n) : null }
    const hours = [...hoursSet].sort((a, b) => a - b)
    let maxAvg = 1
    for (const wd of [0, 1, 2, 3, 4, 5, 6]) for (const h of hours) { const a = avgAt(wd, h); if (a != null) { if (a > maxAvg) maxAvg = a; if (!best || a > best.avg) best = { wd, h, avg: a } } }
    // Mejor franja SOLO entre semana (lunes a viernes).
    let bestWD: { wd: number; h: number; avg: number } | null = null
    for (const wd of [1, 2, 3, 4, 5]) for (const h of hours) { const a = avgAt(wd, h); if (a != null && (!bestWD || a > bestWD.avg)) bestWD = { wd, h, avg: a } }
    let worst: number | null = null
    for (const wd of [0, 1, 2, 3, 4, 5, 6]) for (const h of hours) { const a = avgAt(wd, h); if (a != null && (worst == null || a < worst)) worst = a }
    // Mejores tipos
    const typeMap = new Map<string, { s: number; n: number }>()
    for (const r of list) { const c = typeMap.get(r.name) ?? { s: 0, n: 0 }; c.s += r.total; c.n++; typeMap.set(r.name, c) }
    const types = [...typeMap.entries()].map(([name, v]) => ({ name, avg: Math.round(v.s / v.n) })).sort((a, b) => b.avg - a.avg).slice(0, 6)
    return { hours, avgAt, maxAvg, best, bestWD, worst, types, any: list.length > 0 }
  }, [rows])

  if (rows === null) return <p className="py-8 text-center text-sm text-graysage">Cargando…</p>

  const cellBg = (avg: number | null) => {
    if (avg == null) return 'rgba(0,0,0,0.03)'
    const t = 0.15 + (avg / model.maxAvg) * 0.85
    return `rgba(92,162,123,${t.toFixed(2)})`
  }

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <h3 className="font-serif text-lg font-semibold text-charcoal">Mejores números</h3>
        <p className="text-sm text-graysage">Dónde funciona mejor la asistencia. La franja combina día y hora: no es lo mismo las 2pm del domingo que del lunes.</p>
      </div>

      {model.best && model.worst != null && model.worst > 0 && model.best.avg / model.worst >= 1.3 && (
        <Insight tone="info">La mejor franja ({WEEKDAYS[model.best.wd]} {hourLabel(model.best.h)}m) rinde {(model.best.avg / model.worst).toFixed(1)}× más que la más floja.</Insight>
      )}

      {!model.any ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay asistencia registrada para analizar franjas.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {/* Mapa de calor día × hora */}
          <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-charcoal">Franjas día × hora</p>
              <div className="flex flex-wrap gap-1.5">
                {model.best && (
                  <span className="rounded-full bg-sage-light px-3 py-1 text-xs font-semibold text-sage-dark">
                    Mejor: {WEEKDAYS[model.best.wd]} {hourLabel(model.best.h)}m · {model.best.avg}
                  </span>
                )}
                {model.bestWD && (
                  <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold text-graysage" title="Mejor día y hora de lunes a viernes">
                    Entre semana: {WEEKDAYS[model.bestWD.wd]} {hourLabel(model.bestWD.h)}m · {model.bestWD.avg}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <div className="inline-grid gap-1" style={{ gridTemplateColumns: `2.2rem repeat(${model.hours.length}, minmax(2.4rem, 1fr))` }}>
                <span />
                {model.hours.map((h) => <span key={h} className="pb-1 text-center text-[0.65rem] font-medium text-graysage">{hourLabel(h)}m</span>)}
                {[0, 1, 2, 3, 4, 5, 6].map((wd) => (
                  <WeekdayRow key={wd} wd={wd} hours={model.hours} avgAt={model.avgAt} cellBg={cellBg} best={model.best} />
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-graysage/70">Color = asistencia promedio. Vacío = sin actividad en esa franja.</p>
          </div>

          {/* Mejores tipos de actividad (Recharts) */}
          <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-2">
            <p className="text-sm font-medium text-charcoal">Mejores actividades</p>
            <p className="mb-2 text-xs text-graysage">Asistencia promedio por tipo</p>
            <ResponsiveContainer width="100%" height={Math.max(120, model.types.length * 38)}>
              <BarChart data={model.types} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: '#7E807B' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} formatter={(v: number) => [`${v} asist.`, 'Promedio']} />
                <Bar dataKey="avg" radius={[0, 6, 6, 0]} barSize={16}>
                  {model.types.map((_, i) => <Cell key={i} fill={i === 0 ? GREEN : '#A9C9B6'} />)}
                  <LabelList dataKey="avg" position="right" style={{ fontSize: 11, fill: '#383835', fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function WeekdayRow({ wd, hours, avgAt, cellBg, best }: {
  wd: number; hours: number[]; avgAt: (wd: number, h: number) => number | null; cellBg: (a: number | null) => string; best: { wd: number; h: number } | null
}) {
  return (
    <>
      <span className="flex items-center text-[0.7rem] font-medium text-graysage">{WEEKDAYS_SHORT[wd]}</span>
      {hours.map((h) => {
        const a = avgAt(wd, h); const isBest = best && best.wd === wd && best.h === h
        return (
          <div
            key={h}
            title={a != null ? `${WEEKDAYS_SHORT[wd]} ${hourLabel(h)}m · ${a} asist.` : 'Sin actividad'}
            className={`flex h-9 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${isBest ? 'ring-2 ring-sage-dark' : ''}`}
            style={{ backgroundColor: cellBg(a), color: a != null && a / 1 > 0 ? (a > 0 ? '#1f2a24' : '#7E807B') : '#B6B8B2' }}
          >
            {a ?? ''}
          </div>
        )
      })}
    </>
  )
}
