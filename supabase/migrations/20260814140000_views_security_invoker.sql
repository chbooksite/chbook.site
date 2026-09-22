-- ============================================================================
-- Seguridad: vistas de métricas deben respetar RLS (Paso 5)
-- ============================================================================
-- Las vistas se creaban con los privilegios de su dueño y se SALTABAN el RLS de
-- las tablas base, así que un usuario anónimo podía leer las métricas de todas
-- las iglesias. Con security_invoker = on, la vista se ejecuta con los permisos
-- del usuario que consulta → cada quien ve solo los datos de SU iglesia (y anon,
-- nada).

alter view church_metrics        set (security_invoker = on);
alter view church_avg_attendance set (security_invoker = on);
alter view church_dashboard      set (security_invoker = on);
alter view member_details        set (security_invoker = on);
