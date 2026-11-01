-- ============================================================================
-- Onboarding del pastor: crear iglesia + pastor de forma atómica (Fase 2, Paso 3)
-- ============================================================================
-- Resuelve el problema "huevo y gallina" de RLS: el pastor aún no pertenece a
-- ninguna iglesia cuando crea la primera, así que necesita una función
-- SECURITY DEFINER que se salte RLS para el alta inicial. Añade además las
-- políticas de lectura que faltaban (churches no tenía ninguna).

-- 1) current_church_id() → SECURITY DEFINER para evitar recursión con RLS.
--    (Se usa dentro de las propias políticas de members; como INVOKER volvería
--     a disparar RLS sobre members → recursión.)
create or replace function current_church_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select church_id from members where user_id = auth.uid() limit 1;
$$;

-- 2) Un miembro puede leer SIEMPRE su(s) propia(s) fila(s) (detectar onboarding).
create policy "members_select_own"
  on members for select
  using (user_id = auth.uid());

-- 3) Leer la iglesia a la que perteneces.
create policy "churches_select_own"
  on churches for select
  using (id = current_church_id());

-- 4) Alta atómica: crea la iglesia y asocia al usuario autenticado como pastor
--    (member role=admin, status=active). Genera slug y código CHBK-XXXX únicos.
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
  v_uid    uuid := auth.uid();
  v_slug   text;
  v_base   text;
  v_code   text;
  v_plan   text;
  v_loc    geography;
  v_church churches;
  v_try    int := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  -- Una persona solo puede pertenecer a una iglesia a la vez.
  if exists (select 1 from members where user_id = v_uid) then
    raise exception 'Ya perteneces a una iglesia';
  end if;

  -- Slug base a partir del nombre; se asegura unicidad con sufijo si colisiona.
  v_base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'iglesia'; end if;
  v_slug := v_base;
  while exists (select 1 from churches where slug = v_slug) loop
    v_try := v_try + 1;
    v_slug := v_base || '-' || v_try::text;
  end loop;

  -- Código CHBK-XXXX único (4 hex en mayúsculas).
  loop
    v_code := 'CHBK-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from churches where code = v_code);
  end loop;

  -- Plan sugerido por número estimado de miembros (si no se pasó explícito).
  v_plan := coalesce(p_plan,
    case
      when coalesce(p_capacity, 0) <= 100 then 'semilla'
      when p_capacity <= 500           then 'crecimiento'
      else 'iglesia_mayor'
    end);

  -- Ubicación del auditorio (opcional).
  if p_lat is not null and p_lng is not null then
    v_loc := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;

  insert into churches (name, slug, code, location, address, capacity, pastor_name, plan, country)
  values (p_name, v_slug, v_code, v_loc, p_address, p_capacity, p_pastor_name, v_plan, p_country)
  returning * into v_church;

  insert into members (church_id, user_id, full_name, role, status, email)
  values (v_church.id, v_uid, p_pastor_name, 'admin', 'active',
          (select email from auth.users where id = v_uid));

  return v_church;
end;
$$;

grant execute on function create_church_with_pastor(
  text, text, text, text, int, double precision, double precision, text
) to authenticated;
