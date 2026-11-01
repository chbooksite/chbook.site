-- ============================================================================
-- Modelo de miembros: roles (multi), equipos (2 niveles), dependientes (Paso 4.1)
-- ============================================================================
-- Implementa las decisiones de la visión: un miembro tiene N roles (etiquetas
-- transversales) y pertenece a N equipos (con líder interno); los dependientes
-- son members sin cuenta con guardian_id. Todo aditivo.

-- 1) CATÁLOGO DE ROLES por iglesia (predefinidos del sistema + personalizados)
create table roles (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean default false,
  created_at timestamptz default now(),
  unique (church_id, key)
);

-- 2) ROLES POR MIEMBRO (M:N)
create table member_roles (
  member_id uuid not null references members(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (member_id, role_id)
);

-- 3) CATÁLOGO DE EQUIPOS por iglesia ("departamento" NO se usa en la UI)
create table teams (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean default false,
  created_at timestamptz default now(),
  unique (church_id, key)
);

-- 4) EQUIPOS POR MIEMBRO (M:N, con líder interno)
create table member_teams (
  member_id uuid not null references members(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  is_leader boolean default false,
  primary key (member_id, team_id)
);

-- 5) DEPENDIENTES: un miembro (niño/adulto mayor sin cuenta) a cargo de un tutor
alter table members add column guardian_id uuid references members(id) on delete set null;

-- 6) RLS (patrón por iglesia; el endurecimiento a solo-admin se hará con los
--    niveles de seguridad del Nivel 2)
alter table roles        enable row level security;
alter table member_roles enable row level security;
alter table teams        enable row level security;
alter table member_teams enable row level security;

create policy "roles_same_church" on roles for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

create policy "teams_same_church" on teams for all
  using (church_id = current_church_id())
  with check (church_id = current_church_id());

create policy "member_roles_same_church" on member_roles for all
  using (exists (select 1 from members m where m.id = member_id and m.church_id = current_church_id()))
  with check (exists (select 1 from members m where m.id = member_id and m.church_id = current_church_id()));

create policy "member_teams_same_church" on member_teams for all
  using (exists (select 1 from members m where m.id = member_id and m.church_id = current_church_id()))
  with check (exists (select 1 from members m where m.id = member_id and m.church_id = current_church_id()));

-- 7) SEED: siembra roles y equipos predefinidos para una iglesia
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
end;
$$;

-- 8) Re-crear create_church_with_pastor: además de crear iglesia + pastor,
--    siembra los catálogos y asigna al pastor sus roles base.
create or replace function create_church_with_pastor(
  p_name        text,
  p_pastor_name text,
  p_country     text default null,
  p_address     text default null,
  p_capacity    int  default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_plan        text default null
) returns churches
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid := auth.uid();
  v_slug      text;
  v_base      text;
  v_code      text;
  v_plan      text;
  v_loc       geography;
  v_church    churches;
  v_member_id uuid;
  v_try       int := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if exists (select 1 from members where user_id = v_uid) then
    raise exception 'Ya perteneces a una iglesia';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'iglesia'; end if;
  v_slug := v_base;
  while exists (select 1 from churches where slug = v_slug) loop
    v_try := v_try + 1;
    v_slug := v_base || '-' || v_try::text;
  end loop;

  loop
    v_code := 'CHBK-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from churches where code = v_code);
  end loop;

  v_plan := coalesce(p_plan,
    case
      when coalesce(p_capacity, 0) <= 100 then 'semilla'
      when p_capacity <= 500           then 'crecimiento'
      else 'iglesia_mayor'
    end);

  if p_lat is not null and p_lng is not null then
    v_loc := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  insert into churches (name, slug, code, location, address, capacity, pastor_name, plan, country)
  values (p_name, v_slug, v_code, v_loc, p_address, p_capacity, p_pastor_name, v_plan, p_country)
  returning * into v_church;

  insert into members (church_id, user_id, full_name, role, status, email)
  values (v_church.id, v_uid, p_pastor_name, 'admin', 'active',
          (select email from auth.users where id = v_uid))
  returning id into v_member_id;

  -- Sembrar catálogos y asignar al pastor sus roles base.
  perform seed_church_catalogs(v_church.id);
  insert into member_roles (member_id, role_id)
    select v_member_id, r.id
    from roles r
    where r.church_id = v_church.id
      and r.key in ('miembro', 'pastor_principal', 'administrador');

  return v_church;
end;
$$;

grant execute on function create_church_with_pastor(
  text, text, text, text, int, double precision, double precision, text
) to authenticated;

-- 9) Sembrar catálogos para iglesias ya existentes y dar al pastor sus roles base.
do $$
declare
  c record;
  m record;
begin
  for c in select id from churches loop
    perform seed_church_catalogs(c.id);
  end loop;

  for m in select id, church_id from members where role = 'admin' loop
    insert into member_roles (member_id, role_id)
      select m.id, r.id
      from roles r
      where r.church_id = m.church_id
        and r.key in ('miembro', 'pastor_principal', 'administrador')
    on conflict do nothing;
  end loop;
end $$;
