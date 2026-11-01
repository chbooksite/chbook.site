-- Capa 2 — Encargados a nivel de actividad recurrente.
-- Quién es responsable de la actividad (equipos/roles/personas), reutilizando la
-- gente del Pilar A. Formato jsonb: [{ kind: 'team'|'role'|'member', id, memberIds }].
-- Para kind 'member', id es el id del miembro y memberIds va vacío.
-- El override por ocurrencia (fecha concreta) se añade en un paso posterior.

alter table public.activity_schedules
  add column if not exists assignees jsonb not null default '[]'::jsonb;
