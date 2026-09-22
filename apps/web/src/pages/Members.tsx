import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'

interface Catalog {
  id: string
  key: string
  name: string
}

interface MemberRow {
  id: string
  full_name: string
  status: string | null
  email: string | null
  phone: string | null
  roleIds: string[]
  teams: { teamId: string; isLeader: boolean }[]
}

// Forma cruda de la fila de member con sus embeds (los tipos de embed de
// supabase-js son difíciles de inferir; lo casteamos de forma controlada).
type RawMember = {
  id: string
  full_name: string
  status: string | null
  email: string | null
  phone: string | null
  member_roles: { role_id: string }[] | null
  member_teams: { team_id: string; is_leader: boolean | null }[] | null
}

export default function Members() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [roles, setRoles] = useState<Catalog[]>([])
  const [teams, setTeams] = useState<Catalog[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)

  // Formulario de alta
  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'active' | 'prospect'>('active')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!churchId) return
    setLoading(true)
    const [rolesRes, teamsRes, membersRes] = await Promise.all([
      supabase.from('roles').select('id, key, name').order('name'),
      supabase.from('teams').select('id, key, name').order('name'),
      supabase
        .from('members')
        .select('id, full_name, status, email, phone, member_roles(role_id), member_teams(team_id, is_leader)')
        .order('full_name'),
    ])
    setRoles(rolesRes.data ?? [])
    setTeams(teamsRes.data ?? [])
    const raw = (membersRes.data ?? []) as unknown as RawMember[]
    setMembers(
      raw.map((m) => ({
        id: m.id,
        full_name: m.full_name,
        status: m.status,
        email: m.email,
        phone: m.phone,
        roleIds: (m.member_roles ?? []).map((r) => r.role_id),
        teams: (m.member_teams ?? []).map((t) => ({
          teamId: t.team_id,
          isLeader: Boolean(t.is_leader),
        })),
      })),
    )
    setLoading(false)
  }, [churchId])

  useEffect(() => {
    load()
  }, [load])

  if (membershipLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? '—'
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '—'

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const resetForm = () => {
    setFullName('')
    setEmail('')
    setPhone('')
    setStatus('active')
    setRoleIds([])
    setTeamIds([])
    setError(null)
  }

  const createMember = async (e: FormEvent) => {
    e.preventDefault()
    if (!churchId) return
    setSaving(true)
    setError(null)

    const { data: created, error: insErr } = await supabase
      .from('members')
      .insert({
        church_id: churchId,
        full_name: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        status,
      })
      .select('id')
      .single()

    if (insErr || !created) {
      setError(insErr?.message ?? 'No se pudo crear el miembro.')
      setSaving(false)
      return
    }

    // Todo miembro lleva el rol base "miembro" + los roles elegidos.
    const baseRole = roles.find((r) => r.key === 'miembro')
    const allRoleIds = Array.from(
      new Set([...(baseRole ? [baseRole.id] : []), ...roleIds]),
    )
    if (allRoleIds.length) {
      await supabase
        .from('member_roles')
        .insert(allRoleIds.map((rid) => ({ member_id: created.id, role_id: rid })))
    }
    if (teamIds.length) {
      await supabase
        .from('member_teams')
        .insert(teamIds.map((tid) => ({ member_id: created.id, team_id: tid })))
    }

    resetForm()
    setShowForm(false)
    setSaving(false)
    load()
  }

  const approve = async (id: string) => {
    await supabase.from('members').update({ status: 'active' }).eq('id', id)
    load()
  }

  const statusBadge = (s: string | null) => {
    const map: Record<string, string> = {
      active: 'bg-sage-water/15 text-sage-dark',
      prospect: 'bg-gold/15 text-clay',
      inactive: 'bg-graysage/15 text-graysage',
      archived: 'bg-graysage/10 text-graysage/70',
    }
    const label: Record<string, string> = {
      active: 'Activo',
      prospect: 'Prospecto',
      inactive: 'Inactivo',
      archived: 'Archivado',
    }
    const k = s ?? 'active'
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[k] ?? map.active}`}>
        {label[k] ?? k}
      </span>
    )
  }

  const inputCls =
    'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-charcoal">Miembros</h1>
            <p className="text-sm text-graysage">{members.length} en tu iglesia</p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm()
              setShowForm((v) => !v)
            }}
            className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage"
          >
            {showForm ? 'Cancelar' : '+ Agregar miembro'}
          </button>
        </div>

        {/* Formulario de alta */}
        {showForm && (
          <form
            onSubmit={createMember}
            className="mb-8 space-y-4 rounded-2xl border border-clay-light/40 bg-white p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Nombre completo</label>
                <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Estado</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'prospect')} className={inputCls}>
                  <option value="active">Activo</option>
                  <option value="prospect">Prospecto (por aprobar)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">
                  Correo <span className="text-graysage/60">(opcional)</span>
                </label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">
                  Teléfono <span className="text-graysage/60">(opcional)</span>
                </label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-graysage">Roles</p>
              <div className="flex flex-wrap gap-2">
                {roles
                  .filter((r) => r.key !== 'miembro')
                  .map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggle(roleIds, setRoleIds, r.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        roleIds.includes(r.id)
                          ? 'border-sage bg-sage text-cream'
                          : 'border-graysage/25 text-graysage hover:border-sage'
                      }`}
                    >
                      {r.name}
                    </button>
                  ))}
              </div>
              <p className="mt-1 text-xs text-graysage/60">Todos llevan el rol base "Miembro" automáticamente.</p>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-graysage">Equipos</p>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(teamIds, setTeamIds, t.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      teamIds.includes(t.id)
                        ? 'border-clay bg-clay text-cream'
                        : 'border-graysage/25 text-graysage hover:border-clay'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Guardar miembro'}
            </button>
          </form>
        )}

        {/* Lista */}
        {loading ? (
          <p className="font-mono text-sm text-graysage">Cargando miembros…</p>
        ) : members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-graysage/30 p-10 text-center">
            <p className="text-graysage">Aún no hay miembros. Agrega el primero con el botón de arriba.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-clay-light/40 bg-white">
            {members.map((m, i) => (
              <div
                key={m.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 ${
                  i > 0 ? 'border-t border-clay-light/25' : ''
                }`}
              >
                <div className="min-w-40 flex-1">
                  <p className="font-medium text-charcoal">{m.full_name}</p>
                  {m.email && <p className="font-mono text-xs text-graysage">{m.email}</p>}
                </div>

                <div className="flex flex-wrap gap-1">
                  {m.roleIds.map((id) => (
                    <span key={id} className="rounded bg-sage-water/10 px-1.5 py-0.5 text-xs text-sage-dark">
                      {roleName(id)}
                    </span>
                  ))}
                  {m.teams.map((t) => (
                    <span key={t.teamId} className="rounded bg-clay/10 px-1.5 py-0.5 text-xs text-clay">
                      {teamName(t.teamId)}
                      {t.isLeader && ' ★'}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  {statusBadge(m.status)}
                  {m.status === 'prospect' && (
                    <button
                      type="button"
                      onClick={() => approve(m.id)}
                      className="rounded-lg border border-sage/40 px-2.5 py-1 text-xs font-medium text-sage-dark transition hover:bg-sage/10"
                    >
                      Aprobar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
