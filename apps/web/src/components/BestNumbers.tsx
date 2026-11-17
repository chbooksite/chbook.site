import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { supabase } from '../lib/supabase'
import { WEEKDAYS, WEEKDAYS_SHORT, readAssignees } from '../lib/activity'
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
  const [encByName, setEncByName] = useState<Map<string, { enc: string; pred: string | null }>>(new Map())

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [svcRes, schRes, roleRes, memRes, teamRes] = await Promise.all([
        supabase.from('service_attendance').select('starts_at, total, activity_name, service_name'),
        supabase.from('activity_schedules').select('name, assignees').eq('church_id', churchId),
        supabase.from('roles').select('id, name'),
        supabase.from('members').select('id, full_name'),
        supabase.from('teams').select('id, name'),
      ])
      if (!alive) return
      const roleName = new Map(((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]))
      const memberName = new Map(((memRes.data ?? []) as { id: string; full_name: string }[]).map((m) => [m.id, m.full_name]))
      const teamName = new Map(((teamRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]))
      const isPred = (x: { kind: string; id: string }) => x.kind === 'role' && (roleName.get(x.id) ?? '').toLowerCase().includes('predicador')
      const resolveA = (a: { kind: string; id: string }) => a.kind === 'member' ? (memberName.get(a.id) ?? 'Persona') : a.kind === 'team' ? (teamName.get(a.id) ?? 'Equipo') : (roleName.get(a.id) ?? 'Rol')
      const enc = new Map<string, { enc: string; pred: string | null }>()
      for (const s of (schRes.data ?? []) as { name: string; assignees: unknown }[]) {
        const asg = readAssignees(s.assignees); if (!asg.length) continue
        const pa = asg.find(isPred)
        enc.set(s.name, { enc: asg.filter((x) => !isPred(x)).map(resolveA).join(' · '), pred: pa ? (pa.memberIds.map((id) => memberName.get(id)).filter(Boolean).join(', ') || 'Predicador') : null })
      }
      setEncByName(enc)
      setRows(((svcRes.data ?? []) as unknown as Row[]).filter((r) => r.starts_at && Number(r.total) > 0))
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
    // Mejor franja de fin de semana
    let bestWE: { wd: number; h: number; avg: number } | null = null
    for (const wd of [0, 6]) for (const h of hours) { const a = avgAt(wd, h); if (a != null && (!bestWE || a > bestWE.avg)) bestWE = { wd, h, avg: a } }
    // Mejores tipos, separados entre semana (L-V) y fin de semana (S-D)
    const typeByDay = (weekend: boolean) => {
      const m = new Map<string, { s: number; n: number }>()
      for (const r of list) { const wd = r.at.getDay(); if ((wd === 0 || wd === 6) !== weekend) continue; const c = m.get(r.name) ?? { s: 0, n: 0 }; c.s += r.total; c.n++; m.set(r.name, c) }
      return [...m.entries()].map(([name, v]) => ({ name, avg: Math.round(v.s / v.n) })).sort((a, b) => b.avg - a.avg).slice(0, 5)
    }
    return { hours, avgAt, maxAvg, best, bestWD, bestWE, worst, typesWeek: typeByDay(false), typesWeekend: typeByDay(true), any: list.length > 0 }
  }, [rows])

  // Actividades con más asistencia + quién las encabeza (encargado) y quién predica.
  const topActs = useMemo(() => {
    const m = new Map<string, { s: number; n: number }>()
    for (const r of rows ?? []) { const name = r.activity_name ?? r.service_name ?? 'Actividad'; const c = m.get(name) ?? { s: 0, n: 0 }; c.s += Number(r.total); c.n++; m.set(name, c) }
    return [...m.entries()]
      .map(([name, v]) => ({ name, avg: Math.round(v.s / v.n), ...(encByName.get(name) ?? { enc: '', pred: null as string | null }) }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5)
  }, [rows, encByName])

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
                {model.bestWE && (
                  <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold text-graysage" title="Mejor día y hora de sábado/domingo">
                    Fin de semana: {WEEKDAYS[model.bestWE.wd]} {hourLabel(model.bestWE.h)}m · {model.bestWE.avg}
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

          {/* Mejores tipos de actividad, entre semana vs fin de semana */}
          <div className="space-y-3 lg:col-span-2">
            <TypeBars title="Fin de semana" hint="Asistencia promedio · sábado y domingo" data={model.typesWeekend} />
            <TypeBars title="Entre semana" hint="Asistencia promedio · lunes a viernes" data={model.typesWeek} />
          </div>

          {/* Quién encabeza los servicios con más asistencia */}
          {topActs.some((a) => a.enc || a.pred) && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-5">
              <p className="text-sm font-medium text-charcoal">Encargados de los servicios con más asistencia</p>
              <p className="mb-3 text-xs text-graysage">Quién dirige y quién lleva la palabra en cada actividad. Los asignas en el Calendario.</p>
              <div className="space-y-1.5">
                {topActs.map((a) => (
                  <div key={a.name} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-cream/60 px-3 py-2 text-xs">
                    <span className="w-44 shrink-0 font-semibold text-charcoal">{a.name}</span>
                    <span className="w-16 shrink-0 tabular-nums text-graysage">{a.avg} asist.</span>
                    {a.enc && <span className="text-graysage">Encargado: <span className="font-medium text-charcoal">{a.enc}</span></span>}
                    {a.pred && <span className="text-graysage">· Predica: <span className="font-medium text-charcoal">{a.pred}</span></span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TypeBars({ title, hint, data }: { title: string; hint: string; data: { name: string; avg: number }[] }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-sm font-medium text-charcoal">{title}</p>
      <p className="mb-2 text-xs text-graysage">{hint}</p>
      {data.length === 0 ? (
        <p className="py-3 text-center text-xs text-graysage/60">Sin datos aún</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(90, data.length * 34)}>
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 2, bottom: 2 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: '#7E807B' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} formatter={(v: number) => [`${v} asist.`, 'Promedio']} />
            <Bar dataKey="avg" radius={[0, 6, 6, 0]} barSize={15}>
              {data.map((_, i) => <Cell key={i} fill={i === 0 ? GREEN : '#A9C9B6'} />)}
              <LabelList dataKey="avg" position="right" style={{ fontSize: 11, fill: '#383835', fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
