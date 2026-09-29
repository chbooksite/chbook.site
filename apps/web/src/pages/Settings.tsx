import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import MapPicker, { type Coords } from '../components/MapPicker'
import { parseWkbPoint, toWktPoint } from '../lib/geo'
import {
  DEFAULT_RULES,
  RULE_LABELS,
  readRules,
  readRequires,
  type ChurchRules,
  type Requires,
} from '../lib/rules'

const COUNTRIES = ['Colombia', 'Venezuela', 'México', 'USA/Europa', 'Otro']

const inputCls =
  'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

interface Option {
  id: string
  name: string
}

interface Item {
  id: string
  key: string
  name: string
  is_system: boolean | null
  requires: Requires
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Sección reutilizable de catálogo (Equipos o Roles) con editor de dependencias.
function CatalogSection({
  title,
  subtitle,
  items,
  accent,
  allRoles,
  allTeams,
  onCreate,
  onRename,
  onDelete,
  onToggleDep,
}: {
  title: string
  subtitle: string
  items: Item[]
  accent: 'sage' | 'clay'
  allRoles: Option[]
  allTeams: Option[]
  onCreate: (name: string) => Promise<string | null>
  onRename: (id: string, name: string) => Promise<string | null>
  onDelete: (id: string) => Promise<string | null>
  onToggleDep: (item: Item, kind: keyof Requires, targetId: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chip = accent === 'sage' ? 'bg-sage-water/10 text-sage-dark' : 'bg-clay/10 text-clay'
  const addBtn = accent === 'sage' ? 'bg-sage hover:bg-sage-dark' : 'bg-clay hover:bg-clay/80'

  const nameOf = (id: string) =>
    allRoles.find((r) => r.id === id)?.name ?? allTeams.find((t) => t.id === id)?.name ?? '—'

  const add = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    const err = await onCreate(newName)
    setBusy(false)
    if (err) setError(err)
    else setNewName('')
  }

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return
    setBusy(true)
    setError(null)
    const err = await onRename(id, editName)
    setBusy(false)
    if (err) setError(err)
    else setEditingId(null)
  }

  const remove = async (item: Item) => {
    if (!window.confirm(`¿Eliminar "${item.name}"? Se quitará de todos los miembros que lo tengan.`))
      return
    setBusy(true)
    setError(null)
    const err = await onDelete(item.id)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <section className="rounded-2xl border border-clay-light/40 bg-white p-6">
      <h2 className="font-serif text-lg text-charcoal">{title}</h2>
      <p className="mb-4 text-sm text-graysage">{subtitle}</p>

      <ul className="mb-4 divide-y divide-clay-light/25">
        {items.map((it) => {
          const deps = [...it.requires.roles, ...it.requires.teams]
          const expanded = expandedId === it.id
          return (
            <li key={it.id} className="py-2">
              <div className="flex items-center gap-3">
                {editingId === it.id ? (
                  <>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 rounded-lg border border-graysage/25 bg-cream/40 px-3 py-1.5 text-sm outline-none focus:border-sage"
                      autoFocus
                    />
                    <button type="button" onClick={() => saveEdit(it.id)} disabled={busy} className="text-sm font-medium text-sage-dark hover:underline">
                      Guardar
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-sm text-graysage hover:underline">
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`rounded-full px-2.5 py-0.5 text-sm ${chip}`}>{it.name}</span>
                    {it.is_system && <span className="text-xs text-graysage/50">sistema</span>}
                    <div className="ml-auto flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : it.id)}
                        className="text-xs text-graysage hover:text-sage-dark hover:underline"
                      >
                        Dependencias{deps.length ? ` (${deps.length})` : ''}
                      </button>
                      {!it.is_system && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(it.id)
                              setEditName(it.name)
                            }}
                            className="text-xs text-graysage hover:text-sage-dark hover:underline"
                          >
                            Renombrar
                          </button>
                          <button type="button" onClick={() => remove(it)} className="text-xs text-graysage hover:text-clay hover:underline">
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Resumen de dependencias cuando está colapsado */}
              {!expanded && deps.length > 0 && (
                <p className="mt-1 text-xs text-graysage/70">
                  Requiere: {deps.map(nameOf).join(', ')}
                </p>
              )}

              {/* Editor de dependencias */}
              {expanded && (
                <div className="mt-2 rounded-lg bg-cream/50 p-3">
                  <p className="mb-2 text-xs text-graysage">
                    Para asignar «{it.name}», el miembro debe tener <b>todos</b> estos:
                  </p>
                  <p className="text-[0.7rem] font-medium uppercase tracking-wide text-graysage/60">Roles</p>
                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                    {allRoles
                      .filter((r) => r.id !== it.id)
                      .map((r) => (
                        <label key={r.id} className="flex items-center gap-1.5 text-xs text-graysage">
                          <input
                            type="checkbox"
                            checked={it.requires.roles.includes(r.id)}
                            onChange={() => onToggleDep(it, 'roles', r.id)}
                          />
                          {r.name}
                        </label>
                      ))}
                  </div>
                  <p className="text-[0.7rem] font-medium uppercase tracking-wide text-graysage/60">Equipos</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {allTeams
                      .filter((t) => t.id !== it.id)
                      .map((t) => (
                        <label key={t.id} className="flex items-center gap-1.5 text-xs text-graysage">
                          <input
                            type="checkbox"
                            checked={it.requires.teams.includes(t.id)}
                            onChange={() => onToggleDep(it, 'teams', t.id)}
                          />
                          {t.name}
                        </label>
                      ))}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={`Nuevo ${title.toLowerCase().slice(0, -1)}…`}
          className="flex-1 rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-cream transition disabled:opacity-60 ${addBtn}`}
        >
          Agregar
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}
    </section>
  )
}

export default function Settings() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId

  const [roles, setRoles] = useState<Item[]>([])
  const [teams, setTeams] = useState<Item[]>([])
  const [rules, setRules] = useState<ChurchRules>(DEFAULT_RULES)
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown>>({})
  const [church, setChurch] = useState({
    name: '',
    country: 'Venezuela',
    address: '',
    capacity: '',
    code: '',
    plan: '',
  })
  const setC = (k: keyof typeof church, v: string) => setChurch((p) => ({ ...p, [k]: v }))
  const [cCoords, setCCoords] = useState<Coords | null>(null)
  const [savingChurch, setSavingChurch] = useState(false)
  const [churchMsg, setChurchMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const parseItems = (data: unknown[] | null): Item[] =>
    (data ?? []).map((x) => {
      const r = x as { id: string; key: string; name: string; is_system: boolean | null; requires: unknown }
      return { id: r.id, key: r.key, name: r.name, is_system: r.is_system, requires: readRequires(r.requires) }
    })

  const load = useCallback(async () => {
    if (!churchId) return
    const [rolesRes, teamsRes, churchRes] = await Promise.all([
      supabase.from('roles').select('id, key, name, is_system, requires').order('is_system', { ascending: false }).order('name'),
      supabase.from('teams').select('id, key, name, is_system, requires').order('is_system', { ascending: false }).order('name'),
      supabase
        .from('churches')
        .select('name, country, address, capacity, code, plan, location, settings')
        .eq('id', churchId)
        .maybeSingle(),
    ])
    setRoles(parseItems(rolesRes.data))
    setTeams(parseItems(teamsRes.data))
    const c = churchRes.data
    if (c) {
      setChurch({
        name: c.name ?? '',
        country: c.country ?? '',
        address: c.address ?? '',
        capacity: c.capacity != null ? String(c.capacity) : '',
        code: c.code ?? '',
        plan: c.plan ?? '',
      })
      setCCoords(parseWkbPoint(c.location as string | null))
    }
    const settings = (c?.settings ?? {}) as Record<string, unknown>
    setSettingsRaw(settings)
    setRules(readRules(settings))
    setLoading(false)
  }, [churchId])

  useEffect(() => {
    load()
  }, [load])

  const toggleRule = async (key: keyof ChurchRules) => {
    const next = { ...rules, [key]: !rules[key] }
    setRules(next)
    await supabase.from('churches').update({ settings: { ...settingsRaw, rules: next } }).eq('id', churchId!)
  }

  const saveChurch = async () => {
    setSavingChurch(true)
    setChurchMsg(null)
    const { error } = await supabase
      .from('churches')
      .update({
        name: church.name.trim(),
        country: church.country || null,
        address: church.address.trim() || null,
        capacity: church.capacity ? Number(church.capacity) : null,
        ...(cCoords ? { location: toWktPoint(cCoords.lat, cCoords.lng) } : {}),
      })
      .eq('id', churchId!)
    setSavingChurch(false)
    setChurchMsg(error ? error.message : 'Guardado ✓')
  }

  if (membershipLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  const uniqueKey = (base: string, existing: Item[]) => {
    const root = slugify(base) || 'item'
    const keys = existing.map((x) => x.key)
    let key = root
    let i = 1
    while (keys.includes(key)) {
      i++
      key = `${root}_${i}`
    }
    return key
  }

  const allRoles: Option[] = roles.map((r) => ({ id: r.id, name: r.name }))
  const allTeams: Option[] = teams.map((t) => ({ id: t.id, name: t.name }))

  // Roles
  const createRole = async (name: string) => {
    const { error } = await supabase.from('roles').insert({ church_id: churchId!, key: uniqueKey(name, roles), name: name.trim(), is_system: false })
    await load()
    return error?.message ?? null
  }
  const renameRole = async (id: string, name: string) => {
    const { error } = await supabase.from('roles').update({ name: name.trim() }).eq('id', id)
    await load()
    return error?.message ?? null
  }
  const deleteRole = async (id: string) => {
    const { error } = await supabase.from('roles').delete().eq('id', id)
    await load()
    return error?.message ?? null
  }
  const toggleDepRole = async (item: Item, kind: keyof Requires, targetId: string) => {
    const arr = item.requires[kind]
    const nextArr = arr.includes(targetId) ? arr.filter((x) => x !== targetId) : [...arr, targetId]
    const nextReq = { ...item.requires, [kind]: nextArr }
    setRoles((prev) => prev.map((r) => (r.id === item.id ? { ...r, requires: nextReq } : r)))
    await supabase.from('roles').update({ requires: nextReq }).eq('id', item.id)
  }

  // Equipos
  const createTeam = async (name: string) => {
    const { error } = await supabase.from('teams').insert({ church_id: churchId!, key: uniqueKey(name, teams), name: name.trim(), is_system: false })
    await load()
    return error?.message ?? null
  }
  const renameTeam = async (id: string, name: string) => {
    const { error } = await supabase.from('teams').update({ name: name.trim() }).eq('id', id)
    await load()
    return error?.message ?? null
  }
  const deleteTeam = async (id: string) => {
    const { error } = await supabase.from('teams').delete().eq('id', id)
    await load()
    return error?.message ?? null
  }
  const toggleDepTeam = async (item: Item, kind: keyof Requires, targetId: string) => {
    const arr = item.requires[kind]
    const nextArr = arr.includes(targetId) ? arr.filter((x) => x !== targetId) : [...arr, targetId]
    const nextReq = { ...item.requires, [kind]: nextArr }
    setTeams((prev) => prev.map((t) => (t.id === item.id ? { ...t, requires: nextReq } : t)))
    await supabase.from('teams').update({ requires: nextReq }).eq('id', item.id)
  }

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-1 font-serif text-2xl text-charcoal">Ajustes</h1>
        <p className="mb-8 text-sm text-graysage">
          Personaliza los equipos, roles y sus dependencias. Los del sistema no se pueden borrar.
        </p>

        <div className="space-y-6">
          <section className="rounded-2xl border border-clay-light/40 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-serif text-lg text-charcoal">Datos de la iglesia</h2>
              <span className="font-mono text-xs text-graysage">
                {church.code}
                {church.plan ? ` · ${church.plan.replace('_', ' ')}` : ''}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Nombre</label>
                <input value={church.name} onChange={(e) => setC('name', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">País</label>
                <select value={church.country} onChange={(e) => setC('country', e.target.value)} className={inputCls}>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Dirección</label>
                <input value={church.address} onChange={(e) => setC('address', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Nº de miembros (estimado)</label>
                <input
                  type="number"
                  min={0}
                  value={church.capacity}
                  onChange={(e) => setC('capacity', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-graysage">Ubicación del auditorio</p>
              <MapPicker value={cCoords} onChange={setCCoords} />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={saveChurch}
                disabled={savingChurch}
                className="rounded-lg bg-sage-dark px-4 py-2 text-sm font-medium text-cream transition hover:bg-sage disabled:opacity-60"
              >
                {savingChurch ? 'Guardando…' : 'Guardar cambios'}
              </button>
              {churchMsg && <span className="text-sm text-sage-dark">{churchMsg}</span>}
            </div>
          </section>

          <section className="rounded-2xl border border-clay-light/40 bg-white p-6">
            <h2 className="font-serif text-lg text-charcoal">Reglas de elegibilidad</h2>
            <p className="mb-4 text-sm text-graysage">
              Reglas generales que la app hace cumplir al asignar roles y equipos.
            </p>
            <ul className="divide-y divide-clay-light/25">
              {RULE_LABELS.map(({ key, label, help }) => (
                <li key={key} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal">{label}</p>
                    <p className="text-xs text-graysage">{help}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rules[key]}
                    onClick={() => toggleRule(key)}
                    className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${rules[key] ? 'bg-sage' : 'bg-graysage/30'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${rules[key] ? 'left-[1.375rem]' : 'left-0.5'}`} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <CatalogSection
            title="Equipos"
            subtitle="Grupos de servicio de tu iglesia (con líder interno)."
            items={teams}
            accent="clay"
            allRoles={allRoles}
            allTeams={allTeams}
            onCreate={createTeam}
            onRename={renameTeam}
            onDelete={deleteTeam}
            onToggleDep={toggleDepTeam}
          />
          <CatalogSection
            title="Roles"
            subtitle="Etiquetas de cargo/permiso que se asignan a los miembros."
            items={roles}
            accent="sage"
            allRoles={allRoles}
            allTeams={allTeams}
            onCreate={createRole}
            onRename={renameRole}
            onDelete={deleteRole}
            onToggleDep={toggleDepRole}
          />
        </div>
      </main>
    </div>
  )
}
