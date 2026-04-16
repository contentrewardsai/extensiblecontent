-- RPC functions for querying storage.objects across buckets.
-- The storage schema is not exposed via PostgREST, so we need
-- public-schema functions that the service role client can call.

create or replace function public.get_user_storage_stats(
  p_user_prefix text,
  p_bucket_ids text[]
)
returns table(bucket_id text, file_count bigint, total_bytes bigint)
language sql stable
as $$
  select
    o.bucket_id::text,
    count(*)::bigint as file_count,
    coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes
  from storage.objects o
  where o.bucket_id = any(p_bucket_ids)
    and o.name like p_user_prefix || '%'
  group by o.bucket_id;
$$;

create or replace function public.list_user_storage_files(
  p_user_prefix text,
  p_bucket_ids text[],
  p_limit int default 100,
  p_offset int default 0
)
returns table(id uuid, bucket_id text, name text, metadata jsonb, created_at timestamptz)
language sql stable
as $$
  select o.id, o.bucket_id::text, o.name, o.metadata, o.created_at
  from storage.objects o
  where o.bucket_id = any(p_bucket_ids)
    and o.name like p_user_prefix || '%'
  order by o.created_at desc
  limit p_limit
  offset p_offset;
$$;
