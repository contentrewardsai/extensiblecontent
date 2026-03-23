-- Answers may be workflow-linked, free text, or both. Workflow eligibility only enforced when workflow_id is set.

drop trigger if exists knowledge_answers_workflow_eligible_trg on public.knowledge_answers;

alter table public.knowledge_answers drop constraint if exists knowledge_answers_question_id_workflow_id_key;

alter table public.knowledge_answers alter column workflow_id drop not null;

alter table public.knowledge_answers
  add column if not exists answer_text text;

alter table public.knowledge_answers
  add constraint knowledge_answers_workflow_or_text_chk
  check (
    workflow_id is not null
    or (answer_text is not null and btrim(answer_text) <> '')
  );

create unique index if not exists knowledge_answers_question_workflow_uniq
  on public.knowledge_answers (question_id, workflow_id)
  where workflow_id is not null;

comment on column public.knowledge_answers.answer_text is 'Optional or standalone text answer; may accompany workflow_id';

comment on table public.knowledge_answers is 'Moderated answers: optional catalog workflow link, optional/free-text body, or both';

create or replace function public.knowledge_answers_workflow_must_be_kb_eligible()
returns trigger
language plpgsql
as $$
begin
  if new.workflow_id is not null then
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
  end if;
  return new;
end;
$$;

create trigger knowledge_answers_workflow_eligible_trg
  before insert or update on public.knowledge_answers
  for each row
  execute procedure public.knowledge_answers_workflow_must_be_kb_eligible();
