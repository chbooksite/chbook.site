// Asigna encargados + predicador de ejemplo a las actividades. Uso único, NO commitear.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: pastorRow } = await sb.from('members').select('church_id, id').not('user_id', 'is', null).limit(1).maybeSingle()
const church_id = pastorRow.church_id

const { data: roles } = await sb.from('roles').select('id, key').eq('church_id', church_id)
const roleId = Object.fromEntries(roles.map((r) => [r.key, r.id]))
const { data: mr } = await sb.from('member_roles').select('member_id, role_id')
const byRole = (key) => (mr ?? []).filter((r) => r.role_id === roleId[key]).map((r) => r.member_id)
const predicadores = byRole('predicador')
const lideres = byRole('lider')
const pastor = byRole('pastor_afiliado')[0] ?? pastorRow.id

const { data: scheds } = await sb.from('activity_schedules').select('id, type_id, responsible_team_id').eq('church_id', church_id)
const { data: types } = await sb.from('activity_types').select('id, key').eq('church_id', church_id)
const typeKey = Object.fromEntries(types.map((t) => [t.id, t.key]))
const pick = (arr, i) => (arr.length ? arr[i % arr.length] : null)

let li = 0, pi = 0, n = 0
for (const s of scheds) {
  const k = typeKey[s.type_id]
  const assignees = []
  if (['servicio_dominical', 'culto_oracion', 'sanidad', 'juvenil'].includes(k)) {
    const enc = k === 'servicio_dominical' ? pastor : pick(lideres, li++)
    if (enc) assignees.push({ kind: 'member', id: enc, memberIds: [] })
    const pred = pick(predicadores, pi++)
    if (pred && roleId.predicador) assignees.push({ kind: 'role', id: roleId.predicador, memberIds: [pred] })
  } else if (k === 'liderazgo') {
    if (pastor) assignees.push({ kind: 'member', id: pastor, memberIds: [] })
  } else if (['ayuno', 'escuela', 'clase_ninos'].includes(k)) {
    const enc = pick(lideres, li++); if (enc) assignees.push({ kind: 'member', id: enc, memberIds: [] })
  } else if (k === 'ensayo') {
    if (s.responsible_team_id) assignees.push({ kind: 'team', id: s.responsible_team_id, memberIds: [] })
  }
  if (assignees.length) { const { error } = await sb.from('activity_schedules').update({ assignees }).eq('id', s.id); if (error) { console.error(error.message); process.exit(1) } n++ }
}
console.log('✅ encargados asignados a', n, 'actividades · predicadores:', predicadores.length, '· líderes:', lideres.length)
