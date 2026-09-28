import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import AppHeader from '../components/AppHeader'
import { DEFAULT_RULES, RULE_LABELS, readRules, type ChurchRules } from '../lib/rules'

interface Item {
  id: string
  key: string
  name: string
  is_system: boolean | null
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Sección reutilizable de catálogo (Equipos o Roles).
function CatalogSection({
  title,
  subtitle,
  items,
  accent,
  onCreate,
  onRename,
  onDelete,
}: {
  title: string
  subtitle: string
  items: Item[]
  accent: 'sage' | 'clay'
  onCreate: (name: string) => Promise<string | null>
  onRename: (id: string, name: string) => Promise<string | null>
  onDelete: (id: string) => Promise<string | null>
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chip =
    accent === 'sage' ? 'bg-sage-water/10 text-sage-dark' : 'bg-clay/10 text-clay'
  const addBtn =
    accent === 'sage' ? 'bg-sage hover:bg-sage-dark' : 'bg-clay hover:bg-clay/80'

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
    if (
      !window.confirm(
        `¿Eliminar "${item.name}"? Se quitará de todos los miembros que lo tengan.`,
      )
    )
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
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 py-2">
            {editingId === it.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-lg border border-graysage/25 bg-cream/40 px-3 py-1.5 text-sm outline-none focus:border-sage"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => saveEdit(it.id)}
                  disabled={busy}
                  className="text-sm font-medium text-sage-dark hover:underline"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="text-sm text-graysage hover:underline"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className={`rounded-full px-2.5 py-0.5 text-sm ${chip}`}>{it.name}</span>
                {it.is_system ? (
                  <span className="text-xs text-graysage/50">sistema</span>
                ) : (
                  <div className="ml-auto flex items-center gap-3">
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
                    <button
                      type="button"
                      onClick={() => remove(it)}
                      className="text-xs text-graysage hover:text-clay hover:underline"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
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
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!churchId) return
    setLoading(true)
    const [rolesRes, teamsRes, churchRes] = await Promise.all([
      supabase.from('roles').select('id, key, name, is_system').order('is_system', { ascending: false }).order('name'),
      supabase.from('teams').select('id, key, name, is_system').order('is_system', { ascending: false }).order('name'),
      supabase.from('churches').select('settings').eq('id', churchId).maybeSingle(),
    ])
    setRoles((rolesRes.data ?? []) as Item[])
    setTeams((teamsRes.data ?? []) as Item[])
    const settings = (churchRes.data?.settings ?? {}) as Record<string, unknown>
    setSettingsRaw(settings)
    setRules(readRules(settings))
    setLoading(false)
  }, [churchId])

  const toggleRule = async (key: keyof ChurchRules) => {
    const next = { ...rules, [key]: !rules[key] }
    setRules(next)
    await supabase
      .from('churches')
      .update({ settings: { ...settingsRaw, rules: next } })
      .eq('id', churchId!)
  }

  useEffect(() => {
    load()
  }, [load])

  if (membershipLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (!membership) return <Navigate to="/onboarding" replace />

  const uniqueKey = (base: string, existing: Item[]) => {
    let key = slugify(base) || 'item'
    const keys = existing.map((x) => x.key)
    let i = 1
    const root = key
    while (keys.includes(key)) {
      i++
      key = `${root}_${i}`
    }
    return key
  }

  // Roles
  const createRole = async (name: string) => {
    const { error } = await supabase
      .from('roles')
      .insert({ church_id: churchId!, key: uniqueKey(name, roles), name: name.trim(), is_system: false })
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

  // Equipos
  const createTeam = async (name: string) => {
    const { error } = await supabase
      .from('teams')
      .insert({ church_id: churchId!, key: uniqueKey(name, teams), name: name.trim(), is_system: false })
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

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-1 font-serif text-2xl text-charcoal">Ajustes</h1>
        <p className="mb-8 text-sm text-graysage">
          Personaliza los equipos y roles de tu iglesia. Los del sistema no se pueden borrar.
        </p>

        <div className="space-y-6">
          <section className="rounded-2xl border border-clay-light/40 bg-white p-6">
            <h2 className="font-serif text-lg text-charcoal">Reglas de elegibilidad</h2>
            <p className="mb-4 text-sm text-graysage">
              Condiciones que la app hace cumplir al asignar roles y equipos. Actívalas o
              desactívalas según tu iglesia.
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
                    className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
                      rules[key] ? 'bg-sage' : 'bg-graysage/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                        rules[key] ? 'left-[1.375rem]' : 'left-0.5'
                      }`}
                    />
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
            onCreate={createTeam}
            onRename={renameTeam}
            onDelete={deleteTeam}
          />
          <CatalogSection
            title="Roles"
            subtitle="Etiquetas de cargo/permiso que se asignan a los miembros."
            items={roles}
            accent="sage"
            onCreate={createRole}
            onRename={renameRole}
            onDelete={deleteRole}
          />
        </div>
      </main>
    </div>
  )
}
