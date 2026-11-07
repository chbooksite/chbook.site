-- ============================================================================
-- Documento de Requerimientos V1 (Fase 1, panel web).
--   REQ-04 / REQ-08: denominación, ciudad y año de fundación de la iglesia.
--   REQ-12 / REQ-13: un miembro activo pasa a Inactivo si no asiste en N días
--                    (churches.settings.inactivity_days, por defecto 60; 0 = no).
--   REQ-26:          cada actividad del calendario es pública o interna.
-- Se puede ejecutar más de una vez sin error.
-- ============================================================================

alter table churches add column if not exists denomination text;
alter table churches add column if not exists city text;
alter table churches add column if not exists founded_year int;

alter table activity_schedules add column if not exists is_public boolean not null default false;

-- Inactividad de UNA iglesia. Reglas:
--   * solo miembros 'active' que llevan en la iglesia más de N días;
--   * solo si la iglesia registró al menos un culto en esos N días (si no usa
--     la asistencia, nadie se vuelve inactivo por eso);
--   * faltar a un culto no basta: cuenta la ventana completa de N días.
-- Devuelve cuántos miembros cambiaron.
create or replace function apply_inactivity_for(p_church uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_count int;
begin
  select coalesce((settings ->> 'inactivity_days')::int, 60) into v_days from churches where id = p_church;
  if v_days is null or v_days <= 0 then
    return 0;
  end if;
  if not exists (
    select 1 from services s
    where s.church_id = p_church and s.starts_at >= now() - make_interval(days => v_days)
  ) then
    return 0;
  end if;
  update members m
     set status = 'inactive'
   where m.church_id = p_church
     and m.status = 'active'
     and m.created_at < now() - make_interval(days => v_days)
     and not exists (
       select 1 from attendance a
       where a.member_id = m.id and a.checked_at >= now() - make_interval(days => v_days)
     );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function apply_inactivity_for(uuid) from public, anon, authenticated;

-- La que llama el panel al abrir Inicio: solo sobre la iglesia de quien llama.
create or replace function apply_inactivity()
returns int
language sql
security definer
set search_path = public
as $$
  select apply_inactivity_for(current_church_id()) where current_church_id() is not null
$$;

grant execute on function apply_inactivity() to authenticated;

-- Quien vuelve a asistir deja de estar inactivo.
create or replace function reactivate_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update members set status = 'active' where id = new.member_id and status = 'inactive';
  return new;
end $$;

drop trigger if exists attendance_reactivates on attendance;
create trigger attendance_reactivates
  after insert on attendance
  for each row execute function reactivate_on_attendance();

-- Si el proyecto tiene pg_cron, se revisan todas las iglesias cada día (3 a.m. UTC).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'chbook_inactivity';
    perform cron.schedule('chbook_inactivity', '0 3 * * *',
      'select apply_inactivity_for(id) from churches');
  end if;
end $$;
