-- Curator-approved workflows may be linked as knowledge-base answers (with published + public + not archived).
alter table public.workflows
  add column if not exists approved boolean not null default false;

create index if not exists workflows_kb_eligible_idx
  on public.workflows (id)
  where published = true
    and approved = true
    and private = false
    and archived = false;

create table if not exists public.knowledge_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  text text not null,
  site_domain text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references public.users (id) on delete set null,
  moderation_note text
);

comment on table public.knowledge_questions is 'User-submitted questions per site domain; moderated before public Q&A listing';

create index if not exists knowledge_questions_site_domain_idx on public.knowledge_questions (site_domain);
create index if not exists knowledge_questions_status_idx on public.knowledge_questions (status);

alter table public.knowledge_questions enable row level security;

create table if not exists public.knowledge_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.knowledge_questions (id) on delete cascade,
  workflow_id text not null references public.workflows (id) on delete restrict,
  submitter_user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references public.users (id) on delete set null,
  moderation_note text,
  unique (question_id, workflow_id)
);

comment on table public.knowledge_answers is 'Links an approved question to a catalog-eligible workflow; moderated separately from questions';

create index if not exists knowledge_answers_question_id_idx on public.knowledge_answers (question_id);
create index if not exists knowledge_answers_workflow_id_idx on public.knowledge_answers (workflow_id);
create index if not exists knowledge_answers_status_idx on public.knowledge_answers (status);

alter table public.knowledge_answers enable row level security;

create or replace function public.knowledge_answers_workflow_must_be_kb_eligible()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.workflows w
    where w.id = new.workflow_id
      and w.published = true
      and w.approved = true
      and w.private = false
      and w.archived = false
  ) then
    raise exception 'workflow must be published, approved, public (not private), and not archived';
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_answers_workflow_eligible_trg on public.knowledge_answers;
create trigger knowledge_answers_workflow_eligible_trg
  before insert or update of workflow_id on public.knowledge_answers
  for each row
  execute procedure public.knowledge_answers_workflow_must_be_kb_eligible();
