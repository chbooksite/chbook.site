-- ============================================================================
-- Garantizar un dato de edad: clasificación cuando no hay fecha de nacimiento
-- ============================================================================
-- Al iniciar un miembro se exige al menos uno de: fecha de nacimiento, edad, o
-- categoría (niño/joven/adulto). Si no hay fecha, se guarda la clasificación
-- resultante en age_group (texto; ej. "Jóvenes" derivado de la edad, o "Adulto"
-- de la categoría). Si hay fecha, el rango se calcula de ella y age_group queda null.

alter table members add column age_group text;
