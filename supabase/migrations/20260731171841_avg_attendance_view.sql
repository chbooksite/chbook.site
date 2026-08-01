-- Promedio de asistencia de los últimos 4 cultos por iglesia
create or replace view church_avg_attendance as
with ranked as (
  select
    s.church_id,
    s.id as service_id,
    row_number() over (
      partition by s.church_id
      order by s.starts_at desc
    ) as rn
  from services s
  where s.status = 'ended'
),
last4 as (
  select church_id, service_id
  from ranked
  where rn <= 4
),
counts as (
  select
    l.church_id,
    l.service_id,
    count(a.id) as attendees
  from last4 l
  left join attendance a on a.service_id = l.service_id
  group by l.church_id, l.service_id
)
select
  church_id,
  round(avg(attendees), 1) as avg_attendance
from counts
group by church_id;

-- Vista combinada del dashboard (une metrics + promedio)
create or replace view church_dashboard as
select
  m.*,
  coalesce(a.avg_attendance, 0) as avg_attendance
from church_metrics m
left join church_avg_attendance a on a.church_id = m.church_id;