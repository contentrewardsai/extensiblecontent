-- Drop generator_templates: consolidated into shotstack_templates.
-- The shotstack_templates.edit column stores the same JSON payload that
-- generator_templates.payload held; use shotstack_templates for all template types.
drop table if exists public.generator_templates;
