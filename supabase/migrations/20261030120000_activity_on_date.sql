-- Actividad de una sola fecha (recurrencia apagada): on_date.
-- Si on_date es NULL → la actividad es recurrente (weekday/freq).
-- Si on_date tiene fecha → ocurre solo ese día (one-off). Permite crear por
-- arrastre (sin formulario) y el interruptor de recurrencia por tarjeta.
alter table public.activity_schedules
  add column if not exists on_date date;
