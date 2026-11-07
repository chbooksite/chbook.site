-- ============================================================================
-- Identidad de cada iglesia: su logo, la foto del templo (REQ-04) y su color
-- (REQ-09, guardado en churches.settings.palette). Así el panel se siente de
-- ellos y no de ChBook.
-- Se puede ejecutar más de una vez sin error.
-- ============================================================================

alter table churches add column if not exists logo_url text;
alter table churches add column if not exists cover_url text;

-- Archivos públicos de la iglesia (logo y foto). Lectura pública: se muestran
-- en el panel y, más adelante, en el perfil público. Máx. 2 MB, solo imágenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('church-assets', 'church-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ¿Quien llama administra su iglesia? (el pastor que la registró es 'admin').
create or replace function is_church_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from members where user_id = auth.uid() and role = 'admin')
$$;

-- Solo el administrador escribe, y solo en la carpeta de su iglesia
-- (church-assets/<church_id>/...).
drop policy if exists "church_assets_select" on storage.objects;
create policy "church_assets_select" on storage.objects for select to authenticated
  using (bucket_id = 'church-assets' and (storage.foldername(name))[1] = current_church_id()::text);

drop policy if exists "church_assets_insert" on storage.objects;
create policy "church_assets_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'church-assets' and (storage.foldername(name))[1] = current_church_id()::text and is_church_admin());

drop policy if exists "church_assets_update" on storage.objects;
create policy "church_assets_update" on storage.objects for update to authenticated
  using (bucket_id = 'church-assets' and (storage.foldername(name))[1] = current_church_id()::text and is_church_admin())
  with check (bucket_id = 'church-assets' and (storage.foldername(name))[1] = current_church_id()::text and is_church_admin());

drop policy if exists "church_assets_delete" on storage.objects;
create policy "church_assets_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'church-assets' and (storage.foldername(name))[1] = current_church_id()::text and is_church_admin());
