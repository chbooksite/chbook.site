import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import {
  DEFAULT_RULES,
  depsSatisfied,
  readRequires,
  readRules,
  type ChurchRules,
  type Requires,
} from '../lib/rules'
import { IDENTITY_TONE_CLASS, memberIdentity } from '../lib/member'

interface Catalog {
  id: string
  key: string
  name: string
  requires: Requires
}

interface MemberRow {
  id: string
  full_name: string
  status: string | null
  email: string | null
  phone: string | null
  isBaptized: boolean
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
  is_baptized: boolean | null
  member_roles: { role_id: string }[] | null
  member_teams: { team_id: string; is_leader: boolean | null }[] | null
}

export default function Members() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [roles, setRoles] = useState<Catalog[]>([])
  const [teams, setTeams] = useState<Catalog[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [rules, setRules] = useState<ChurchRules>(DEFAULT_RULES)
  const [loading, setLoading] = useState(true)

  // Formulario de alta
  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'active' | 'prospect'>('active')
  const [newBaptized, setNewBaptized] = useState(false)
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!churchId) return
    setLoading(true)
    const [rolesRes, teamsRes, membersRes, churchRes] = await Promise.all([
      supabase.from('roles').select('id, key, name, requires').order('name'),
      supabase.from('teams').select('id, key, name, requires').order('name'),
      supabase
        .from('members')
        .select('id, full_name, status, email, phone, is_baptized, member_roles(role_id), member_teams(team_id, is_leader)')
        .order('full_name'),
      supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
    ])
    const mapCat = (d: unknown[] | null): Catalog[] =>
      (d ?? []).map((x) => {
        const c = x as { id: string; key: string; name: string; requires: unknown }
        return { id: c.id, key: c.key, name: c.name, requires: readRequires(c.requires) }
      })
    setRoles(mapCat(rolesRes.data))
    setTeams(mapCat(teamsRes.data))
    setRules(readRules(churchRes.data?.settings))
    const raw = (membersRes.data ?? []) as unknown as RawMember[]
    setMembers(
      raw.map((m) => ({
        id: m.id,
        full_name: m.full_name,
        status: m.status,
        email: m.email,
        phone: m.phone,
        isBaptized: Boolean(m.is_baptized),
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
  const nameById = (id: string) =>
    roles.find((r) => r.id === id)?.name ?? teams.find((t) => t.id === id)?.name ?? '—'
  const depHint = (req: Requires) =>
    `Requiere: ${[...req.roles, ...req.teams].map(nameById).join(', ')}`

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const resetForm = () => {
    setFullName('')
    setEmail('')
    setPhone('')
    setStatus('active')
    setNewBaptized(false)
    setRoleIds([])
    setTeamIds([])
    setError(null)
  }

  const createMember = async (e: FormEvent) => {
    e.preventDefault()
    if (!churchId) return
    setSaving(true)
    setError(null)

    // Regla: un líder debe pertenecer al menos a un equipo.
    const leaderRole = roles.find((r) => r.key === 'lider')
    if (
      rules.leader_requires_team &&
      leaderRole &&
      roleIds.includes(leaderRole.id) &&
      teamIds.length === 0
    ) {
      setError('Un líder debe pertenecer al menos a un equipo. Asigna un equipo o quita el rol Líder.')
      setSaving(false)
      return
    }

    const { data: created, error: insErr } = await supabase
      .from('members')
      .insert({
        church_id: churchId,
        full_name: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        is_baptized: newBaptized,
        status,
      })
      .select('id')
      .single()

    if (insErr || !created) {
      setError(insErr?.message ?? 'No se pudo crear el miembro.')
      setSaving(false)
      return
    }

    if (roleIds.length) {
      await supabase
        .from('member_roles')
        .insert(roleIds.map((rid) => ({ member_id: created.id, role_id: rid })))
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

  const identityBadge = (m: MemberRow) => {
    const id = memberIdentity(m.status, m.isBaptized, m.teams.length, m.roleIds.length)
    if (!id) return null
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${IDENTITY_TONE_CLASS[id.tone]}`}>
        {id.text}
      </span>
    )
  }

  const inputCls =
    'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

  const selectedRoleKeys = roleIds
    .map((rid) => roles.find((r) => r.id === rid)?.key)
    .filter(Boolean) as string[]
  const canPreachNew = ['lider', 'pastor_principal', 'pastor_afiliado'].some((k) =>
    selectedRoleKeys.includes(k),
  )
  const rolesBlocked = rules.baptism_for_roles && !newBaptized
  const teamsBlocked = rules.baptism_for_teams && !newBaptized

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

            <label className="flex items-center gap-2 text-sm font-medium text-graysage">
              <input type="checkbox" checked={newBaptized} onChange={(e) => setNewBaptized(e.target.checked)} />
              ✝ Miembro bautizado
            </label>

            <div>
              <p className="mb-2 text-sm font-medium text-graysage">Roles</p>
              <div className="flex flex-wrap gap-2">
                {roles
                  .filter((r) => r.key !== 'miembro')
                  .map((r) => {
                    const on = roleIds.includes(r.id)
                    const preacherBlocked =
                      r.key === 'predicador' && rules.preacher_requires_leadership && !canPreachNew
                    const depsOk = depsSatisfied(r.requires, roleIds, teamIds)
                    const disabled = !on && (rolesBlocked || preacherBlocked || !depsOk)
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggle(roleIds, setRoleIds, r.id)}
                        title={
                          rolesBlocked
                            ? 'Marca al miembro como bautizado para asignar roles'
                            : preacherBlocked
                              ? 'Solo líderes o pastores pueden ser predicadores'
                              : !depsOk
                                ? depHint(r.requires)
                                : undefined
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          on
                            ? 'border-sage bg-sage text-cream'
                            : 'border-graysage/25 text-graysage hover:border-sage'
                        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        {r.name}
                      </button>
                    )
                  })}
              </div>
              {rolesBlocked && (
                <p className="mt-1 text-xs text-clay">✝ Debe estar bautizado para asignarle roles.</p>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-graysage">Equipos</p>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => {
                  const on = teamIds.includes(t.id)
                  const depsOk = depsSatisfied(t.requires, roleIds, teamIds)
                  const disabled = !on && (teamsBlocked || !depsOk)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(teamIds, setTeamIds, t.id)}
                      title={
                        !disabled
                          ? undefined
                          : teamsBlocked
                            ? 'Marca al miembro como bautizado para unirlo a un equipo'
                            : depHint(t.requires)
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        on
                          ? 'border-clay bg-clay text-cream'
                          : 'border-graysage/25 text-graysage hover:border-clay'
                      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>
              {teamsBlocked && (
                <p className="mt-1 text-xs text-clay">✝ Debe estar bautizado para unirlo a un equipo.</p>
              )}
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
                  <span className="flex items-center gap-1.5">
                    <Link
                      to={`/miembros/${m.id}`}
                      className="font-medium text-charcoal underline-offset-2 hover:text-sage-dark hover:underline"
                    >
                      {m.full_name}
                    </Link>
                    {m.isBaptized && (
                      <span title="Bautizado" className="text-sage-water">
                        ✝
                      </span>
                    )}
                  </span>
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
                  {identityBadge(m)}
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
