-- ============================================================================
-- Ajustes por iglesia (incluye reglas de elegibilidad) — Capa B
-- ============================================================================
-- Guardamos las preferencias de cada iglesia en un JSONB flexible (ej.
-- settings.rules con los interruptores de reglas). Y habilitamos que el
-- perfil administrativo pueda actualizar su iglesia (antes solo se podía leer).

alter table churches add column settings jsonb not null default '{}'::jsonb;

create policy "churches_update_own"
  on churches for update
  using (id = current_church_id())
  with check (id = current_church_id());
