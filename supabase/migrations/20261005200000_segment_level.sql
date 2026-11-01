-- Pilar B — Actividades: actividades en simultáneo (hasta 3 niveles).
-- level 1 = línea de tiempo principal; 2 y 3 = barras paralelas bajo la principal.
alter table schedule_segments add column level smallint not null default 1;
