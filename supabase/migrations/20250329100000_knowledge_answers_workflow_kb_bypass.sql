-- Allow knowledge answer rows to reference not-yet-catalog-eligible workflows when
-- workflow_kb_check_bypass is true (API sets this only for authenticated workflow owners).
-- Approving an answer still requires the linked workflow to be KB-eligible.

alter table public.knowledge_answers
  add column if not exists workflow_kb_check_bypass boolean not null default false;

comment on column public.knowledge_answers.workflow_kb_check_bypass is
  'When true, insert skipped catalog eligibility; approval still requires eligible workflow.';

create or replace function public.knowledge_answers_workflow_must_be_kb_eligible()
returns trigger
language plpgsql
as $$
begin
  if new.workflow_id is null then
    return new;
  end if;
  -- Approved answers always require a catalog-eligible workflow (even if submitted via for_review).
  if new.status = 'approved' then
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
  end if;
  if coalesce(new.workflow_kb_check_bypass, false) then
    return new;
  end if;
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
