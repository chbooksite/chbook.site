-- ============================================================================
-- Áreas por edad (fundación) — participantes automáticos por rango de edad
-- ============================================================================
-- Cada equipo puede tener un rango de edad de participantes. Si lo tiene, es un
-- "área por edad" que cataloga a los miembros de ese rango como participantes
-- (no etiquetados). Rangos editables; los de aquí son los valores por defecto.

alter table teams add column participant_min_age int;
alter table teams add column participant_max_age int;

-- Sembrado: 6 áreas por edad (con rango) + equipos de servicio (sin rango).
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

  insert into teams (church_id, key, name, is_system, participant_min_age, participant_max_age) values
    (p_church_id, 'maternal',        'Maternal',        true, 0,  5),
    (p_church_id, 'ninos',           'Niños',           true, 6,  12),
    (p_church_id, 'adolescentes',    'Adolescentes',    true, 13, 17),
    (p_church_id, 'jovenes',         'Jóvenes',         true, 18, 28),
    (p_church_id, 'adultos',         'Adultos',         true, 29, 59),
    (p_church_id, 'adultos_mayores', 'Adultos mayores', true, 60, null),
    (p_church_id, 'multimedia',      'Multimedia',      true, null, null),
    (p_church_id, 'danza',           'Danza',           true, null, null),
    (p_church_id, 'musica',          'Música',          true, null, null),
    (p_church_id, 'diaconos',        'Diáconos',        true, null, null),
    (p_church_id, 'finanzas',        'Finanzas',        true, null, null)
  on conflict (church_id, key) do nothing;
end;
$$;

-- Iglesias existentes: insertar las nuevas áreas y fijar rangos a las que ya había.
do $$
declare c record;
begin
  for c in select id from churches loop
    perform seed_church_catalogs(c.id);
    update teams set participant_min_age = 6,  participant_max_age = 12 where church_id = c.id and key = 'ninos';
    update teams set participant_min_age = 18, participant_max_age = 28 where church_id = c.id and key = 'jovenes';
  end loop;
end $$;
