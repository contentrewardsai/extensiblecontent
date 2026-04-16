-- Create post-media storage bucket for social post uploads (used by social-post/storage routes).
-- Public bucket so uploaded media can be referenced by URL in Upload Post API calls.
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;
