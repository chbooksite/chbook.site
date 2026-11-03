import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import PageShell, { PageLoading } from '../components/PageShell'
import Avatar from '../components/Avatar'
import { btnPrimary, btnSecondary, fieldCls } from '../lib/ui'
import {
  DEFAULT_RULES,
  depsSatisfied,
  readRequires,
  readRules,
  type ChurchRules,
  type Requires,
} from '../lib/rules'
import {
  ageFromBirth,
  COARSE_AGE,
  DEFAULT_AGE_RANGES,
  displayAgeRange,
  IDENTITY_TONE_CLASS,
  isBaptismInconsistent,
  memberIdentity,
  readAgeRanges,
  resolveAgeGroup,
  type AgeRangeDef,
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

// Filtro rápido: un toque para las vistas que más usa el pastor.
type Quick = 'all' | 'active' | 'prospect' | 'inactive' | 'noteam' | 'unbaptized'
const isActive = (m: MemberRow) => !m.status || m.status === 'active'
const QUICK_TEST: Record<Exclude<Quick, 'all'>, (m: MemberRow) => boolean> = {
  active: isActive,
  prospect: (m) => m.status === 'prospect',
  inactive: (m) => m.status === 'inactive' || m.status === 'cambio_membresia',
  noteam: (m) => isActive(m) && m.teams.length === 0,
  unbaptized: (m) => isActive(m) && !m.isBaptized,
}
const PILLS: { quick: Quick; label: string }[] = [
  { quick: 'all', label: 'Todos' },
  { quick: 'active', label: 'Activos' },
  { quick: 'prospect', label: 'Prospectos' },
  { quick: 'inactive', label: 'Inactivos' },
  { quick: 'noteam', label: 'Sin equipo' },
  { quick: 'unbaptized', label: 'Sin bautizar' },
]
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)
const SUMMARY: { quick: Quick; label: string; warn?: boolean; icon: ReactNode; hint: (n: number, total: number) => string }[] = [
  { quick: 'all', label: 'Personas', icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" /></>, hint: () => 'En tu iglesia, sin archivados' },
  { quick: 'active', label: 'Activos', icon: <path d="M20 6 9 17l-5-5" />, hint: (n, t) => `${pct(n, t)}% del total` },
  { quick: 'prospect', label: 'Por aprobar', warn: true, icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></>, hint: (n) => (n ? 'Toca para revisarlos' : 'Nadie espera aprobación') },
  { quick: 'noteam', label: 'Sin equipo', warn: true, icon: <><path d="M7 11V7a5 5 0 0 1 10 0v4" /><path d="M4 11h16v4a8 8 0 0 1-16 0z" /></>, hint: (n) => (n ? 'Activos que aún no sirven' : 'Todos sirven en un equipo') },
]

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

function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-sm font-medium text-graysage">{label}</span>
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              on ? 'border-sage-dark/40 bg-sage-light font-medium text-sage-dark' : 'border-clay-light bg-white text-graysage hover:border-sage hover:text-charcoal'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Members() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [roles, setRoles] = useState<Catalog[]>([])
  const [teams, setTeams] = useState<Catalog[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [rules, setRules] = useState<ChurchRules>(DEFAULT_RULES)
  const [ageRanges, setAgeRanges] = useState<AgeRangeDef[]>(DEFAULT_AGE_RANGES)
  const [loading, setLoading] = useState(true)
  // Entradas desde Personas: ?equipo=<id>, ?edad=<rango>, ?ver=<atajo>, ?nuevo=1.
  const [params] = useSearchParams()

  // Búsqueda y filtros
  const [search, setSearch] = useState('')
  const [fRoles, setFRoles] = useState<string[]>([])
  const [fTeams, setFTeams] = useState<string[]>(() => (params.get('equipo') ? [params.get('equipo')!] : []))
  const [fStatuses, setFStatuses] = useState<string[]>([])
  const [fBaptized, setFBaptized] = useState<string[]>([])
  const [fAges, setFAges] = useState<string[]>(() => (params.get('edad') ? [params.get('edad')!] : []))
  const [sortBy, setSortBy] = useState('name')
  const [expandedDeps, setExpandedDeps] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  // Filtro rápido (pastillas y tarjetas de resumen), además de los filtros avanzados.
  const [quick, setQuick] = useState<Quick>(() => {
    const v = params.get('ver')
    return v && v in QUICK_TEST ? (v as Quick) : 'all'
  })
  const toggleArr = (arr: string[], setArr: (v: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  // Formulario de alta
  const [showForm, setShowForm] = useState(() => params.get('nuevo') === '1')
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
    setAgeRanges(readAgeRanges(churchRes.data?.settings))
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

  if (membershipLoading) return <PageLoading />
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
        age_group: newBirth ? null : resolveAgeGroup(newAge, newCategory, ageRanges),
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
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${IDENTITY_TONE_CLASS[id.tone]}`}>
        {id.text}
      </span>
    )
  }

  const inputCls = fieldCls

  const selectedRoleKeys = roleIds
    .map((rid) => roles.find((r) => r.id === rid)?.key)
    .filter(Boolean) as string[]
  const canPreachNew = ['lider', 'pastor_principal', 'pastor_afiliado'].some((k) =>
    selectedRoleKeys.includes(k),
  )
  const rolesBlocked = rules.baptism_for_roles && !newBaptized
  const teamsBlocked = rules.baptism_for_teams && !newBaptized

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const memberRange = (m: MemberRow) => displayAgeRange(m.birthDate, m.ageGroupVal, ageRanges)
  const sortAge = (m: MemberRow): number => {
    const a = ageFromBirth(m.birthDate)
    if (a != null) return a
    const r = ageRanges.find((x) => x.name === m.ageGroupVal)
    return r ? r.start : 999
  }

  const filtered = members.filter((m) => {
    if (search) {
      const q = norm(search)
      if (!norm(m.full_name).includes(q) && !(m.email && norm(m.email).includes(q))) return false
    }
    if (fStatuses.length) {
      if (!fStatuses.includes(m.status ?? 'active')) return false
    } else if (m.status === 'archived') {
      return false // por defecto los archivados no aparecen
    }
    if (fRoles.length && !fRoles.some((r) => m.roleIds.includes(r))) return false
    if (fTeams.length && !fTeams.some((t) => m.teams.some((mt) => mt.teamId === t))) return false
    if (fBaptized.length === 1) {
      if (fBaptized[0] === 'yes' && !m.isBaptized) return false
      if (fBaptized[0] === 'no' && m.isBaptized) return false
    }
    if (fAges.length && !fAges.includes(memberRange(m) ?? '')) return false
    if (quick !== 'all' && !QUICK_TEST[quick](m)) return false
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
    'rounded-xl border border-clay-light bg-white px-3 py-2.5 text-sm text-charcoal outline-none transition focus:border-sage-dark focus:ring-4 focus:ring-sage/15'
  const activeFilters = fRoles.length + fTeams.length + fStatuses.length + fBaptized.length + fAges.length
  const prospects = members.filter((m) => m.status === 'prospect').length
  const visible = members.filter((m) => m.status !== 'archived')
  const countOf = (q: Quick) => (q === 'all' ? visible.length : visible.filter(QUICK_TEST[q]).length)

  return (
    <PageShell
      back={{ to: '/personas', label: 'Personas' }}
      title="Miembros"
      subtitle={
        <>
          {sorted.length === members.length ? `${members.length} personas en tu iglesia` : `${sorted.length} de ${members.length} personas`}
          {prospects > 0 && (
            <button type="button" onClick={() => setQuick('prospect')} className="ml-2 rounded-full bg-vela-light px-2.5 py-0.5 text-sm font-medium text-clay transition hover:brightness-95">
              {prospects} por aprobar
            </button>
          )}
        </>
      }
      actions={
        <button
          type="button"
          onClick={() => {
            resetForm()
            setShowForm((v) => !v)
          }}
          className={showForm ? btnSecondary : btnPrimary}
        >
          {showForm ? 'Cancelar' : '+ Agregar miembro'}
        </button>
      }
    >

        {/* Formulario de alta */}
        {showForm && (
          <form
            onSubmit={createMember}
            className="tarjeta subir mb-8 space-y-5 p-5 sm:p-7"
          >
            <h2 className="font-serif text-xl font-bold text-charcoal">Nueva persona</h2>
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

            <label className="flex w-fit cursor-pointer items-center gap-2.5 rounded-xl border border-clay-light bg-cream/60 px-3.5 py-2.5 text-sm font-medium text-charcoal">
              <input type="checkbox" className="h-4 w-4 accent-sage-dark" checked={newBaptized} onChange={(e) => setNewBaptized(e.target.checked)} />
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
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          on
                            ? 'border-sage-dark/40 bg-sage-light font-medium text-sage-dark'
                            : 'border-clay-light bg-white text-graysage hover:border-sage'
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
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        on
                          ? 'border-vela/40 bg-vela-light font-medium text-clay'
                          : 'border-clay-light bg-white text-graysage hover:border-vela'
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
              <div className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm">
                <p className="font-medium text-danger">Cédula duplicada</p>
                <p className="mt-1 text-danger">
                  Ya existe un miembro con esa cédula:{' '}
                  <Link to={`/miembros/${cedulaBlock.id}`} className="font-medium underline">
                    {cedulaBlock.full_name}
                  </Link>
                  . No se puede duplicar; cambia la cédula o abre ese miembro.
                </p>
              </div>
            )}

            {dupMatches.length > 0 && (
              <div className="rounded-xl border border-vela/30 bg-vela-light/60 p-4 text-sm">
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

            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className={btnPrimary}
            >
              {saving ? 'Guardando…' : 'Guardar miembro'}
            </button>
          </form>
        )}

        {/* Resumen: cada tarjeta filtra la lista */}
        {!loading && members.length > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Resumen">
            {SUMMARY.map((c, i) => {
              const n = countOf(c.quick)
              const on = quick === c.quick
              return (
                <button
                  key={c.quick}
                  type="button"
                  onClick={() => setQuick(on && c.quick !== 'all' ? 'all' : c.quick)}
                  aria-pressed={on}
                  className={`subir group flex flex-col p-4 text-left transition duration-300 hover:-translate-y-0.5 sm:p-5 ${on ? 'rounded-[1.25rem] bg-sage-dark text-paper shadow-[0_14px_36px_-16px_rgba(30,42,36,0.6)]' : 'vidrio'}`}
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${on ? 'text-paper/75' : 'text-graysage'}`}>{c.label}</span>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${on ? 'bg-white/10 text-gold' : c.warn && n ? 'bg-vela-light text-clay' : 'bg-sage-dark/[0.08] text-sage-dark'}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>{c.icon}</svg>
                    </span>
                  </span>
                  <span className={`mt-2 text-[2rem] font-bold leading-none tracking-[-0.03em] tabular-nums ${on ? 'text-paper' : 'text-charcoal'}`}>{n}</span>
                  <span className={`mt-1.5 text-xs ${on ? 'text-paper/70' : 'text-graysage'}`}>{c.hint(n, visible.length)}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Búsqueda y filtros (multi-selección) */}
        {!loading && members.length > 0 && (
          <div className="mb-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre o correo…"
                  className={`${inputCls} pl-11`}
                  aria-label="Buscar miembros"
                />
              </div>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={selectCls} aria-label="Ordenar">
                <option value="name">Orden: nombre</option>
                <option value="age">Orden: edad</option>
                <option value="created">Orden: ingreso</option>
              </select>
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`${btnSecondary} ${showFilters || activeFilters ? 'border-sage-dark/40 text-sage-dark' : ''}`}
                aria-expanded={showFilters}
              >
                Filtros{activeFilters > 0 && <span className="rounded-full bg-sage-dark px-1.5 text-xs text-white">{activeFilters}</span>}
              </button>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Filtro rápido">
              {PILLS.map((p) => {
                const on = quick === p.quick
                return (
                  <button
                    key={p.quick}
                    type="button"
                    onClick={() => setQuick(p.quick)}
                    aria-pressed={on}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${on ? 'border-sage-dark bg-sage-dark text-paper' : 'border-white/80 bg-white/60 text-graysage hover:bg-white hover:text-charcoal'}`}
                  >
                    {p.label}
                    <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-white/15 text-paper' : 'bg-charcoal/[0.06] text-graysage'}`}>{countOf(p.quick)}</span>
                  </button>
                )
              })}
            </div>
            {showFilters && (
            <div className="tarjeta subir space-y-3 p-4">
            <FilterRow
              label="Edad"
              options={ageRanges.filter((r) => r.enabled).map((r) => ({ value: r.name, label: r.name }))}
              selected={fAges}
              onToggle={(v) => toggleArr(fAges, setFAges, v)}
            />
            <FilterRow
              label="Roles"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
              selected={fRoles}
              onToggle={(v) => toggleArr(fRoles, setFRoles, v)}
            />
            <FilterRow
              label="Equipos"
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
              selected={fTeams}
              onToggle={(v) => toggleArr(fTeams, setFTeams, v)}
            />
            <FilterRow
              label="Estado"
              options={[
                { value: 'active', label: 'Activos' },
                { value: 'prospect', label: 'Prospectos' },
                { value: 'inactive', label: 'Inactivos' },
                { value: 'cambio_membresia', label: 'Cambio membresía' },
                { value: 'archived', label: 'Archivados' },
              ]}
              selected={fStatuses}
              onToggle={(v) => toggleArr(fStatuses, setFStatuses, v)}
            />
            <FilterRow
              label="Bautismo"
              options={[
                { value: 'yes', label: 'Bautizados' },
                { value: 'no', label: 'No bautizados' },
              ]}
              selected={fBaptized}
              onToggle={(v) => toggleArr(fBaptized, setFBaptized, v)}
            />
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => { setFRoles([]); setFTeams([]); setFStatuses([]); setFBaptized([]); setFAges([]); setQuick('all') }}
                className="text-sm font-medium text-sage-dark hover:underline"
              >
                Quitar filtros
              </button>
            )}
            </div>
            )}
          </div>
        )}

        {/* Grupo elegido (equipo o edad, p. ej. al entrar desde Personas): siempre a la vista */}
        {(fTeams.length > 0 || fAges.length > 0) && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-graysage">Viendo:</span>
            {fTeams.map((t) => (
              <button key={t} type="button" onClick={() => setFTeams(fTeams.filter((x) => x !== t))} className="inline-flex items-center gap-1.5 rounded-full bg-sage-dark px-3 py-1 font-medium text-paper transition hover:bg-sage-deep" aria-label={`Quitar equipo ${teamName(t)}`}>
                Equipo {teamName(t)} <span aria-hidden>✕</span>
              </button>
            ))}
            {fAges.map((a) => (
              <button key={a} type="button" onClick={() => setFAges(fAges.filter((x) => x !== a))} className="inline-flex items-center gap-1.5 rounded-full bg-sage-dark px-3 py-1 font-medium text-paper transition hover:bg-sage-deep" aria-label={`Quitar edad ${a}`}>
                {a} <span aria-hidden>✕</span>
              </button>
            ))}
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <div className="tarjeta space-y-4 p-5" aria-label="Cargando miembros">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4">
                <span className="h-11 w-11 rounded-full bg-cream" />
                <span className="h-4 w-48 rounded bg-cream" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            title="Aún no hay miembros"
            text="Agrega a la primera persona de tu iglesia. Después podrás asignarle roles y equipos."
            action={<button type="button" onClick={() => { resetForm(); setShowForm(true) }} className={btnPrimary}>+ Agregar miembro</button>}
          />
        ) : sorted.length === 0 ? (
          <EmptyState title="Nadie coincide" text="Prueba con otro nombre o quita algún filtro." />
        ) : (
          <div className="tarjeta overflow-hidden">
            {sorted.map((m, i) => {
              const deps = depsByGuardian[m.id] ?? []
              const expanded = expandedDeps.has(m.id)
              return (
                <div key={m.id} className={`transition hover:bg-beige-light ${i > 0 ? 'border-t border-clay-light/60' : ''}`}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                    <div className="flex min-w-48 flex-1 items-center gap-3.5">
                      <Link to={`/miembros/${m.id}`} tabIndex={-1}><Avatar name={m.full_name} size={44} /></Link>
                      <div className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link
                          to={`/miembros/${m.id}`}
                          className="text-base font-semibold text-charcoal underline-offset-2 hover:text-sage-dark hover:underline"
                        >
                          {m.full_name}
                        </Link>
                        {m.isBaptized && (
                          <span title="Bautizado" className="text-sage-dark">
                            ✝
                          </span>
                        )}
                        {deps.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleDeps(m.id)}
                            className="rounded-full bg-cream px-2 py-0.5 text-xs font-medium text-graysage hover:text-sage-dark"
                          >
                            {expanded ? '▾' : '▸'} {deps.length} {deps.length === 1 ? 'dependiente' : 'dependientes'}
                          </button>
                        )}
                      </span>
                      <p className="truncate text-sm text-graysage">
                        {[memberRange(m), m.phone, m.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                      </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {m.roleIds.map((id) => (
                        <span key={id} className="rounded-full bg-sage-light px-2.5 py-0.5 text-xs font-medium text-sage-dark">
                          {roleName(id)}
                        </span>
                      ))}
                      {m.teams.map((t) => (
                        <span key={t.teamId} className="rounded-full bg-vela-light px-2.5 py-0.5 text-xs font-medium text-clay">
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
                        <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
                          No bautizado
                        </span>
                      )}
                      {m.status === 'prospect' && (
                        <button
                          type="button"
                          onClick={() => approve(m.id)}
                          className="rounded-lg bg-sage-dark px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-105"
                        >
                          Aprobar
                        </button>
                      )}
                      {m.status === 'archived' ? (
                        <button
                          type="button"
                          onClick={() => setMemberStatus(m.id, 'active')}
                          className="rounded-lg border border-sage-dark/30 px-3 py-1.5 text-sm font-medium text-sage-dark transition hover:bg-sage-light"
                        >
                          Restaurar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => archiveFromList(m)}
                          className="rounded-lg px-3 py-1.5 text-sm text-graysage transition hover:bg-cream hover:text-charcoal"
                        >
                          Archivar
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && deps.length > 0 && (
                    <ul className="border-t border-clay-light/60 bg-beige-light py-1.5">
                      {deps.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between py-1.5 pl-[4.5rem] pr-5 text-sm"
                        >
                          <Link
                            to={`/miembros/${d.id}`}
                            className="flex items-center gap-2.5 text-charcoal underline-offset-2 hover:text-sage-dark hover:underline"
                          >
                            <Avatar name={d.full_name} size={28} />
                            {d.full_name}
                          </Link>
                          <span className="text-sm text-graysage">{memberRange(d) ?? '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </PageShell>
  )
}

// Estado vacío amable: explica qué pasa y qué hacer.
function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="tarjeta flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-vela-light text-2xl" aria-hidden>🕯️</span>
      <p className="font-serif text-xl font-bold text-charcoal">{title}</p>
      <p className="mt-1 max-w-sm text-graysage">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
