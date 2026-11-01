-- Pilar B — Actividades: fijar segmentos de la línea de tiempo.
-- `pinned` = la actividad no se mueve al arrastrar/reordenar.
alter table schedule_segments add column pinned boolean default false;
