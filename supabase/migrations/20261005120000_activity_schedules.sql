-- ============================================================================
-- Pilar B — Actividades · Paso 1: EL RITMO DE LA IGLESIA
-- ============================================================================
-- La iglesia piensa en RITMO, no en fechas: define actividades recurrentes una
-- vez (tipo, recurrencia, hora, audiencia, equipo) y el sistema proyecta la
-- semana. Todo aditivo. Las asignaciones por ocurrencia, la línea de tiempo en
-- vivo y las notificaciones se construyen encima en pasos posteriores.

-- 1) CATÁLOGO DE TIPOS DE ACTIVIDAD por iglesia (plantilla base editable, como
--    roles/equipos). Cada tipo tiene color característico.
create table activity_types (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  key text not null,
  name text not null,
  color text not null default '#6366f1',
  is_system boolean default false,
  created_at timestamptz default now(),
  unique (church_id, key)
);

-- 2) RITMO: definiciones de actividades recurrentes.
--    - freq 'weekly'  → se repite cada semana en `weekday`.
--    - freq 'monthly' → se repite el `nth` `weekday` del mes (nth: 1..4, o -1=último).
--    - "varias veces el mismo día" (p.ej. 2 servicios el domingo) = varias filas.
--    - bloque sin fin fijo (p.ej. ayuno toda la mañana): end_time null.
--    - parent_id: sub-actividad (escuela previa, clase por edad) de otra.
create table activity_schedules (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  parent_id uuid references activity_schedules(id) on delete cascade,
  type_id uuid references activity_types(id) on delete set null,
  name text not null,
  freq text not null default 'weekly',              -- weekly | monthly
  weekday smallint not null,                         -- 0=domingo .. 6=sábado
  nth smallint,                                      -- solo monthly: 1..4 o -1 (último); null=weekly
  start_time time,                                   -- null si es bloque sin hora exacta
  end_time time,                                     -- null = bloque abierto (ej. ayuno)
  audience jsonb not null default '{"scope":"all"}'::jsonb,
    -- {scope:'all'} | {scope:'roles',ids:[]} | {scope:'teams',ids:[]} | {scope:'ages',keys:[]}
  location text,
  responsible_team_id uuid references teams(id) on delete set null,
  sort_order int default 0,
  enabled boolean default true,
  created_at timestamptz default now()
);

create index activity_schedules_church_idx on activity_schedules (church_id);
create index activity_schedules_parent_idx on activity_schedules (parent_id);

-- 3) RLS (patrón por iglesia)
alter table activity_types     enable row level security;
alter table activity_schedules enable row level security;

create policy "activity_types_same_church" on activity_types for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

create policy "activity_schedules_same_church" on activity_schedules for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

-- 4) SEED: tipos de actividad predefinidos (se añade a seed_church_catalogs).
--    Se mantiene el seed previo de roles/equipos intacto.
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
end;
$$;

-- 5) Backfill: sembrar tipos de actividad para iglesias ya existentes.
do $$
declare c record;
begin
  for c in select id from churches loop
    perform seed_church_catalogs(c.id);
  end loop;
end $$;
