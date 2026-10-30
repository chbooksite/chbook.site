import { useState } from 'react'
import { AUDIENCE_ALL, type Audience } from '../lib/activity'

type IdOpt = { id: string; name: string }
type KeyOpt = { key: string; name: string }

// Selector de "¿a quién va dirigido?" con etiquetas. Reglas pedidas:
// - Chips de ámbito (Toda la iglesia / Equipos / Roles / Edades). Tocar un ámbito
//   DESPLIEGA sus sub-botones, para no abarrotar.
// - Los ámbitos NO son excluyentes entre sí: se pueden combinar equipos + roles +
//   edades. Solo "Toda la iglesia" es excluyente (cancela todos los filtros).
// - Sub-selecciones con color propio por categoría.
export default function AudiencePicker({
  value,
  onChange,
  roles = [],
  teams = [],
  ages = [],
}: {
  value: Audience
  onChange: (a: Audience) => void
  roles?: IdOpt[]
  teams?: IdOpt[]
  ages?: KeyOpt[]
}) {
  const [open, setOpen] = useState({
    teams: value.teamIds.length > 0,
    roles: value.roleIds.length > 0,
    ages: value.ageKeys.length > 0,
  })
  const toggleArr = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const pickAll = () => { setOpen({ teams: false, roles: false, ages: false }); onChange({ ...AUDIENCE_ALL }) }
  const toggleScope = (cat: 'teams' | 'roles' | 'ages') => {
    const willOpen = !open[cat]
    const next = { ...open, [cat]: willOpen }
    setOpen(next)
    // al cerrar un ámbito se quitan sus selecciones (se retira ese filtro)
    const v: Audience = { ...value, all: false }
    if (!willOpen) { if (cat === 'teams') v.teamIds = []; if (cat === 'roles') v.roleIds = []; if (cat === 'ages') v.ageKeys = [] }
    onChange(next.teams || next.roles || next.ages ? v : { ...AUDIENCE_ALL })
  }
  const toggleTeam = (id: string) => onChange({ ...value, all: false, teamIds: toggleArr(value.teamIds, id) })
  const toggleRole = (id: string) => onChange({ ...value, all: false, roleIds: toggleArr(value.roleIds, id) })
  const toggleAge = (k: string) => onChange({ ...value, all: false, ageKeys: toggleArr(value.ageKeys, k) })

  const scopeCls = (on: boolean) => `rounded-full px-3 py-1 text-xs font-medium transition ${on ? 'bg-sage-light text-sage-dark' : 'bg-cream text-graysage hover:bg-sage/10'}`
  const subCls = (on: boolean, onCls: string) => `rounded-full px-2.5 py-1 text-xs transition ${on ? onCls : 'bg-cream text-graysage hover:bg-sage-light/60'}`

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={pickAll} className={scopeCls(value.all)}>Toda la iglesia</button>
        {teams.length > 0 && <button type="button" onClick={() => toggleScope('teams')} className={scopeCls(open.teams)}>Equipos</button>}
        {roles.length > 0 && <button type="button" onClick={() => toggleScope('roles')} className={scopeCls(open.roles)}>Roles</button>}
        {ages.length > 0 && <button type="button" onClick={() => toggleScope('ages')} className={scopeCls(open.ages)}>Edades</button>}
      </div>
      {open.teams && teams.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{teams.map((t) => (<button key={t.id} type="button" onClick={() => toggleTeam(t.id)} className={subCls(value.teamIds.includes(t.id), 'bg-clay text-white')}>{t.name}</button>))}</div>
      )}
      {open.roles && roles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{roles.map((r) => (<button key={r.id} type="button" onClick={() => toggleRole(r.id)} className={subCls(value.roleIds.includes(r.id), 'bg-gold text-white')}>{r.name}</button>))}</div>
      )}
      {open.ages && ages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{ages.map((a) => (<button key={a.key} type="button" onClick={() => toggleAge(a.key)} className={subCls(value.ageKeys.includes(a.key), 'bg-sand text-charcoal')}>{a.name}</button>))}</div>
      )}
    </div>
  )
}
