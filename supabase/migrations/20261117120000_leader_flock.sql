-- ============================================================================
-- OVEJAS / REBAÑO por líder: a un rol (líder/pastor) se le asignan personas a su
-- cargo con total libertad — un SEGMENTO combinable (edad, sexo, bautismo, equipo,
-- rol… o toda la iglesia) expresado como `Audience`, más una lista MANUAL de
-- personas concretas. Las ovejas de un líder = (miembros que cumplen la audiencia)
-- ∪ (manual). Reutiliza el mismo modelo `Audience` del "a quién va dirigido" de
-- las actividades. La resolución a personas se hace en la app.
-- ============================================================================

create table leader_flock (
  member_id         uuid primary key references members(id) on delete cascade, -- el líder/pastor
  church_id         uuid not null references churches(id) on delete cascade,
  audience          jsonb not null default '{"all":false,"roleIds":[],"teamIds":[],"ageKeys":[],"filters":[]}'::jsonb,
  manual_member_ids uuid[] not null default '{}',
  updated_at        timestamptz not null default now()
);

create index leader_flock_church_idx on leader_flock (church_id);

alter table leader_flock enable row level security;

create policy "leader_flock_same_church" on leader_flock for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());
