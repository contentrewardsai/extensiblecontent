-- Pin `search_path = ''` on the storage helper functions so they cannot be
-- hijacked by a role that creates same-named objects in their own schema.
-- All references inside the bodies are already fully schema-qualified
-- (`storage.objects`), so an empty search_path is safe.
--
-- Resolves the `function_search_path_mutable` (lint 0011) advisor warnings
-- for these functions; matches the hardening Supabase recommends for any
-- function that touches the `storage` schema from `public`.

alter function public.get_user_storage_stats(text, text[])
  set search_path = '';

alter function public.list_user_storage_files(text, text[], int, int)
  set search_path = '';

alter function public.resolve_user_storage_object(text, text[], uuid, text)
  set search_path = '';
