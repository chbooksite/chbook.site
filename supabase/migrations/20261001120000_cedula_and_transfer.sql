-- ============================================================================
-- Anti-duplicados: cédula + estado "cambio de membresía"
-- ============================================================================
-- Cédula (identificación) por miembro. No se puede repetir dentro de una misma
-- iglesia (índice único parcial: permite varios null). La unicidad GLOBAL y el
-- traslado entre iglesias se harán con el registro móvil + notificaciones.
-- Se agrega el estado 'cambio_membresia': no cuenta en métricas, conserva datos.

alter table members add column cedula text;

create unique index members_church_cedula_uniq
  on members (church_id, cedula)
  where cedula is not null;

-- Métricas: excluir 'cambio_membresia' (además de 'archived') de los totales.
create or replace view church_metrics as
select
  c.id as church_id,
  count(m.*) filter (where m.status not in ('archived', 'cambio_membresia'))  as total_members,
  count(m.*) filter (where m.status = 'active')                               as active_members,
  round(
    100.0 * count(m.*) filter (where m.status = 'active')
    / nullif(count(m.*) filter (where m.status not in ('archived', 'cambio_membresia')), 0),
    1
  ) as active_pct
from churches c
left join members m on m.church_id = c.id
group by c.id;

-- La vista debe respetar RLS (se recrea, así que re-aplicamos security_invoker).
alter view church_metrics set (security_invoker = on);
