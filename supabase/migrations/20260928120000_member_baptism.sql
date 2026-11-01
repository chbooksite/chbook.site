-- ============================================================================
-- Bautismo del miembro (Capa A de elegibilidad)
-- ============================================================================
-- En muchas iglesias el bautismo es la base para pertenecer a un equipo o
-- servicio activo. Guardamos si está bautizado y la fecha (opcional). Aditivo.

alter table members add column is_baptized boolean not null default false;
alter table members add column baptism_date date;
