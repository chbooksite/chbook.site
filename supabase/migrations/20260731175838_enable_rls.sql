alter table churches            enable row level security;
alter table members             enable row level security;
alter table services            enable row level security;
alter table attendance          enable row level security;
alter table events              enable row level security;
alter table notifications       enable row level security;
alter table activity_tags       enable row level security;
alter table service_activities  enable row level security;

-- Helper: iglesia del usuario autenticado
create or replace function current_church_id()
returns uuid language sql stable as $$
  select church_id from members where user_id = auth.uid() limit 1;
$$;

-- Ejemplo de política (repetir el patrón por tabla con church_id)
create policy "members_same_church"
  on members for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());