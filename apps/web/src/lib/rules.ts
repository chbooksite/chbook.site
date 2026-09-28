// Reglas de elegibilidad de la iglesia (Capa B — curadas con interruptores).
// Se guardan en churches.settings.rules; los valores por defecto están activos.

export interface ChurchRules {
  baptism_for_roles: boolean
  baptism_for_teams: boolean
  leader_requires_team: boolean
  preacher_requires_leadership: boolean
}

export const DEFAULT_RULES: ChurchRules = {
  baptism_for_roles: true,
  baptism_for_teams: true,
  leader_requires_team: true,
  preacher_requires_leadership: true,
}

export const RULE_LABELS: { key: keyof ChurchRules; label: string; help: string }[] = [
  {
    key: 'baptism_for_roles',
    label: 'Bautizado para tener roles',
    help: 'Solo miembros bautizados pueden recibir roles (además del rol base "Miembro").',
  },
  {
    key: 'baptism_for_teams',
    label: 'Bautizado para pertenecer a equipos',
    help: 'Solo miembros bautizados pueden formar parte de un equipo o servicio.',
  },
  {
    key: 'leader_requires_team',
    label: 'Un líder debe estar en un equipo',
    help: 'Quien tenga el rol de Líder debe pertenecer al menos a un equipo.',
  },
  {
    key: 'preacher_requires_leadership',
    label: 'Predicador solo si es líder o pastor',
    help: 'El rol de Predicador solo puede asignarse a líderes o pastores.',
  },
]

// Lee las reglas desde churches.settings, aplicando los valores por defecto.
export function readRules(settings: unknown): ChurchRules {
  const s = (settings ?? {}) as { rules?: Partial<ChurchRules> }
  return { ...DEFAULT_RULES, ...(s.rules ?? {}) }
}

// Dependencias por ítem (rol/equipo): requiere AL MENOS UNO de los marcados.
export interface Requires {
  roles: string[]
  teams: string[]
}

export function readRequires(requires: unknown): Requires {
  const r = (requires ?? {}) as Partial<Requires>
  return { roles: r.roles ?? [], teams: r.teams ?? [] }
}

// Semántica O: sin dependencias → permitido; con dependencias → basta una.
export function depsSatisfied(req: Requires, roleIds: string[], teamIds: string[]): boolean {
  if (req.roles.length === 0 && req.teams.length === 0) return true
  return req.roles.some((r) => roleIds.includes(r)) || req.teams.some((t) => teamIds.includes(t))
}
