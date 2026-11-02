-- ============================================================================
-- Iniciar culto (flujo #10): el pastor abre un servicio, ve la asistencia en
-- vivo y puede registrar a mano a quien no tiene la app.
-- ============================================================================
-- services y attendance tenían RLS activado pero NINGUNA política, así que la
-- web no podía leerlas ni escribirlas. Se añaden con el mismo patrón que el
-- resto de tablas (misma iglesia).

-- (drop + create: se puede ejecutar más de una vez sin error)
drop policy if exists "services_same_church" on services;
create policy "services_same_church" on services for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

drop policy if exists "attendance_same_church" on attendance;
create policy "attendance_same_church" on attendance for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

-- Un registro por miembro por culto (04_ChBook_Esquema_BD).
create unique index if not exists attendance_one_per_service
  on attendance (service_id, member_id);

-- Solo un culto en curso por iglesia.
create unique index if not exists services_one_active
  on services (church_id) where status = 'active';

-- Hora de cierre del culto.
alter table services add column if not exists ended_at timestamptz;

-- Lista en vivo: publicar attendance en Supabase Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
  and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table attendance;
  end if;
end $$;
