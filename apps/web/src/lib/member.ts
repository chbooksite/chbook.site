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

export function memberIdentity(
  status: string | null,
  isBaptized: boolean,
  teamCount: number,
): Identity {
  switch (status) {
    case 'prospect':
      return { text: 'Prospecto', tone: 'prospect' }
    case 'inactive':
      return { text: 'Inactivo', tone: 'inactive' }
    case 'archived':
      return { text: 'Archivado', tone: 'archived' }
    default:
      return isBaptized && teamCount > 0
        ? { text: 'Miembro activo', tone: 'active' }
        : { text: 'Miembro', tone: 'member' }
  }
}

export const IDENTITY_TONE_CLASS: Record<IdentityTone, string> = {
  active: 'bg-sage-water/15 text-sage-dark',
  member: 'bg-sage/10 text-sage-dark',
  prospect: 'bg-gold/15 text-clay',
  inactive: 'bg-graysage/15 text-graysage',
  archived: 'bg-graysage/10 text-graysage/70',
}
