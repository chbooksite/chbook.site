import { useCallback, useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import InviteQR from '../components/InviteQR'
import PalettePicker from '../components/PalettePicker'
import PageShell, { PageLoading } from '../components/PageShell'
import { applyLargeText, readLargeText } from '../lib/preferences'
import { readInactivityDays } from '../lib/member'
import MapPicker, { type Coords } from '../components/MapPicker'
import AgeRangesEditor from '../components/AgeRangesEditor'
import { parseWkbPoint, toWktPoint } from '../lib/geo'
import { DEFAULT_AGE_RANGES, readAgeRanges, type AgeRangeDef } from '../lib/member'
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
  'w-full rounded-xl border border-clay-light bg-white px-3.5 py-2.5 text-base text-charcoal outline-none transition placeholder:text-faint focus:border-sage-dark focus:ring-4 focus:ring-sage/15'

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

  const chip = accent === 'sage' ? 'bg-sage-light text-sage-dark' : 'bg-vela-light text-clay'
  const addBtn = accent === 'sage' ? 'bg-sage-dark text-white hover:brightness-95' : 'bg-vela-dark text-white hover:brightness-110'

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
    <section className="tarjeta p-5 sm:p-6">
      <h2 className="font-serif text-lg font-bold text-charcoal">{title}</h2>
      <p className="mb-4 text-sm text-graysage">{subtitle}</p>

      <ul className="mb-4 divide-y divide-clay-light/70">
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
                      className="flex-1 rounded-lg border border-clay-light bg-cream px-3 py-1.5 text-sm outline-none focus:border-sage"
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
                          <button type="button" onClick={() => remove(it)} className="text-xs text-graysage hover:text-danger hover:underline">
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
          className="flex-1 rounded-lg border border-clay-light bg-cream px-3 py-2 text-sm outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${addBtn}`}
        >
          Agregar
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
    </section>
  )
}

