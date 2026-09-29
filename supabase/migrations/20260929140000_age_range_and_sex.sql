-- ============================================================================
-- Reencuadre: "rango de edad" es una CLASIFICACIÓN del miembro, no un equipo.
-- Los equipos vuelven a ser solo ministerios de servicio. Se agrega el sexo.
-- ============================================================================

-- 1) Quitar los equipos por edad que NO son ministerios (se conserva Adolescentes;
--    Niños abarca maternal+niños; Jóvenes se mantiene).
delete from teams where key in ('maternal', 'adultos', 'adultos_mayores');

-- 2) Los equipos ya no llevan rango de edad.
alter table teams drop column if exists participant_min_age;
alter table teams drop column if exists participant_max_age;

-- 3) Sexo como clasificación del miembro ('masculino' | 'femenino' | null).
alter table members add column sex text;

-- 4) Sembrado corregido: solo equipos de servicio (sin rangos).
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
    (p_church_id, 'ninos',        'Niños',        true),
    (p_church_id, 'adolescentes', 'Adolescentes', true),
    (p_church_id, 'jovenes',      'Jóvenes',      true),
    (p_church_id, 'multimedia',   'Multimedia',   true),
    (p_church_id, 'danza',        'Danza',        true),
    (p_church_id, 'musica',       'Música',       true),
    (p_church_id, 'diaconos',     'Diáconos',     true),
    (p_church_id, 'finanzas',     'Finanzas',     true)
  on conflict (church_id, key) do nothing;
end;
$$;
