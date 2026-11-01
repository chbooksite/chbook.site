-- Pilar B — Actividades: las actividades de niveles paralelos (2 y 3) pueden
-- empezar antes/después del inicio del servicio. start_offset = minutos desde
-- el inicio del servicio (puede ser negativo). El nivel 1 lo ignora (secuencial).
alter table schedule_segments add column start_offset int not null default 0;
