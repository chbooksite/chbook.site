-- ============================================================================
-- "Miembro" deja de ser un rol → pasa a ser una etiqueta automática
-- ============================================================================
-- Todo aprobado es "Miembro" por defecto (y "Miembro activo" si está bautizado
-- y participa en un equipo). Eso se calcula en la app; no es un rol asignable.
-- Actualizamos las funciones para no sembrar/asignar 'miembro' y borramos los
-- roles 'miembro' existentes (el borrado limpia member_roles por cascade).

-- Sembrado de catálogos SIN 'miembro'.
create or replace function seed_church_catalogs(p_church_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into roles (church_id, key, name, is_system) values
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

-- Onboarding: el pastor recibe pastor_principal + administrador (ya no 'miembro').
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

  perform seed_church_catalogs(v_church.id);
  insert into member_roles (member_id, role_id)
    select v_member_id, r.id
    from roles r
    where r.church_id = v_church.id
      and r.key in ('pastor_principal', 'administrador');

  return v_church;
end;
$$;

grant execute on function create_church_with_pastor(
  text, text, text, text, int, double precision, double precision, text
) to authenticated;

-- Borrar el rol 'miembro' existente (cascade limpia member_roles).
delete from roles where key = 'miembro';
