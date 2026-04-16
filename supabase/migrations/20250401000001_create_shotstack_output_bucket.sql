-- Create shotstack-output storage bucket for persisting rendered videos from ShotStack CDN.
-- Public bucket so rendered media can be accessed by URL.
insert into storage.buckets (id, name, public)
values ('shotstack-output', 'shotstack-output', true)
on conflict (id) do nothing;
