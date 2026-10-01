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
import {
  AGE_RANGES,
  ageFromBirth,
  ageTone,
  COARSE_AGE,
  displayAgeRange,
  IDENTITY_TONE_CLASS,
  isBaptismInconsistent,
  memberIdentity,
  resolveAgeGroup,
} from '../lib/member'

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
  birthDate: string | null
  ageGroupVal: string | null
  guardianId: string | null
  createdAt: string | null
  roleIds: string[]
  teams: { teamId: string; isLeader: boolean }[]
}

interface DupMatch {
  id: string
  full_name: string
  cedula: string | null
  birth_date: string | null
  phone: string | null
  email: string | null
  status: string | null
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
  birth_date: string | null
  age_group: string | null
  guardian_id: string | null
  created_at: string | null
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

  // Búsqueda y filtros
  const [search, setSearch] = useState('')
  const [fRole, setFRole] = useState('')
  const [fTeam, setFTeam] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fBaptized, setFBaptized] = useState('')
  const [fAge, setFAge] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [expandedDeps, setExpandedDeps] = useState<Set<string>>(new Set())

  // Formulario de alta
  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [newCedula, setNewCedula] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'active' | 'prospect'>('active')
  const [newBirth, setNewBirth] = useState('')
  const [newAge, setNewAge] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newSex, setNewSex] = useState('')
  const [newBaptized, setNewBaptized] = useState(false)
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dupMatches, setDupMatches] = useState<DupMatch[]>([])
  const [cedulaBlock, setCedulaBlock] = useState<DupMatch | null>(null)

  const load = useCallback(async () => {
    if (!churchId) return
    setLoading(true)
    const [rolesRes, teamsRes, membersRes, churchRes] = await Promise.all([
      supabase.from('roles').select('id, key, name, requires').order('name'),
      supabase.from('teams').select('id, key, name, requires').order('name'),
      supabase
        .from('members')
        .select('id, full_name, status, email, phone, is_baptized, birth_date, age_group, guardian_id, created_at, member_roles(role_id), member_teams(team_id, is_leader)')
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
        birthDate: m.birth_date,
        ageGroupVal: m.age_group,
        guardianId: m.guardian_id,
        createdAt: m.created_at,
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
    setNewCedula('')
    setEmail('')
    setPhone('')
    setStatus('active')
    setNewBirth('')
    setNewAge('')
    setNewCategory('')
    setNewSex('')
    setNewBaptized(false)
    setRoleIds([])
    setTeamIds([])
    setError(null)
    setDupMatches([])
    setCedulaBlock(null)
  }

  const findDuplicates = async (): Promise<DupMatch[]> => {
    const ced = newCedula.trim()
    const ph = phone.trim()
    const em = email.trim()
    const name = fullName.trim()
    const conds: string[] = []
    if (ced) conds.push(`cedula.eq.${ced}`)
    if (ph) conds.push(`phone.eq.${ph}`)
    if (em) conds.push(`email.eq.${em}`)
    if (name) conds.push(`full_name.ilike.${name}`)
    if (!conds.length) return []
    const { data } = await supabase
      .from('members')
      .select('id, full_name, cedula, birth_date, phone, email, status')
      .or(conds.join(','))
    return (data ?? []) as DupMatch[]
  }

  const doInsert = async () => {
    if (!churchId) return
    setSaving(true)
    setError(null)
    const { data: created, error: insErr } = await supabase
      .from('members')
      .insert({
        church_id: churchId,
        full_name: fullName.trim(),
        cedula: newCedula.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        birth_date: newBirth || null,
        age_group: newBirth ? null : resolveAgeGroup(newAge, newCategory),
        sex: newSex || null,
        is_baptized: newBaptized,
        status,
      })
      .select('id')
      .single()

    if (insErr || !created) {
      setError(
        insErr?.message?.includes('members_church_cedula_uniq')
          ? 'Ya existe un miembro con esa cédula en tu iglesia.'
          : (insErr?.message ?? 'No se pudo crear el miembro.'),
      )
      setSaving(false)
      return
    }

    if (roleIds.length) {
      await supabase.from('member_roles').insert(roleIds.map((rid) => ({ member_id: created.id, role_id: rid })))
    }
    if (teamIds.length) {
      await supabase.from('member_teams').insert(teamIds.map((tid) => ({ member_id: created.id, team_id: tid })))
    }

    resetForm()
    setShowForm(false)
    setSaving(false)
    load()
  }

  // Confirma bautismo (si aplica) y crea.
  const finalize = () => {
    if (!newBaptized && (roleIds.length > 0 || teamIds.length > 0)) {
      if (
        !window.confirm(
          'Este miembro no está bautizado pero tiene roles o equipos asignados. ¿Crear de todos modos?',
        )
      ) {
        return
      }
    }
    setDupMatches([])
    setCedulaBlock(null)
    doInsert()
  }

  const createMember = async (e: FormEvent) => {
    e.preventDefault()
    if (!churchId) return
    setError(null)
    setDupMatches([])
    setCedulaBlock(null)

    // Debe llenarse al menos un dato de identidad/contacto.
    if (!newCedula.trim() && !phone.trim() && !email.trim()) {
      setError('Llena al menos uno: cédula, teléfono o correo.')
      return
    }

    // Debe indicarse la edad de alguna forma.
    if (!newBirth && !newAge.trim() && !newCategory) {
      setError('Indica la edad: fecha de nacimiento, edad, o categoría (niño/joven/adulto).')
      return
    }

    // Regla: un líder debe pertenecer al menos a un equipo.
    const leaderRole = roles.find((r) => r.key === 'lider')
    if (
      rules.leader_requires_team &&
      leaderRole &&
      roleIds.includes(leaderRole.id) &&
      teamIds.length === 0
    ) {
      setError('Un líder debe pertenecer al menos a un equipo. Asigna un equipo o quita el rol Líder.')
      return
    }

    // Detección de duplicados (dentro de tu iglesia).
    const matches = await findDuplicates()
    const ced = newCedula.trim()
    const cedMatch = ced ? matches.find((m) => (m.cedula ?? '').trim() === ced) : undefined
    if (cedMatch) {
      setCedulaBlock(cedMatch)
      return
    }
    if (matches.length) {
      setDupMatches(matches)
      return
    }
    finalize()
  }

  const approve = async (id: string) => {
    await supabase.from('members').update({ status: 'active' }).eq('id', id)
    load()
  }

  const setMemberStatus = async (id: string, status: string) => {
    await supabase.from('members').update({ status }).eq('id', id)
    load()
  }
  const archiveFromList = (m: MemberRow) => {
    if (
      window.confirm(`¿Archivar a ${m.full_name}? Se ocultará de la lista, pero sus datos se conservan.`)
    ) {
      setMemberStatus(m.id, 'archived')
    }
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

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const memberRange = (m: MemberRow) => displayAgeRange(m.birthDate, m.ageGroupVal)
  const AGE_MID: Record<string, number> = {
    Maternal: 3, Niños: 9, Niño: 9, Adolescentes: 15, Jóvenes: 23, Joven: 23,
    Adultos: 44, Adulto: 44, 'Adultos mayores': 70,
  }
  const sortAge = (m: MemberRow): number => {
    const a = ageFromBirth(m.birthDate)
    if (a != null) return a
    if (m.ageGroupVal && AGE_MID[m.ageGroupVal] != null) return AGE_MID[m.ageGroupVal]
    return 999
  }

  const filtered = members.filter((m) => {
    if (search) {
      const q = norm(search)
      if (!norm(m.full_name).includes(q) && !(m.email && norm(m.email).includes(q))) return false
    }
    if (fStatus) {
      if ((m.status ?? 'active') !== fStatus) return false
    } else if (m.status === 'archived') {
      return false // por defecto los archivados no aparecen
    }
    if (fRole && !m.roleIds.includes(fRole)) return false
    if (fTeam && !m.teams.some((t) => t.teamId === fTeam)) return false
    if (fBaptized === 'yes' && !m.isBaptized) return false
    if (fBaptized === 'no' && m.isBaptized) return false
    if (fAge && memberRange(m) !== fAge) return false
    return true
  })
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'age') return sortAge(a) - sortAge(b)
    if (sortBy === 'created') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    return a.full_name.localeCompare(b.full_name)
  })

  // Dependientes agrupados por representante (para la sublista desplegable).
  const depsByGuardian: Record<string, MemberRow[]> = {}
  for (const m of members) {
    if (m.guardianId) (depsByGuardian[m.guardianId] ??= []).push(m)
  }
  const toggleDeps = (id: string) =>
    setExpandedDeps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectCls =
    'rounded-lg border border-graysage/25 bg-cream/40 px-2.5 py-2 text-sm text-charcoal outline-none focus:border-sage'

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-charcoal">Miembros</h1>
            <p className="text-sm text-graysage">
              {sorted.length === members.length
                ? `${members.length} en tu iglesia`
                : `${sorted.length} de ${members.length}`}
            </p>
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
                <label className="mb-1 block text-sm font-medium text-graysage">Cédula / identificación</label>
                <input value={newCedula} onChange={(e) => setNewCedula(e.target.value)} className={inputCls} />
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
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">
                  Fecha de nacimiento
                </label>
                <input type="date" value={newBirth} onChange={(e) => setNewBirth(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Edad</label>
                <input
                  type="number"
                  min={0}
                  value={newAge}
                  onChange={(e) => setNewAge(e.target.value)}
                  className={inputCls}
                  placeholder="Si no hay fecha"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Categoría de edad</label>
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {COARSE_AGE.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-graysage/70">
                  Edad obligatoria: indica fecha de nacimiento, edad o categoría (basta una).
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">
                  Sexo <span className="text-graysage/60">(opcional)</span>
                </label>
                <select value={newSex} onChange={(e) => setNewSex(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  <option value="masculino">Masculino</option>
                  <option value="femenino">Femenino</option>
                </select>
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

            <p className="text-xs text-graysage/70">
              Llena al menos uno: cédula, teléfono o correo.
            </p>

            {cedulaBlock && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-medium text-red-700">Cédula duplicada</p>
                <p className="mt-1 text-red-600">
                  Ya existe un miembro con esa cédula:{' '}
                  <Link to={`/miembros/${cedulaBlock.id}`} className="font-medium underline">
                    {cedulaBlock.full_name}
                  </Link>
                  . No se puede duplicar; cambia la cédula o abre ese miembro.
                </p>
              </div>
            )}

            {dupMatches.length > 0 && (
              <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm">
                <p className="font-medium text-clay">Posibles duplicados</p>
                <p className="mt-1 text-graysage">
                  Hay miembros con datos parecidos. Revisa antes de crear:
                </p>
                <ul className="mt-2 divide-y divide-clay-light/30">
                  {dupMatches.map((d) => (
                    <li key={d.id} className="py-2">
                      <Link
                        to={`/miembros/${d.id}`}
                        className="font-medium text-charcoal underline-offset-2 hover:underline"
                      >
                        {d.full_name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-graysage">
                        {d.cedula && <span>cédula: {d.cedula}</span>}
                        {d.birth_date && <span>nac: {d.birth_date}</span>}
                        {d.phone && <span>tel: {d.phone}</span>}
                        {d.email && <span>correo: {d.email}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={finalize}
                    className="rounded-lg bg-clay px-3 py-1.5 text-xs font-medium text-cream transition hover:bg-clay/80"
                  >
                    Es otra persona, crear de todos modos
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupMatches([])}
                    className="rounded-lg border border-graysage/25 px-3 py-1.5 text-xs text-graysage transition hover:bg-cream"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

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

        {/* Búsqueda y filtros */}
        {!loading && members.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o correo…"
              className={`min-w-48 flex-1 ${inputCls}`}
            />
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
              <option value="">Estado: todos</option>
              <option value="active">Activos / Miembros</option>
              <option value="prospect">Prospectos</option>
              <option value="inactive">Inactivos</option>
              <option value="archived">Archivados</option>
            </select>
            <select value={fRole} onChange={(e) => setFRole(e.target.value)} className={selectCls}>
              <option value="">Rol: todos</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select value={fTeam} onChange={(e) => setFTeam(e.target.value)} className={selectCls}>
              <option value="">Equipo: todos</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select value={fBaptized} onChange={(e) => setFBaptized(e.target.value)} className={selectCls}>
              <option value="">Bautismo: todos</option>
              <option value="yes">Bautizados</option>
              <option value="no">No bautizados</option>
            </select>
            <select value={fAge} onChange={(e) => setFAge(e.target.value)} className={selectCls}>
              <option value="">Edad: todas</option>
              {AGE_RANGES.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={selectCls}>
              <option value="name">Orden: nombre</option>
              <option value="age">Orden: edad</option>
              <option value="created">Orden: ingreso</option>
            </select>
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <p className="font-mono text-sm text-graysage">Cargando miembros…</p>
        ) : members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-graysage/30 p-10 text-center">
            <p className="text-graysage">Aún no hay miembros. Agrega el primero con el botón de arriba.</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-graysage/30 p-10 text-center">
            <p className="text-graysage">Ningún miembro coincide con la búsqueda o los filtros.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-clay-light/40 bg-white">
            {sorted.map((m, i) => {
              const deps = depsByGuardian[m.id] ?? []
              const expanded = expandedDeps.has(m.id)
              const range = memberRange(m)
              return (
                <div key={m.id} className={i > 0 ? 'border-t border-clay-light/25' : ''}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-40 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
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
                        {deps.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleDeps(m.id)}
                            className="text-xs text-graysage hover:text-sage-dark"
                          >
                            {expanded ? '▾' : '▸'} {deps.length} dep.
                          </button>
                        )}
                      </span>
                      {m.email && <p className="font-mono text-xs text-graysage">{m.email}</p>}
                    </div>

                    {range && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ageTone(range)}`}>
                        {range}
                      </span>
                    )}

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
                      {isBaptismInconsistent(
                        m.isBaptized,
                        m.roleIds.length,
                        m.teams.length,
                        rules.baptism_for_roles,
                        rules.baptism_for_teams,
                      ) && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                          No bautizado
                        </span>
                      )}
                      {m.status === 'prospect' && (
                        <button
                          type="button"
                          onClick={() => approve(m.id)}
                          className="rounded-lg border border-sage/40 px-2.5 py-1 text-xs font-medium text-sage-dark transition hover:bg-sage/10"
                        >
                          Aprobar
                        </button>
                      )}
                      {m.status === 'archived' ? (
                        <button
                          type="button"
                          onClick={() => setMemberStatus(m.id, 'active')}
                          className="rounded-lg border border-sage/40 px-2.5 py-1 text-xs font-medium text-sage-dark transition hover:bg-sage/10"
                        >
                          Restaurar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => archiveFromList(m)}
                          className="rounded-lg border border-graysage/25 px-2.5 py-1 text-xs text-graysage transition hover:bg-cream"
                        >
                          Archivar
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && deps.length > 0 && (
                    <ul className="border-t border-clay-light/20 bg-cream/40 py-1">
                      {deps.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between py-1 pl-10 pr-5 text-sm"
                        >
                          <Link
                            to={`/miembros/${d.id}`}
                            className="text-charcoal underline-offset-2 hover:text-sage-dark hover:underline"
                          >
                            ↳ {d.full_name}
                          </Link>
                          <span className="text-xs text-graysage">{memberRange(d) ?? '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
