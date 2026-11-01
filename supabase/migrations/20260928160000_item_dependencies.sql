-- ============================================================================
-- Dependencias por rol/equipo (Capa B — dependencias configurables)
-- ============================================================================
-- Cada rol o equipo puede requerir otros roles/equipos. Semántica O ("any"):
-- para asignar el ítem, el miembro debe tener AL MENOS UNO de los marcados.
-- Forma: { "roles": [uuid...], "teams": [uuid...] }. {} = sin dependencias.

alter table roles add column requires jsonb not null default '{}'::jsonb;
alter table teams add column requires jsonb not null default '{}'::jsonb;
