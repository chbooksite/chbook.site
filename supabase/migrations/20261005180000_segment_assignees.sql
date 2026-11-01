-- Pilar B — Actividades: una actividad de la línea de tiempo puede tener VARIOS
-- encargados (equipos o roles, cada uno con miembros específicos).
-- Se guardan como arreglo jsonb: [{kind:'team'|'role', id, memberIds:[]}].
-- Las columnas team_id/role_id/member_ids quedan en desuso (se mantienen).
alter table schedule_segments add column assignees jsonb not null default '[]'::jsonb;
