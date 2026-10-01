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

// Clasificación por rango de edad — un recurso del miembro (como el sexo) para
// usar en métricas, filtros y funciones posteriores. No son equipos.
export const AGE_RANGES: { name: string; min: number; max: number | null }[] = [
  { name: 'Maternal', min: 0, max: 5 },
  { name: 'Niños', min: 6, max: 12 },
  { name: 'Adolescentes', min: 13, max: 17 },
  { name: 'Jóvenes', min: 18, max: 28 },
  { name: 'Adultos', min: 29, max: 59 },
  { name: 'Adultos mayores', min: 60, max: null },
]

export function ageRange(birthDate: string | null): string | null {
  const age = ageFromBirth(birthDate)
  if (age == null) return null
  return ageRangeFromAge(age)
}

// Rango a partir de una edad (número).
export function ageRangeFromAge(age: number): string | null {
  for (const r of AGE_RANGES) {
    if (age >= r.min && (r.max == null || age <= r.max)) return r.name
  }
  return null
}

// Categorías gruesas para cuando no hay fecha ni edad exacta.
export const COARSE_AGE = ['Niño', 'Joven', 'Adulto'] as const

// Clasificación a GUARDAR cuando no hay fecha de nacimiento (desde edad o categoría).
export function resolveAgeGroup(ageInput: string, category: string): string | null {
  const n = Number(ageInput)
  if (ageInput.trim() !== '' && !Number.isNaN(n)) return ageRangeFromAge(n)
  if (category) return category
  return null
}

// Clasificación a MOSTRAR: fecha de nacimiento (precisa) o el age_group guardado.
export function displayAgeRange(birthDate: string | null, ageGroup: string | null): string | null {
  if (birthDate) return ageRange(birthDate)
  return ageGroup || null
}

export const IDENTITY_TONE_CLASS: Record<IdentityTone, string> = {
  active: 'bg-sage-water/15 text-sage-dark',
  member: 'bg-sage/10 text-sage-dark',
  prospect: 'bg-gold/15 text-clay',
  inactive: 'bg-graysage/15 text-graysage',
  archived: 'bg-graysage/10 text-graysage/70',
}
