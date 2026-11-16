-- ============================================================================
-- Cimiento de dashboards de asistencia · Paso 1 — encuentro ↔ actividad + canales
-- ============================================================================
-- Un ENCUENTRO (services) es la OCURRENCIA REALIZADA de una ACTIVIDAD definida
-- (activity_schedules). Hasta ahora services no apuntaba a su actividad, así que
-- no se podía comparar "la misma actividad" a lo largo de las semanas ni heredar
-- su tipo/color. Esta migración:
--   1) vincula cada encuentro con su actividad,
--   2) añade las políticas RLS que FALTABAN en services/attendance (tenían RLS
--      activado pero sin políticas → lectura denegada a todos, por eso el promedio
--      de asistencia salía 0),
--   3) agrega una vista que resume la asistencia por encuentro y por CANAL.
-- La asistencia por canal ya vive en `attendance`: type presencial/online +
-- `location` (punto GPS verificado contra el radio del templo). Aquí solo se
-- resume; el cálculo de la asistencia "esperada" es el paso siguiente.

-- 1) Vínculo encuentro → actividad -------------------------------------------
alter table services
  add column if not exists schedule_id uuid references activity_schedules(id) on delete set null;

create index if not exists services_church_schedule_idx
  on services (church_id, schedule_id, starts_at desc);

-- 2) RLS por iglesia (faltaban: services/attendance estaban en deny total) -----
drop policy if exists "services_same_church" on services;
create policy "services_same_church" on services for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

drop policy if exists "attendance_same_church" on attendance;
create policy "attendance_same_church" on attendance for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

-- 3) Resumen de asistencia por ENCUENTRO y canal ------------------------------
-- Un renglón por encuentro, con la actividad a la que pertenece y los conteos:
--   total      = todas las asistencias del encuentro
--   online     = type 'online'
--   presencial = no-online (presencial, con o sin punto GPS)
--   gps        = presencial con punto registrado (location no nulo)
create or replace view service_attendance as
select
  s.id                                                         as service_id,
  s.church_id,
  s.schedule_id,
  sch.name                                                     as activity_name,
  sch.type_id,
  s.name                                                       as service_name,
  s.starts_at,
  s.status,
  count(a.id)                                                  as total,
  count(a.id) filter (where a.type = 'online')                 as online,
  count(a.id) filter (where a.type is distinct from 'online')  as presencial,
  count(a.id) filter (where a.type is distinct from 'online'
                        and a.location is not null)            as gps
from services s
left join activity_schedules sch on sch.id = s.schedule_id
left join attendance a on a.service_id = s.id
group by s.id, s.church_id, s.schedule_id, sch.name, sch.type_id, s.name, s.starts_at, s.status;

alter view service_attendance set (security_invoker = on);
