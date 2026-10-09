-- ============================================================================
-- Pilar B — Calendario (línea de tiempo): CICLOS + eventos
-- ============================================================================
-- Ciclos: rangos de fechas (trimestrales, etc.) para evaluar metas, anidables
-- (ciclos dentro de ciclos). Se dibujan como bandas de color en la línea de
-- tiempo del calendario, con zoom (horas/días/semanas/meses).
create table cycles (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  parent_id uuid references cycles(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  starts_on date not null,
  ends_on date not null,
  goal text,
  sort_order int default 0,
  created_at timestamptz default now()
);
create index cycles_church_idx on cycles (church_id);

alter table cycles enable row level security;
create policy "cycles_same_church" on cycles for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

-- events: ya existía con RLS pero SIN política (deny-all). Le damos política por
-- iglesia y campos para el calendario: color, anidamiento (actividades dentro de
-- un evento multi-día como un congreso) y "todo el día".
create policy "events_same_church" on events for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

alter table events add column color text;
alter table events add column parent_id uuid references events(id) on delete cascade;
alter table events add column all_day boolean default false;
