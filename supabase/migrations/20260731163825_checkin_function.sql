-- Verifica si un miembro está dentro del radio del templo
create or replace function check_attendance_radius(
  p_church_id uuid,
  p_lat double precision,
  p_lng double precision
) returns boolean
language plpgsql
as $$
declare
  church_loc geography;
  radius int;
begin
  select location, coalesce(
    (select gps_radius_m from services
     where church_id = p_church_id and status = 'active'
     order by starts_at desc limit 1), 100)
  into church_loc, radius
  from churches where id = p_church_id;

  return st_dwithin(
    church_loc,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    radius
  );
end;
$$;