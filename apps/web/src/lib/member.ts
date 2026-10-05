// Etiqueta de identidad del miembro — SOLO calculada, nunca un rol guardado.
//   Prospecto  → aún no aprobado por el pastor.
//   Miembro    → aprobado (estado activo) por defecto.
//   Miembro activo → aprobado + bautizado + participa en al menos un equipo.
//   Inactivo / Archivado → según el estado de ingreso.

export type IdentityTone = 'active' | 'member' | 'prospect' | 'inactive' | 'archived'

export interface Identity {
  text: string
  tone: IdentityTone
}

// Devuelve la etiqueta calculada, o null cuando NO debe mostrarse.
// La etiqueta "Miembro"/"Miembro activo" solo aplica a miembros SIN rol asignado
// (los que tienen rol se identifican por su rol). Prospecto/Inactivo/Archivado
// siempre se muestran (son estado de ingreso).
export function memberIdentity(
  status: string | null,
  isBaptized: boolean,
  teamCount: number,
  roleCount: number,
): Identity | null {
  switch (status) {
    case 'prospect':
      return { text: 'Prospecto', tone: 'prospect' }
    case 'inactive':
      return { text: 'Inactivo', tone: 'inactive' }
    case 'cambio_membresia':
      return { text: 'Cambio de membresía', tone: 'inactive' }
    case 'archived':
      return { text: 'Archivado', tone: 'archived' }
    default:
      if (roleCount > 0) return null
      return isBaptized && teamCount > 0
        ? { text: 'Miembro activo', tone: 'active' }
        : { text: 'Miembro', tone: 'member' }
  }
}

// Inconsistencia: no bautizado pero con roles/equipos que las reglas ACTIVAS
// exigirían con bautismo. Señala datos cargados cuando la regla estaba apagada.
export function isBaptismInconsistent(
  isBaptized: boolean,
  roleCount: number,
  teamCount: number,
  requireRoles: boolean,
  requireTeams: boolean,
): boolean {
  if (isBaptized) return false
  return (requireRoles && roleCount > 0) || (requireTeams && teamCount > 0)
}

// Edad calculada a partir de la fecha de nacimiento.
export function ageFromBirth(birthDate: string | null): number | null {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

// Rangos de edad CONFIGURABLES por iglesia. Cada rango inicia en `start` y
// cubre hasta el inicio del siguiente activo. Se guardan en churches.settings.age_ranges.
export interface AgeRangeDef {
  key: string
  name: string
  color: string // hex
  start: number // edad de inicio
  enabled: boolean
}

export const DEFAULT_AGE_RANGES: AgeRangeDef[] = [
  { key: 'maternal', name: 'Maternal', color: '#ec4899', start: 0, enabled: true },
  { key: 'ninos', name: 'Niños', color: '#f59e0b', start: 6, enabled: true },
  { key: 'adolescentes', name: 'Adolescentes', color: '#84cc16', start: 13, enabled: true },
  { key: 'jovenes', name: 'Jóvenes', color: '#0ea5e9', start: 18, enabled: true },
  { key: 'adultos', name: 'Adultos', color: '#6366f1', start: 29, enabled: true },
  { key: 'adultos_mayores', name: 'Adultos mayores', color: '#78716c', start: 60, enabled: true },
]

export function readAgeRanges(settings: unknown): AgeRangeDef[] {
  const s = (settings ?? {}) as { age_ranges?: AgeRangeDef[] }
  return Array.isArray(s.age_ranges) && s.age_ranges.length ? s.age_ranges : DEFAULT_AGE_RANGES
}

// Rango (def) que corresponde a una edad, según los cortes ACTIVOS.
export function classifyAge(age: number | null, ranges: AgeRangeDef[]): AgeRangeDef | null {
  if (age == null) return null
  const active = ranges.filter((r) => r.enabled).sort((a, b) => a.start - b.start)
  let match: AgeRangeDef | null = null
  for (const r of active) {
    if (age >= r.start) match = r
    else break
  }
  return match
}

// Categorías gruesas para cuando no hay fecha ni edad exacta.
export const COARSE_AGE = ['Niño', 'Joven', 'Adulto'] as const

// Clasificación a GUARDAR cuando no hay fecha de nacimiento (desde edad o categoría).
export function resolveAgeGroup(ageInput: string, category: string, ranges: AgeRangeDef[]): string | null {
  const n = Number(ageInput)
  if (ageInput.trim() !== '' && !Number.isNaN(n)) return classifyAge(n, ranges)?.name ?? null
  if (category) return category
  return null
}

// Clasificación a MOSTRAR: fecha de nacimiento (precisa, según cortes) o el age_group guardado.
export function displayAgeRange(
  birthDate: string | null,
  ageGroup: string | null,
  ranges: AgeRangeDef[],
): string | null {
  if (birthDate) return classifyAge(ageFromBirth(birthDate), ranges)?.name ?? null
  return ageGroup || null
}

export const IDENTITY_TONE_CLASS: Record<IdentityTone, string> = {
  active: 'bg-sage-water/15 text-sage-dark',
  member: 'bg-sage/10 text-sage-dark',
  prospect: 'bg-gold/15 text-clay',
  inactive: 'bg-graysage/15 text-graysage',
  archived: 'bg-graysage/10 text-graysage/70',
}
