-- Per-user up/down votes on approved knowledge answers (extension UI).

create table if not exists public.knowledge_answer_votes (
  answer_id uuid not null references public.knowledge_answers (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_answer_votes_answer_user_key unique (answer_id, user_id)
);

comment on table public.knowledge_answer_votes is 'User votes on knowledge answers; one row per (answer, user)';

create index if not exists knowledge_answer_votes_answer_id_idx
  on public.knowledge_answer_votes (answer_id);

create index if not exists knowledge_answer_votes_user_answer_idx
  on public.knowledge_answer_votes (user_id, answer_id);

alter table public.knowledge_answer_votes enable row level security;

create or replace function public.knowledge_answer_votes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_answer_votes_updated_at_trg on public.knowledge_answer_votes;
create trigger knowledge_answer_votes_updated_at_trg
  before update on public.knowledge_answer_votes
  for each row
  execute procedure public.knowledge_answer_votes_set_updated_at();
