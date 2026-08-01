-- CHURCHES
create table churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  code text unique not null,                       -- CHBK-XXXX
  location geography(point, 4326),
  address text,
  capacity int,
  pastor_name text,
  plan text default 'semilla',
  stripe_customer_id text,
  stripe_subscription_id text,
  theme_color text default '#2D5A50',
  country text,
  created_at timestamptz default now()
);

-- MEMBERS
create table members (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references churches(id) on delete cascade,
  user_id uuid references auth.users(id),
  full_name text not null,
  phone text,
  email text,
  birth_date date,
  role text default 'member',                      -- member/leader/deacon/musician/admin
  status text default 'prospect',                  -- prospect/active/inactive/archived
  push_token text,
  created_at timestamptz default now()
);

-- SERVICES
create table services (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references churches(id) on delete cascade,
  name text not null,
  starts_at timestamptz,
  status text default 'scheduled',                 -- scheduled/active/ended
  online_code text,
  gps_radius_m int default 100,
  created_at timestamptz default now()
);

-- ATTENDANCE
create table attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  church_id uuid references churches(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  type text default 'presential',                  -- presential/online
  location geography(point, 4326),
  checked_at timestamptz default now()
);

-- EVENTS
create table events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references churches(id) on delete cascade,
  title text not null,
  description text,
  event_type text default 'service',               -- service/special/rehearsal/cell/other
  starts_at timestamptz,
  ends_at timestamptz,
  is_public boolean default false,
  created_at timestamptz default now()
);

-- NOTIFICATIONS
create table notifications (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references churches(id) on delete cascade,
  target_member_id uuid references members(id),    -- null = todos
  type text default 'custom',                      -- welcome/service_start/reminder/alert/custom
  title text,
  body text,
  sent_at timestamptz,
  status text default 'pending'
);


-- ⭐ NUEVO: plantillas reutilizables de etiquetas por iglesia
create table activity_tags (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references churches(id) on delete cascade,
  name text not null,                              -- Alabanza / Ofrendas / Prédica
  default_duration_min int,
  color text,
  created_at timestamptz default now()
);

-- ⭐ NUEVO: actividades del servicio en tiempo real
create table service_activities (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references services(id) on delete cascade,
  tag_id uuid references activity_tags(id),
  name text not null,                              -- etiqueta (copiada o custom)
  sort_order int not null,                         -- orden en la línea de tiempo
  planned_duration_min int,                        -- duración prevista
  assignee_member_id uuid references members(id),  -- encargado
  notify boolean default false,                    -- dispara notificación al iniciar
  started_at timestamptz,                          -- hora real de inicio
  status text default 'pending',                   -- pending/active/done
  created_at timestamptz default now()
);

create or replace view member_details as
select
  m.*,
  case
    when date_part('year', age(m.birth_date)) < 13 then 'child'
    when date_part('year', age(m.birth_date)) < 18 then 'teen'
    when date_part('year', age(m.birth_date)) < 60 then 'adult'
    else 'senior'
  end as age_group
from members m;

-- vista de metricas del dashboard 

create or replace view church_metrics as
select
  c.id as church_id,
  count(m.*) filter (where m.status != 'archived')            as total_members,
  count(m.*) filter (where m.status = 'active')               as active_members,
  round(100.0 * count(m.*) filter (where m.status = 'active')
        / nullif(count(m.*) filter (where m.status != 'archived'), 0), 1) as active_pct
from churches c
left join members m on m.church_id = c.id
group by c.id;