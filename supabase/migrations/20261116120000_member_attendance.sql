-- ============================================================================
-- Nivel 0 del modelo de comparación · Clasificar el activo POR ASISTENCIA
-- ============================================================================
-- Convierte la asistencia en "estado por asistencia" del miembro: su última
-- asistencia y cuántas veces ha asistido. Es una dimensión DERIVADA (no toca
-- members.status, que es el estado de membresía que decide el pastor). El umbral
-- de inactividad (60 días sin asistir) se aplica en la app para dejarlo
-- configurable. security_invoker → respeta RLS por iglesia.

create or replace view member_attendance as
select
  m.id             as member_id,
  m.church_id,
  max(a.checked_at) as last_attended,   -- null = nunca registrado
  count(a.id)       as attended_count
from members m
left join attendance a on a.member_id = m.id
group by m.id, m.church_id;

alter view member_attendance set (security_invoker = on);
