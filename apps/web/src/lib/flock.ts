import { supabase } from './supabase'
import { audienceIsEmpty, readAudience, type Audience } from './activity'
import { ageFromBirth, classifyAge, type AgeRangeDef } from './member'

// OVEJAS / rebaño de un líder. Un rol líder/pastor tiene a su cargo un conjunto de
// personas, definido con total libertad por un SEGMENTO combinable (`Audience`:
// edad, sexo, bautismo, equipo, rol… o toda la iglesia) MÁS una lista manual.
// Ovejas = (miembros que cumplen la audiencia) ∪ (manuales), sin el propio líder.
// Semántica de la audiencia: entre categorías = Y (intersección); dentro de una
// categoría = O (unión). Reutiliza el modelo `Audience` de las actividades.

// Roles que pueden tener ovejas a cargo (las "cabezas" de la iglesia).
export const FLOCK_ROLE_KEYS = ['lider', 'pastor_principal', 'pastor_afiliado']

export interface FlockMember {
  id: string
  sex: string | null
  is_baptized: boolean | null
  birth_date: string | null
  age_group: string | null
  roleIds: Set<string>
  teamIds: Set<string>
}

export interface Flock { audience: Audience; manual: string[] }

// Clave del rango de edad de un miembro (por fecha; si no, por age_group guardado).
export function memberAgeKey(m: FlockMember, ranges: AgeRangeDef[]): string | null {
  if (m.birth_date) return classifyAge(ageFromBirth(m.birth_date), ranges)?.key ?? null
  if (m.age_group) return ranges.find((r) => r.name === m.age_group)?.key ?? null
  return null
}

// ¿El miembro cumple la audiencia? Entre categorías = Y; dentro de categoría = O.
export function matchesAudience(m: FlockMember, a: Audience, ranges: AgeRangeDef[]): boolean {
  if (a.all) return true
  if (audienceIsEmpty(a)) return false
  if (a.ageKeys.length) { const k = memberAgeKey(m, ranges); if (!k || !a.ageKeys.includes(k)) return false }
  if (a.teamIds.length && !a.teamIds.some((t) => m.teamIds.has(t))) return false
  if (a.roleIds.length && !a.roleIds.some((r) => m.roleIds.has(r))) return false
  const bap = a.filters.filter((f) => f === 'baptized' || f === 'unbaptized')
  if (bap.length === 1 && Boolean(m.is_baptized) !== (bap[0] === 'baptized')) return false
  const sx = a.filters.filter((f) => f === 'masculino' || f === 'femenino')
  if (sx.length === 1 && m.sex !== sx[0]) return false
  return true
}

// Ids de las ovejas de un líder (sin incluirlo a él).
export function flockMemberIds(leaderId: string, flock: Flock, members: FlockMember[], ranges: AgeRangeDef[]): Set<string> {
  const out = new Set<string>(flock.manual)
  if (flock.audience.all || !audienceIsEmpty(flock.audience)) {
    for (const m of members) if (matchesAudience(m, flock.audience, ranges)) out.add(m.id)
  }
  out.delete(leaderId)
  return out
}

export const EMPTY_FLOCK: Flock = { audience: { all: false, roleIds: [], teamIds: [], ageKeys: [], filters: [] }, manual: [] }

export async function loadFlock(leaderId: string): Promise<Flock> {
  const { data } = await supabase.from('leader_flock').select('audience, manual_member_ids').eq('member_id', leaderId).maybeSingle()
  if (!data) return { ...EMPTY_FLOCK }
  return { audience: readAudience(data.audience), manual: (data.manual_member_ids ?? []) as string[] }
}

export async function saveFlock(leaderId: string, churchId: string, flock: Flock) {
  return supabase.from('leader_flock').upsert(
    { member_id: leaderId, church_id: churchId, audience: JSON.parse(JSON.stringify(flock.audience)), manual_member_ids: flock.manual, updated_at: new Date().toISOString() },
    { onConflict: 'member_id' },
  )
}
