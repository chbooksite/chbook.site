import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import {
  ageRange,
  IDENTITY_TONE_CLASS,
  isBaptismInconsistent,
  memberIdentity,
} from '../lib/member'

interface Catalog {
  id: string
  key: string
  name: string
  requires: Requires
}

type RawMember = {
  id: string
  full_name: string
  status: string | null
  cedula: string | null
  email: string | null
  phone: string | null
  birth_date: string | null
  sex: string | null
  guardian_id: string | null
  is_baptized: boolean | null
  baptism_date: string | null
  member_roles: { role_id: string }[] | null
  member_teams: { team_id: string; is_leader: boolean | null }[] | null
}

interface Dependent {
  id: string
  full_name: string
  birth_date: string | null
}

// Roles que habilitan poder ser "predicador".
const PREACH_KEYS = ['lider', 'pastor_principal', 'pastor_afiliado']

function ageGroup(birthDate: string | null): string | null {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  if (age < 13) return `Niño · ${age} años`
  if (age < 18) return `Adolescente · ${age} años`
  if (age < 60) return `Adulto · ${age} años`
  return `Adulto mayor · ${age} años`
}

export default function MemberProfile() {
  const { id } = useParams<{ id: string }>()
  const { membership, membershipLoading } = useAuth()

  const [roles, setRoles] = useState<Catalog[]>([])
  const [teams, setTeams] = useState<Catalog[]>([])
  const [rules, setRules] = useState<ChurchRules>(DEFAULT_RULES)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dependientes y representante
  const [guardianId, setGuardianId] = useState<string | null>(null)
  const [guardianName, setGuardianName] = useState<string | null>(null)
  const [dependents, setDependents] = useState<Dependent[]>([])
  const [showDepForm, setShowDepForm] = useState(false)
  const [depName, setDepName] = useState('')
  const [depBirth, setDepBirth] = useState('')
  const [depSex, setDepSex] = useState('')
  const [depSaving, setDepSaving] = useState(false)
  const [depError, setDepError] = useState<string | null>(null)

  // Datos editables
  const [fullName, setFullName] = useState('')
  const [cedula, setCedula] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState('')
  const [isBaptized, setIsBaptized] = useState(false)
  const [baptismDate, setBaptismDate] = useState('')
  const [status, setStatus] = useState('active')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [teamMap, setTeamMap] = useState<Record<string, boolean>>({}) // teamId -> isLeader

  // Copia original para diferenciar al guardar
  const [origRoleIds, setOrigRoleIds] = useState<string[]>([])
  const [origTeamMap, setOrigTeamMap] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!id || !membership) return
    setLoading(true)
    const [rolesRes, teamsRes, memberRes, churchRes] = await Promise.all([
      supabase.from('roles').select('id, key, name, requires').order('name'),
      supabase.from('teams').select('id, key, name, requires').order('name'),
      supabase
        .from('members')
        .select('id, full_name, status, cedula, email, phone, birth_date, sex, guardian_id, is_baptized, baptism_date, member_roles(role_id), member_teams(team_id, is_leader)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('churches').select('settings').eq('id', membership.churchId).maybeSingle(),
    ])
    const mapCat = (d: unknown[] | null): Catalog[] =>
      (d ?? []).map((x) => {
        const c = x as { id: string; key: string; name: string; requires: unknown }
        return { id: c.id, key: c.key, name: c.name, requires: readRequires(c.requires) }
      })
    setRoles(mapCat(rolesRes.data))
    setTeams(mapCat(teamsRes.data))
    setRules(readRules(churchRes.data?.settings))

    const m = memberRes.data as RawMember | null
    if (!m) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setFullName(m.full_name)
    setCedula(m.cedula ?? '')
    setEmail(m.email ?? '')
    setPhone(m.phone ?? '')
    setBirthDate(m.birth_date ?? '')
    setSex(m.sex ?? '')
    setIsBaptized(Boolean(m.is_baptized))
    setBaptismDate(m.baptism_date ?? '')
    setStatus(m.status ?? 'active')
    const rIds = (m.member_roles ?? []).map((r) => r.role_id)
    const tMap: Record<string, boolean> = {}
    for (const t of m.member_teams ?? []) tMap[t.team_id] = Boolean(t.is_leader)
    setRoleIds(rIds)
    setTeamMap(tMap)
    setOrigRoleIds(rIds)
    setOrigTeamMap(tMap)

    setGuardianId(m.guardian_id ?? null)
    if (m.guardian_id) {
      const { data: g } = await supabase.from('members').select('full_name').eq('id', m.guardian_id).maybeSingle()
      setGuardianName(g?.full_name ?? null)
    } else {
      setGuardianName(null)
    }
    const { data: deps } = await supabase
      .from('members')
      .select('id, full_name, birth_date')
      .eq('guardian_id', id)
      .order('full_name')
    setDependents((deps ?? []) as Dependent[])

    setLoading(false)
  }, [id, membership])

  useEffect(() => {
    load()
  }, [load])

  const roleByKey = useMemo(() => {
    const map: Record<string, Catalog> = {}
    for (const r of roles) map[r.key] = r
    return map
  }, [roles])

  const canPreach = useMemo(() => {
    const selectedKeys = roleIds
      .map((rid) => roles.find((r) => r.id === rid)?.key)
      .filter(Boolean) as string[]
    return PREACH_KEYS.some((k) => selectedKeys.includes(k))
  }, [roleIds, roles])

  // Si la regla está activa y deja de ser elegible, quitar "predicador".
  useEffect(() => {
    const preacher = roleByKey['predicador']
    if (rules.preacher_requires_leadership && !canPreach && preacher && roleIds.includes(preacher.id)) {
      setRoleIds((prev) => prev.filter((x) => x !== preacher.id))
    }
  }, [canPreach, roleByKey, roleIds, rules])

  if (membershipLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-cream">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-graysage">No se encontró ese miembro.</p>
          <Link to="/miembros" className="mt-3 inline-block text-sm text-sage underline-offset-2 hover:underline">
            ← Volver a miembros
          </Link>
        </main>
      </div>
    )
  }

  const toggleRole = (rid: string) => {
    setRoleIds((prev) => (prev.includes(rid) ? prev.filter((x) => x !== rid) : [...prev, rid]))
  }
  const toggleTeam = (tid: string) => {
    setTeamMap((prev) => {
      const next = { ...prev }
      if (tid in next) delete next[tid]
      else next[tid] = false
      return next
    })
  }
  const toggleLeader = (tid: string) => {
    const makingLeader = !teamMap[tid]
    if (makingLeader) {
      // Ser líder de un equipo asigna automáticamente el rol "Líder".
      const lider = roleByKey['lider']
      if (lider && !roleIds.includes(lider.id)) {
        const eligible =
          (!rules.baptism_for_roles || isBaptized) &&
          depsSatisfied(lider.requires, roleIds, Object.keys(teamMap))
        if (!eligible) {
          setError(
            'Para ser líder de un equipo, el miembro debe poder tener el rol Líder (revisa bautismo o dependencias).',
          )
          return
        }
        setRoleIds((prev) => [...prev, lider.id])
      }
    }
    setTeamMap((prev) => ({ ...prev, [tid]: !prev[tid] }))
  }

  const cancel = () => {
    setRoleIds(origRoleIds)
    setTeamMap(origTeamMap)
    setError(null)
    setEditing(false)
    load()
  }

  const setStatusQuick = async (newStatus: string) => {
    if (!id) return
    await supabase.from('members').update({ status: newStatus }).eq('id', id)
    load()
  }

  const archive = () => {
    if (
      window.confirm(
        '¿Archivar este miembro? Dejará de contar y se ocultará de la lista, pero sus datos se conservan.',
      )
    ) {
      setStatusQuick('archived')
    }
  }

  const addDependent = async (e: FormEvent) => {
    e.preventDefault()
    if (!membership || !id) return
    setDepSaving(true)
    setDepError(null)
    const { error } = await supabase.from('members').insert({
      church_id: membership.churchId,
      full_name: depName.trim(),
      birth_date: depBirth || null,
      sex: depSex || null,
      guardian_id: id,
      status: 'active',
    })
    setDepSaving(false)
    if (error) {
      setDepError(error.message)
      return
    }
    setDepName('')
    setDepBirth('')
    setDepSex('')
    setShowDepForm(false)
    load()
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!id) return

    // Salvaguarda: confirmar si se asignan roles/equipos a un miembro sin bautismo
    // (por si algún interruptor de bautismo quedó desactivado).
    if (!isBaptized && (roleIds.length > 0 || Object.keys(teamMap).length > 0)) {
      if (
        !window.confirm(
          'Este miembro no está bautizado pero tiene roles o equipos asignados. ¿Guardar de todos modos?',
        )
      ) {
        return
      }
    }

    setSaving(true)
    setError(null)

    // Regla: un líder debe pertenecer al menos a un equipo.
    const leaderRole = roleByKey['lider']
    if (
      rules.leader_requires_team &&
      leaderRole &&
      roleIds.includes(leaderRole.id) &&
      Object.keys(teamMap).length === 0
    ) {
      setError('Un líder debe pertenecer al menos a un equipo. Asigna un equipo o quita el rol Líder.')
      setSaving(false)
      return
    }

    // Datos base
    const { error: upErr } = await supabase
      .from('members')
      .update({
        full_name: fullName.trim(),
        cedula: cedula.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        birth_date: birthDate || null,
        sex: sex || null,
        is_baptized: isBaptized,
        baptism_date: isBaptized ? baptismDate || null : null,
        status,
      })
      .eq('id', id)
    if (upErr) {
      setError(upErr.message)
      setSaving(false)
      return
    }

    const finalRoleIds = roleIds

    // Diff de roles
    const rolesToAdd = finalRoleIds.filter((x) => !origRoleIds.includes(x))
    const rolesToRemove = origRoleIds.filter((x) => !finalRoleIds.includes(x))
    if (rolesToRemove.length) {
      await supabase.from('member_roles').delete().eq('member_id', id).in('role_id', rolesToRemove)
    }
    if (rolesToAdd.length) {
      await supabase.from('member_roles').insert(rolesToAdd.map((rid) => ({ member_id: id, role_id: rid })))
    }

    // Diff de equipos
    const selectedTeamIds = Object.keys(teamMap)
    const origTeamIds = Object.keys(origTeamMap)
    const teamsToRemove = origTeamIds.filter((t) => !(t in teamMap))
    const teamsToAdd = selectedTeamIds.filter((t) => !(t in origTeamMap))
    const teamsToUpdate = selectedTeamIds.filter(
      (t) => t in origTeamMap && teamMap[t] !== origTeamMap[t],
    )
    if (teamsToRemove.length) {
      await supabase.from('member_teams').delete().eq('member_id', id).in('team_id', teamsToRemove)
    }
    if (teamsToAdd.length) {
      await supabase
        .from('member_teams')
        .insert(teamsToAdd.map((tid) => ({ member_id: id, team_id: tid, is_leader: teamMap[tid] })))
    }
    for (const tid of teamsToUpdate) {
      await supabase.from('member_teams').update({ is_leader: teamMap[tid] }).eq('member_id', id).eq('team_id', tid)
    }

    setSaving(false)
    setEditing(false)
    load()
  }

  const roleName = (rid: string) => roles.find((r) => r.id === rid)?.name ?? '—'
  const teamName = (tid: string) => teams.find((t) => t.id === tid)?.name ?? '—'
  const nameById = (id: string) =>
    roles.find((r) => r.id === id)?.name ?? teams.find((t) => t.id === id)?.name ?? '—'
  const depHint = (req: Requires) =>
    `Requiere: ${[...req.roles, ...req.teams].map(nameById).join(', ')}`
  const age = ageGroup(birthDate)
  const rangoEdad = ageRange(birthDate)

  const inputCls =
    'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/miembros" className="text-sm text-sage underline-offset-2 hover:underline">
          ← Miembros
        </Link>

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl text-charcoal">{fullName || 'Miembro'}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(() => {
                const id = memberIdentity(status, isBaptized, Object.keys(teamMap).length, roleIds.length)
                if (id)
                  return (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${IDENTITY_TONE_CLASS[id.tone]}`}>
                      {id.text}
                    </span>
                  )
                return roleIds.map((rid) => (
                  <span
                    key={rid}
                    className="rounded-full bg-sage-water/10 px-2.5 py-0.5 text-xs font-medium text-sage-dark"
                  >
                    {roleName(rid)}
                  </span>
                ))
              })()}
              {isBaptismInconsistent(
                isBaptized,
                roleIds.length,
                Object.keys(teamMap).length,
                rules.baptism_for_roles,
                rules.baptism_for_teams,
              ) && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                  No bautizado
                </span>
              )}
              {age && <span className="text-sm text-graysage">{age}</span>}
            </div>
          </div>
          {!editing && (
            <div className="flex shrink-0 gap-2">
              {status === 'archived' ? (
                <button
                  type="button"
                  onClick={() => setStatusQuick('active')}
                  className="rounded-lg border border-sage/40 px-3 py-2 text-sm text-sage-dark transition hover:bg-sage/10"
                >
                  Restaurar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={archive}
                  className="rounded-lg border border-graysage/25 px-3 py-2 text-sm text-graysage transition hover:bg-cream"
                >
                  Archivar
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage"
              >
                Editar
              </button>
            </div>
          )}
        </div>

        {!editing ? (
          /* ---------- VISTA ---------- */
          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">Cédula</dt>
                  <dd className="mt-1 font-mono text-charcoal">{cedula || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">Correo</dt>
                  <dd className="mt-1 text-charcoal">{email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">Teléfono</dt>
                  <dd className="mt-1 text-charcoal">{phone || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">Nacimiento</dt>
                  <dd className="mt-1 text-charcoal">{birthDate || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">Bautismo</dt>
                  <dd className="mt-1">
                    {isBaptized ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-water/15 px-2.5 py-0.5 text-sm text-sage-dark">
                        ✝ Bautizado{baptismDate ? ` · ${baptismDate}` : ''}
                      </span>
                    ) : (
                      <span className="text-graysage">No bautizado</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">
                    Rango de edad
                  </dt>
                  <dd className="mt-1">
                    {rangoEdad ? (
                      <span className="rounded-full bg-clay/10 px-2.5 py-0.5 text-sm text-clay">
                        {rangoEdad}
                      </span>
                    ) : (
                      <span className="text-graysage">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">Sexo</dt>
                  <dd className="mt-1 capitalize text-charcoal">{sex || '—'}</dd>
                </div>
                {guardianId && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-graysage/70">
                      Representante
                    </dt>
                    <dd className="mt-1">
                      <Link
                        to={`/miembros/${guardianId}`}
                        className="text-sage underline-offset-2 hover:underline"
                      >
                        {guardianName ?? 'Ver representante'}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
              <p className="mb-3 text-sm font-medium text-graysage">Roles</p>
              <div className="flex flex-wrap gap-2">
                {roleIds.length === 0 && <span className="text-sm text-graysage/60">Sin roles.</span>}
                {roleIds.map((rid) => (
                  <span key={rid} className="rounded-full bg-sage-water/10 px-2.5 py-0.5 text-xs text-sage-dark">
                    {roleName(rid)}
                  </span>
                ))}
              </div>
              <p className="mb-3 mt-5 text-sm font-medium text-graysage">Equipos</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(teamMap).length === 0 && <span className="text-sm text-graysage/60">Sin equipos.</span>}
                {Object.entries(teamMap).map(([tid, leader]) => (
                  <span key={tid} className="rounded-full bg-clay/10 px-2.5 py-0.5 text-xs text-clay">
                    {teamName(tid)}
                    {leader && ' ★ líder'}
                  </span>
                ))}
              </div>
            </div>

            {/* Dependientes a cargo de este miembro */}
            <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-graysage">Dependientes</p>
                <button
                  type="button"
                  onClick={() => setShowDepForm((v) => !v)}
                  className="text-xs font-medium text-sage-dark hover:underline"
                >
                  {showDepForm ? 'Cancelar' : '+ Agregar dependiente'}
                </button>
              </div>

              {showDepForm && (
                <form onSubmit={addDependent} className="mb-4 grid gap-3 rounded-lg bg-cream/50 p-3 sm:grid-cols-2">
                  <input
                    required
                    value={depName}
                    onChange={(e) => setDepName(e.target.value)}
                    placeholder="Nombre completo"
                    className={inputCls}
                  />
                  <input
                    type="date"
                    value={depBirth}
                    onChange={(e) => setDepBirth(e.target.value)}
                    className={inputCls}
                  />
                  <select value={depSex} onChange={(e) => setDepSex(e.target.value)} className={inputCls}>
                    <option value="">Sexo —</option>
                    <option value="masculino">Masculino</option>
                    <option value="femenino">Femenino</option>
                  </select>
                  <div className="sm:col-span-2">
                    {depError && <p className="mb-2 text-xs text-clay">{depError}</p>}
                    <button
                      type="submit"
                      disabled={depSaving}
                      className="rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-medium text-cream transition hover:bg-sage disabled:opacity-60"
                    >
                      {depSaving ? 'Guardando…' : 'Guardar dependiente'}
                    </button>
                  </div>
                </form>
              )}

              {dependents.length === 0 ? (
                <p className="text-sm text-graysage/60">
                  Sin dependientes. Agrega niños o adultos sin móvil a cargo de esta persona.
                </p>
              ) : (
                <ul className="divide-y divide-clay-light/25">
                  {dependents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between py-2">
                      <Link
                        to={`/miembros/${d.id}`}
                        className="text-sm font-medium text-charcoal underline-offset-2 hover:text-sage-dark hover:underline"
                      >
                        {d.full_name}
                      </Link>
                      <span className="text-xs text-graysage">{ageRange(d.birth_date) ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          /* ---------- EDICIÓN ---------- */
          <form onSubmit={save} className="mt-6 space-y-6">
            <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Nombre completo</label>
                  <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Cédula / identificación</label>
                  <input value={cedula} onChange={(e) => setCedula(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Estado</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                    <option value="active">Activo</option>
                    <option value="prospect">Prospecto</option>
                    <option value="inactive">Inactivo</option>
                    <option value="cambio_membresia">Cambio de membresía</option>
                    <option value="archived">Archivado</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Correo</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Teléfono</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Fecha de nacimiento</label>
                  <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-graysage">Sexo</label>
                  <select value={sex} onChange={(e) => setSex(e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    <option value="masculino">Masculino</option>
                    <option value="femenino">Femenino</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-graysage">
                    <input
                      type="checkbox"
                      checked={isBaptized}
                      onChange={(e) => setIsBaptized(e.target.checked)}
                    />
                    ✝ Miembro bautizado
                  </label>
                  {isBaptized && (
                    <div className="mt-2">
                      <label className="mb-1 block text-xs text-graysage/70">
                        Fecha de bautismo <span className="text-graysage/50">(opcional)</span>
                      </label>
                      <input
                        type="date"
                        value={baptismDate}
                        onChange={(e) => setBaptismDate(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
              <p className="mb-2 text-sm font-medium text-graysage">Roles</p>
              <div className="flex flex-wrap gap-2">
                {roles
                  .filter((r) => r.key !== 'miembro')
                  .map((r) => {
                    const on = roleIds.includes(r.id)
                    const needsBaptism = rules.baptism_for_roles && !isBaptized
                    const preacherBlocked =
                      r.key === 'predicador' && rules.preacher_requires_leadership && !canPreach
                    const depsOk = depsSatisfied(r.requires, roleIds, Object.keys(teamMap))
                    const blocked = needsBaptism || preacherBlocked || !depsOk
                    const disabled = !on && blocked
                    const title = needsBaptism
                      ? 'Marca al miembro como bautizado para asignar roles'
                      : preacherBlocked
                        ? 'Solo líderes o pastores pueden ser predicadores'
                        : !depsOk
                          ? depHint(r.requires)
                          : undefined
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleRole(r.id)}
                        title={title}
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
              {rules.baptism_for_roles && !isBaptized && (
                <p className="mt-2 text-xs text-clay">
                  ✝ Este miembro debe estar bautizado para asignarle roles.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-clay-light/40 bg-white p-6">
              <p className="mb-2 text-sm font-medium text-graysage">Equipos</p>
              <div className="space-y-2">
                {teams.map((t) => {
                  const on = t.id in teamMap
                  const baptismBlocked = rules.baptism_for_teams && !isBaptized
                  const depsOk = depsSatisfied(t.requires, roleIds, Object.keys(teamMap))
                  const disabled = !on && (baptismBlocked || !depsOk)
                  return (
                    <div key={t.id} className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleTeam(t.id)}
                        title={
                          !disabled
                            ? undefined
                            : baptismBlocked
                              ? 'Marca al miembro como bautizado para unirlo a un equipo'
                              : depHint(t.requires)
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          on ? 'border-clay bg-clay text-cream' : 'border-graysage/25 text-graysage hover:border-clay'
                        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                      >
                        {t.name}
                      </button>
                      {on && (
                        <label className="flex items-center gap-1.5 text-xs text-graysage">
                          <input type="checkbox" checked={teamMap[t.id]} onChange={() => toggleLeader(t.id)} />
                          Líder interno
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
              {rules.baptism_for_teams && !isBaptized && (
                <p className="mt-2 text-xs text-clay">
                  ✝ Este miembro debe estar bautizado para pertenecer a un equipo.
                </p>
              )}
            </div>

            {error && <p className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage disabled:opacity-60"
              >
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                onClick={cancel}
                className="rounded-lg border border-graysage/25 px-4 py-2 text-sm text-graysage transition hover:bg-cream"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
