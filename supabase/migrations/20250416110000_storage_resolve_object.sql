-- Resolve a storage.objects row from a UUID id or a basename, scoped to a
-- user prefix. Used by DELETE /api/extension/social-post/storage/files/[fileId]
-- so the extension can pass back either the upload's bare `fileId` (basename)
-- or the storage object UUID returned by the list endpoint, and the server
-- finds the real `${user_id}/${project_id}/posts/${mediaFolder}/${fileId}`
-- path to remove.
--
-- - `p_user_prefix` should always be `${user_id}/` (the trailing slash matters
--   so we never match another user whose UUID starts with the same hex).
-- - `p_object_id` is preferred when supplied (PK lookup, fast).
-- - `p_basename` matches any object whose name ends with `/${basename}` —
--   compared with `right(name, length(basename) + 1)` to avoid LIKE escaping
--   issues with `%` and `_` characters in user-supplied filenames.
-- - At most one row is returned (most recent first); the caller can decide
--   whether ambiguity is an error.

create or replace function public.resolve_user_storage_object(
  p_user_prefix text,
  p_bucket_ids text[],
  p_object_id uuid default null,
  p_basename text default null
)
returns table(bucket_id text, name text)
language sql stable
as $$
  select o.bucket_id::text, o.name
  from storage.objects o
  where o.bucket_id = any(p_bucket_ids)
    and o.name like p_user_prefix || '%'
    and (
      (p_object_id is not null and o.id = p_object_id)
      or (
        p_basename is not null
        and length(p_basename) > 0
        and right(o.name, length(p_basename) + 1) = '/' || p_basename
      )
    )
  order by o.created_at desc nulls last
  limit 1;
$$;

comment on function public.resolve_user_storage_object(text, text[], uuid, text) is
  'Resolve a storage.objects row by UUID id or trailing basename, scoped to a user_id/ prefix. Used by the extension delete-storage-file route.';
