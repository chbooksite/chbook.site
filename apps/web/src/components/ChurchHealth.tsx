import { useEffect, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { ymd } from '../lib/calendar'
import { weekStart } from '../lib/activity'
import Insight from './Insight'

// Nivel 4 del modelo · SALUD DE LA IGLESIA (semanal). La clave: los servicios NO
// se suman (la misma persona va a varios). La salud global = PERSONAS ÚNICAS que
// participaron en ≥1 actividad en la semana ÷ total de miembros, con su tendencia.
// Se apoya en services (starts_at) + attendance (member_id, service_id).

const GREEN = '#5CA27B'

interface Week { key: string; label: string; participants: number; rate: number }

export default function ChurchHealth({ churchId }: { churchId: string }) {
  const [data, setData] = useState<{ total: number; weeks: Week[] } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [memRes, svcRes, attRes] = await Promise.all([
        supabase.from('members').select('status'),
        supabase.from('services').select('id, starts_at').eq('church_id', churchId),
        supabase.from('attendance').select('member_id, service_id'),
      ])
      if (!alive) return
      const total = ((memRes.data ?? []) as { status: string }[]).filter((m) => m.status !== 'archived' && m.status !== 'cambio_membresia').length
      const svcWeek = new Map<string, string>()
      for (const s of (svcRes.data ?? []) as { id: string; starts_at: string | null }[]) {
        if (!s.starts_at) continue
        svcWeek.set(s.id, ymd(weekStart(new Date(s.starts_at))))
      }
      const weekMembers = new Map<string, Set<string>>()
      for (const a of (attRes.data ?? []) as { member_id: string; service_id: string }[]) {
        const wk = svcWeek.get(a.service_id); if (!wk) continue
        const s = weekMembers.get(wk) ?? new Set<string>(); s.add(a.member_id); weekMembers.set(wk, s)
      }
      const weeks = [...weekMembers.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(-10)
        .map(([key, set]) => {
          const [y, mo, d] = key.split('-').map(Number); const dt = new Date(y, mo - 1, d)
          return { key, label: dt.toLocaleDateString('es', { day: 'numeric', month: 'short' }), participants: set.size, rate: total ? Math.round((set.size / total) * 100) : 0 }
        })
      setData({ total, weeks })
    })()
    return () => { alive = false }
  }, [churchId])

  if (!data) return <p className="py-8 text-center text-sm text-graysage">Cargando…</p>

  const cur = data.weeks.length ? data.weeks[data.weeks.length - 1] : null
  const prev = data.weeks.length >= 2 ? data.weeks[data.weeks.length - 2] : null
  const delta = cur && prev ? cur.rate - prev.rate : null

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <h3 className="font-serif text-lg font-semibold text-charcoal">Salud de la iglesia</h3>
        <p className="text-sm text-graysage">Personas distintas que participaron en alguna actividad cada semana, sobre el total de miembros (los servicios no se suman).</p>
      </div>

      {!cur ? (
        <p className="rounded-2xl bg-white py-10 text-center text-sm text-graysage ring-1 ring-black/5">Aún no hay asistencia registrada para medir la participación semanal.</p>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-sage-dark to-sage p-5 text-white shadow-[0_16px_34px_-14px_rgba(92,162,123,0.75)]">
              <p className="font-serif text-4xl font-semibold tabular-nums">{cur.rate}%</p>
              <p className="mt-0.5 text-sm font-medium text-white/90">de la iglesia participó esta semana</p>
              <p className="mt-1 text-xs text-white/75">
                {cur.participants} de {data.total} miembros
                {delta != null && <> · {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} pts vs semana anterior</>}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 lg:col-span-2">
              <p className="mb-2 text-sm font-medium text-charcoal">Participación semanal</p>
              <ResponsiveContainer width="100%" height={170}>
                <AreaChart data={data.weeks} margin={{ left: -18, right: 8, top: 6, bottom: 0 }}>
                  <defs><linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.25} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeOpacity={0.06} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7E807B' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#7E807B' }} axisLine={false} tickLine={false} width={38} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'Participación']} />
                  <Area type="monotone" dataKey="rate" stroke={GREEN} strokeWidth={2.5} fill="url(#healthFill)" dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {delta != null && (
            <Insight tone={delta >= 0 ? 'good' : 'warn'}>
              La participación semanal {delta >= 0 ? 'subió' : 'bajó'} {Math.abs(delta)} puntos respecto a la semana anterior ({cur.rate}% vs {prev!.rate}%).
            </Insight>
          )}
        </>
      )}
    </div>
  )
}
