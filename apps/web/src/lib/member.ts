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

export const IDENTITY_TONE_CLASS: Record<IdentityTone, string> = {
  active: 'bg-sage-water/15 text-sage-dark',
  member: 'bg-sage/10 text-sage-dark',
  prospect: 'bg-gold/15 text-clay',
  inactive: 'bg-graysage/15 text-graysage',
  archived: 'bg-graysage/10 text-graysage/70',
}
