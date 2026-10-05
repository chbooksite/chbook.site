-- ============================================================================
-- Pilar B — Actividades · Paso 1b: EQUIPOS PARTICIPANTES + LÍNEA DE TIEMPO
-- ============================================================================
-- Modelo de dos capas sobre cada actividad recurrente (activity_schedules):
--  Capa 1 — equipos participantes de TODO el servicio (Diáconos, Multimedia,
--           Música): se eligen miembros manualmente o se delega al líder.
--  Capa 2 — línea de tiempo: segmentos que NO se solapan, en orden y con
--           duración (oración inicial, alabanza, anuncios, ofrenda, prédica…),
--           cada uno a cargo de un equipo participante o de un rol. Esta misma
--           línea de tiempo correrá en vivo en "Servicio en tiempo real".
-- Las sub-actividades (ej. culto de niños) son activity_schedules con parent_id
-- y tienen su propia capa 1 y 2 (estructura recursiva). Todo aditivo.

-- 1) activity_tags = CATÁLOGO EDITABLE de actividades internas por iglesia.
--    Tenía RLS sin política (deny-all); le damos política por iglesia + unique.
alter table activity_tags
  add constraint activity_tags_church_name_uniq unique (church_id, name);

create policy "activity_tags_same_church" on activity_tags for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

-- 2) Capa 1: equipos participantes de un servicio recurrente.
create table schedule_teams (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  schedule_id uuid not null references activity_schedules(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  delegate boolean default false,          -- true = lo llena el líder desde su app
  member_ids uuid[] default '{}',          -- miembros elegidos (si no se delega)
  created_at timestamptz default now(),
  unique (schedule_id, team_id)
);

-- 3) Capa 2: segmentos de la línea de tiempo (no se solapan, van en orden).
create table schedule_segments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  schedule_id uuid not null references activity_schedules(id) on delete cascade,
  tag_id uuid references activity_tags(id) on delete set null,  -- tipo del catálogo
  name text not null,
  sort_order int not null default 0,
  duration_min int,
  -- encargado: un equipo participante, o un rol (+ miembros específicos)
  team_id uuid references teams(id) on delete set null,
  role_id uuid references roles(id) on delete set null,
  member_ids uuid[] default '{}',
  created_at timestamptz default now()
);

create index schedule_teams_schedule_idx on schedule_teams (schedule_id);
create index schedule_segments_schedule_idx on schedule_segments (schedule_id);

-- 4) RLS por iglesia
alter table schedule_teams    enable row level security;
alter table schedule_segments enable row level security;

create policy "schedule_teams_same_church" on schedule_teams for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

create policy "schedule_segments_same_church" on schedule_segments for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

-- 5) SEED: catálogo base de actividades internas (activity_tags).
create or replace function seed_church_catalogs(p_church_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into roles (church_id, key, name, is_system) values
    (p_church_id, 'miembro',          'Miembro',          true),
    (p_church_id, 'pastor_principal', 'Pastor principal', true),
    (p_church_id, 'pastor_afiliado',  'Pastor afiliado',  true),
    (p_church_id, 'lider',            'Líder',            true),
    (p_church_id, 'administrador',    'Administrador',    true),
    (p_church_id, 'predicador',       'Predicador',       true)
  on conflict (church_id, key) do nothing;

  insert into teams (church_id, key, name, is_system) values
    (p_church_id, 'jovenes',    'Jóvenes',    true),
    (p_church_id, 'ninos',      'Niños',      true),
    (p_church_id, 'multimedia', 'Multimedia', true),
    (p_church_id, 'danza',      'Danza',      true),
    (p_church_id, 'musica',     'Música',     true),
    (p_church_id, 'diaconos',   'Diáconos',   true),
    (p_church_id, 'finanzas',   'Finanzas',   true)
  on conflict (church_id, key) do nothing;

  insert into activity_types (church_id, key, name, color, is_system) values
    (p_church_id, 'servicio_dominical', 'Servicio dominical',    '#6366f1', true),
    (p_church_id, 'culto_oracion',      'Culto de oración',      '#0ea5e9', true),
    (p_church_id, 'ayuno',              'Ayuno',                 '#8b5cf6', true),
    (p_church_id, 'sanidad',            'Sanidad interior',      '#14b8a6', true),
    (p_church_id, 'juvenil',            'Servicio de jóvenes',   '#f59e0b', true),
    (p_church_id, 'ensayo',             'Ensayo',                '#84cc16', true),
    (p_church_id, 'escuela',            'Escuela de discipulado','#ec4899', true),
    (p_church_id, 'clase_ninos',        'Clase de niños',        '#f97316', true),
    (p_church_id, 'clase_adolescentes', 'Clase de adolescentes', '#eab308', true),
    (p_church_id, 'liderazgo',          'Reunión de liderazgo',  '#78716c', true),
    (p_church_id, 'cena',               'Cena del Señor',        '#ef4444', true),
    (p_church_id, 'celula',             'Célula',                '#10b981', true),
    (p_church_id, 'otro',               'Otro',                  '#94a3b8', true)
  on conflict (church_id, key) do nothing;

  insert into activity_tags (church_id, name, default_duration_min, color) values
    (p_church_id, 'Bienvenida',      5,  '#14b8a6'),
    (p_church_id, 'Oración inicial', 10, '#0ea5e9'),
    (p_church_id, 'Alabanza',        25, '#8b5cf6'),
    (p_church_id, 'Ofrenda',         10, '#f59e0b'),
    (p_church_id, 'Anuncios',        10, '#84cc16'),
    (p_church_id, 'Prédica',         40, '#6366f1'),
    (p_church_id, 'Ministración',    15, '#ec4899'),
    (p_church_id, 'Despedida',       5,  '#78716c')
  on conflict (church_id, name) do nothing;
end;
$$;

-- 6) Backfill del catálogo de actividades internas para iglesias existentes.
do $$
declare c record;
begin
  for c in select id from churches loop
    perform seed_church_catalogs(c.id);
  end loop;
end $$;
