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

export interface AgeArea {
  name: string
  min: number | null
  max: number | null
}

// Área (por edad) que corresponde a una edad, o null si no cae en ninguna.
export function areaForAge(age: number | null, areas: AgeArea[]): string | null {
  if (age == null) return null
  for (const a of areas) {
    if (a.min == null) continue // equipo de servicio (sin rango)
    if (age >= a.min && (a.max == null || age <= a.max)) return a.name
  }
  return null
}

export const IDENTITY_TONE_CLASS: Record<IdentityTone, string> = {
  active: 'bg-sage-water/15 text-sage-dark',
  member: 'bg-sage/10 text-sage-dark',
  prospect: 'bg-gold/15 text-clay',
  inactive: 'bg-graysage/15 text-graysage',
  archived: 'bg-graysage/10 text-graysage/70',
}
