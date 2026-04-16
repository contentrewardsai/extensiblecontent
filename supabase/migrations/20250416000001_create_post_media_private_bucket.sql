-- Create post-media-private storage bucket for files the user wants to keep private.
-- Same folder structure as post-media but access requires signed URLs.
insert into storage.buckets (id, name, public)
values ('post-media-private', 'post-media-private', false)
on conflict (id) do nothing;