export default function Settings() {
  const { membership, membershipLoading } = useAuth()
  const churchId = membership?.churchId
  // Pestaña activa en la URL (?tab=invitar) para poder enlazarla desde otras pantallas.
  const [params, setParams] = useSearchParams()
  const tab: SettingsTab = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as SettingsTab) : 'iglesia'
  const setTab = (t: SettingsTab) => setParams(t === 'iglesia' ? {} : { tab: t }, { replace: true })

  const [roles, setRoles] = useState<Item[]>([])
  const [teams, setTeams] = useState<Item[]>([])
  const [rules, setRules] = useState<ChurchRules>(DEFAULT_RULES)
  const [ageRanges, setAgeRanges] = useState<AgeRangeDef[]>(DEFAULT_AGE_RANGES)
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown>>({})
  const [church, setChurch] = useState({
    name: '',
    pastor: '',
    denomination: '',
    country: 'Venezuela',
    city: '',
    address: '',
    capacity: '',
    founded: '',
    inactivity: '60',
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
        .select('*') // '*' para no fallar si aún faltan columnas nuevas en la base
        .eq('id', churchId)
        .maybeSingle(),
    ])
    setRoles(parseItems(rolesRes.data))
    setTeams(parseItems(teamsRes.data))
    const c = churchRes.data
    if (c) {
      setChurch({
        name: c.name ?? '',
        pastor: c.pastor_name ?? '',
        denomination: c.denomination ?? '',
        country: c.country ?? '',
        city: c.city ?? '',
        address: c.address ?? '',
        capacity: c.capacity != null ? String(c.capacity) : '',
        founded: c.founded_year != null ? String(c.founded_year) : '',
        inactivity: String(readInactivityDays(c.settings)),
        code: c.code ?? '',
        plan: c.plan ?? '',
      })
      setCCoords(parseWkbPoint(c.location as string | null))
    }
    const settings = (c?.settings ?? {}) as Record<string, unknown>
    setSettingsRaw(settings)
    setRules(readRules(settings))
    setAgeRanges(readAgeRanges(settings))
    setLoading(false)
  }, [churchId])

  useEffect(() => {
    load()
  }, [load])

  const toggleRule = async (key: keyof ChurchRules) => {
    const next = { ...rules, [key]: !rules[key] }
    setRules(next)
    const nextSettings = { ...settingsRaw, rules: next }
    setSettingsRaw(nextSettings)
    await supabase.from('churches').update({ settings: nextSettings }).eq('id', churchId!)
  }

  const saveAgeRanges = async (next: AgeRangeDef[]) => {
    setAgeRanges(next)
    const nextSettings = { ...settingsRaw, age_ranges: next }
    setSettingsRaw(nextSettings)
    await supabase
      .from('churches')
      .update({ settings: nextSettings as Record<string, unknown> as never })
      .eq('id', churchId!)
  }

  const saveChurch = async () => {
    if (!church.name.trim()) {
      setChurchMsg('La iglesia necesita un nombre.')
      return
    }
    setSavingChurch(true)
    setChurchMsg(null)
    const days = Math.max(0, Math.round(Number(church.inactivity) || 0))
    const nextSettings = { ...settingsRaw, inactivity_days: days }
    setSettingsRaw(nextSettings)
    const base = {
      name: church.name.trim(),
      pastor_name: church.pastor.trim() || null,
      country: church.country || null,
      address: church.address.trim() || null,
      capacity: church.capacity ? Number(church.capacity) : null,
      settings: nextSettings as never,
      ...(cCoords ? { location: toWktPoint(cCoords.lat, cCoords.lng) } : {}),
    }
    const extra = {
      denomination: church.denomination.trim() || null,
      city: church.city.trim() || null,
      founded_year: church.founded ? Number(church.founded) : null,
    }
    let { error } = await supabase.from('churches').update({ ...base, ...extra }).eq('id', churchId!)
    // Base sin la migración 20261107120000: guardar lo demás y avisar.
    const missingColumns = !!error && /column|schema cache/i.test(error.message)
    if (missingColumns) ({ error } = await supabase.from('churches').update(base).eq('id', churchId!))
    setSavingChurch(false)
    setChurchMsg(error ? error.message : missingColumns ? 'Guardado, salvo denominación, ciudad y año: falta aplicar la migración requirements_f1 en Supabase.' : 'Guardado ✓')
  }

  if (membershipLoading || loading) {
    return <PageLoading />
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
    <PageShell
      width="mid"
      title="Ajustes"
      subtitle="Datos de tu iglesia, equipos, roles y reglas. Los elementos del sistema no se pueden borrar."
    >
        <SettingsTabs tab={tab} onChange={setTab} />

        <div key={tab} className="paso space-y-6">
          {tab === 'invitar' && (church.code ? (
            <section className="tarjeta p-5 sm:p-6">
              <h2 className="mb-1 font-serif text-lg text-charcoal">Invitar miembros</h2>
              <p className="mb-5 text-sm text-graysage">Imprime el QR y pégalo en el templo, o compártelo por WhatsApp.</p>
              <InviteQR code={church.code} churchName={church.name || 'tu iglesia'} />
            </section>
          ) : (
            <p className="tarjeta p-6 text-sm text-graysage">Tu iglesia aún no tiene código de invitación.</p>
          ))}

          {tab === 'apariencia' && <AppearanceSection />}

          {tab === 'iglesia' && (<>
          <section className="tarjeta p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-serif text-lg font-bold text-charcoal">Datos de la iglesia</h2>
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
                <label className="mb-1 block text-sm font-medium text-graysage">Pastor</label>
                <input value={church.pastor} onChange={(e) => setC('pastor', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Denominación</label>
                <input value={church.denomination} onChange={(e) => setC('denomination', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Año de fundación</label>
                <input type="number" min={1800} max={new Date().getFullYear()} value={church.founded} onChange={(e) => setC('founded', e.target.value)} className={inputCls} placeholder="Ej. 1998" />
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
                <label className="mb-1 block text-sm font-medium text-graysage">Ciudad</label>
                <input value={church.city} onChange={(e) => setC('city', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Dirección</label>
                <input value={church.address} onChange={(e) => setC('address', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graysage">Capacidad del templo (sillas)</label>
                <input
                  type="number"
                  min={0}
                  value={church.capacity}
                  onChange={(e) => setC('capacity', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-cream/70 p-4">
              <label className="block text-sm font-medium text-charcoal" htmlFor="inactivity">Pasar a Inactivo tras</label>
              <p className="mb-2 text-xs text-graysage">Un miembro activo que no asiste a ningún culto en ese tiempo pasa a Inactivo; vuelve a Activo cuando asiste. Faltar a un culto no basta. Escribe 0 para no usarlo.</p>
              <div className="flex items-center gap-2">
                <div className="w-28 shrink-0"><input id="inactivity" type="number" min={0} max={365} value={church.inactivity} onChange={(e) => setC('inactivity', e.target.value)} className={inputCls} /></div>
                <span className="text-sm text-graysage">días sin asistir</span>
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
                className="rounded-xl bg-sage-dark px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sage-deep disabled:opacity-60"
              >
                {savingChurch ? 'Guardando…' : 'Guardar cambios'}
              </button>
              {churchMsg && <span className="text-sm text-sage-dark">{churchMsg}</span>}
            </div>
          </section>

          <section className="tarjeta p-5 sm:p-6">
            <h2 className="font-serif text-lg font-bold text-charcoal">Rangos de edad</h2>
            <p className="mb-4 text-sm text-graysage">
              Define los cortes de edad de tu iglesia. Arrastra los pines en la línea o escribe la
              edad de inicio. Cada rango se puede renombrar, cambiar de color o desactivar. Se usan
              para clasificar a los miembros en toda la app.
            </p>
            <AgeRangesEditor value={ageRanges} onChange={saveAgeRanges} />
          </section>
          </>)}

          {tab === 'equipos' && (<>
          <section className="tarjeta p-5 sm:p-6">
            <h2 className="font-serif text-lg font-bold text-charcoal">Reglas de elegibilidad</h2>
            <p className="mb-4 text-sm text-graysage">
              Reglas generales que la app hace cumplir al asignar roles y equipos.
            </p>
            <ul className="divide-y divide-clay-light/70">
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
          </>)}
        </div>
    </PageShell>
  )
}

const TABS = [
  { key: 'iglesia', label: 'Iglesia', short: 'Iglesia', icon: <><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M10 21v-5h4v5" /></> },
  { key: 'equipos', label: 'Equipos y roles', short: 'Equipos', icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" /></> },
  { key: 'invitar', label: 'Invitar', short: 'Invitar', icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3h-3zM17 20h3v-3" /></> },
  { key: 'apariencia', label: 'Apariencia', short: 'Estilo', icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> },
] as const
type SettingsTab = (typeof TABS)[number]['key']

// Pestañas tipo segmento (vidrio); en móvil se desplazan en horizontal.
function SettingsTabs({ tab, onChange }: { tab: SettingsTab; onChange: (t: SettingsTab) => void }) {
  return (
    <div role="tablist" aria-label="Secciones de ajustes" className="vidrio mb-6 grid grid-cols-4 gap-1 p-1.5">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => onChange(t.key)}
          className={`flex flex-col items-center justify-center gap-1 rounded-[0.9rem] px-1 py-2 text-xs font-semibold transition sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm ${tab === t.key ? 'bg-sage-dark text-paper shadow-sm' : 'text-graysage hover:bg-white/60 hover:text-charcoal'}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>{t.icon}</svg>
          <span className="sm:hidden">{t.short}</span>
          <span className="hidden sm:inline">{t.label}</span>
        </button>
      ))}
    </div>
  )
}

// Apariencia (solo en este dispositivo): color principal y letra grande.
function AppearanceSection() {
  const [large, setLarge] = useState(readLargeText)
  const toggle = () => {
    applyLargeText(!large)
    setLarge(!large)
  }
  return (
    <div className="space-y-4">
    <section className="tarjeta p-5 sm:p-6">
      <h2 className="font-serif text-lg font-bold text-charcoal">Color principal</h2>
      <p className="mt-0.5 mb-4 text-sm text-graysage">Prueba otros tonos: toda la app cambia al instante. Se guarda en este dispositivo.</p>
      <PalettePicker />
    </section>
    <section className="tarjeta flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
      <div>
        <h2 className="font-serif text-lg font-bold text-charcoal">Letra grande</h2>
        <p className="mt-0.5 text-sm text-graysage">Aumenta el tamaño de todo el texto en este dispositivo.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={large}
        aria-label="Letra grande"
        onClick={toggle}
        className={`relative h-8 w-14 shrink-0 rounded-full transition ${large ? 'bg-sage-dark' : 'bg-clay-light'}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${large ? 'left-7' : 'left-1'}`} />
      </button>
    </section>
    </div>
  )
}
