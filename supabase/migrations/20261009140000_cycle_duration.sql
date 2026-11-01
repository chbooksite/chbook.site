-- Ciclos: duración por preset y repeticiones. Solo se ingresa la fecha de inicio;
-- el fin y las repeticiones se calculan solos.
--   duration: weekly | biweekly | monthly | quarterly | semiannual | annual | custom
--   repeat  : nº de repeticiones (0 = continuo/indefinido)
alter table cycles add column duration text not null default 'custom';
alter table cycles add column repeat int not null default 1;
