import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import Insight from './Insight'
import RangeControl, { DEFAULT_RANGE, bucketKey, bucketLabel, cutoff, type Range } from './RangeControl'

// Nivel 4 del modelo · SALUD DE LA IGLESIA. Participación = PERSONAS ÚNICAS que
// asistieron a ≥1 actividad en el periodo ÷ total de miembros (los servicios no se
// suman). Periodo configurable: semanas / meses / años + cantidad.

const GREEN = '#5CA27B'
const PERIOD: Record<Range['unit'], { cur: string; prev: string }> = {
  sem: { cur: 'esta semana', prev: 'semana anterior' },
  mes: { cur: 'este mes', prev: 'mes anterior' },
  año: { cur: 'este año', prev: 'año anterior' },
}

export default function ChurchHealth({ churchId }: { churchId: string }) {
  const [raw, setRaw] = useState<{ total: number; svcDate: Map<string, Date>; att: { member_id: string; service_id: string }[] } | null>(null)
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [memRes, svcRes] = await Promise.all([
        supabase.from('members').select('status'),
        supabase.from('services').select('id, starts_at').eq('church_id', churchId),
      ])
      const att = await fetchAll<{ member_id: string; service_id: string }>(() => supabase.from('attendance').select('member_id, service_id'))
      if (!alive) return
      const total = ((memRes.data ?? []) as { status: string }[]).filter((m) => m.status !== 'archived' && m.status !== 'cambio_membresia').length
      const svcDate = new Map<string, Date>()
      for (const s of (svcRes.data ?? []) as { id: string; starts_at: string | null }[]) if (s.starts_at) svcDate.set(s.id, new Date(s.starts_at))
      setRaw({ total, svcDate, att })
    })()
    return () => { alive = false }
  }, [churchId])

  const buckets = useMemo(() => {
    if (!raw) return [] as { key: string; label: string; participants: number; rate: number }[]
    const cut = cutoff(range)
    const m = new Map<string, Set<string>>()
    for (const a of raw.att) {
      const d = raw.svcDate.get(a.service_id); if (!d || d < cut) continue
      const k = bucketKey(d, range.unit); const s = m.get(k) ?? new Set<string>(); s.add(a.member_id); m.set(k, s)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, set]) => ({ key, label: bucketLabel(key, range.unit), participants: set.size, rate: raw.total ? Math.round((set.size / raw.total) * 100) : 0 }))
  }, [raw, range])

  if (!raw) return <p className="py-8 text-center text-sm text-graysage">Cargando…</p>

  const cur = buckets.length ? buckets[buckets.length - 1] : null
  const prev = buckets.length >= 2 ? buckets[buckets.length - 2] : null
  const delta = cur && prev ? cur.rate - prev.rate : null
  const P = PERIOD[range.unit]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <div>
          <h3 className="font-serif text-lg font-semibold text-charcoal">Salud de la iglesia</h3>
          <p className="text-sm text-graysage">Personas distintas que participaron en alguna actividad por periodo, sobre el total de miembros.</p>
        </div>
        <RangeControl value={range} onChange={setRange} />
      </div>

      {!cur ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay asistencia registrada en este rango.</p>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-sage-dark to-sage p-5 text-white shadow-[0_16px_34px_-14px_rgba(92,162,123,0.75)]">
              <p className="font-serif text-4xl font-semibold tabular-nums">{cur.rate}%</p>
              <p className="mt-0.5 text-sm font-medium text-white/90">de la iglesia participó {P.cur}</p>
              <p className="mt-1 text-xs text-white/75">
                {cur.participants} de {raw.total} miembros
                {delta != null && <> · {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} pts vs {P.prev}</>}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-2">
              <p className="mb-2 text-sm font-medium text-charcoal">Participación por {range.unit === 'sem' ? 'semana' : range.unit === 'mes' ? 'mes' : 'año'}</p>
              <ResponsiveContainer width="100%" height={170}>
                <AreaChart data={buckets} margin={{ left: -18, right: 8, top: 6, bottom: 0 }}>
                  <defs><linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.25} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeOpacity={0.06} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7E807B' }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis tick={{ fontSize: 11, fill: '#7E807B' }} axisLine={false} tickLine={false} width={38} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'Participación']} />
                  <Area type="monotone" dataKey="rate" stroke={GREEN} strokeWidth={2.5} fill="url(#healthFill)" dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {delta != null && (
            <Insight tone={delta >= 0 ? 'good' : 'warn'} action={delta < 0 ? { label: 'Ver miembros', to: '/miembros' } : undefined}>
              La participación {delta >= 0 ? 'subió' : 'bajó'} {Math.abs(delta)} puntos respecto al {P.prev} ({cur.rate}% vs {prev!.rate}%).
            </Insight>
          )}
        </>
      )}
    </div>
  )
}
