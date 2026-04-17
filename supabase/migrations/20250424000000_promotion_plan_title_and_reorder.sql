-- Plan-level display title + fractional reordering support.
--
-- 1) `promotion_plans.title`
--    Until now the URL slug doubled as the plan's display name. Add a
--    proper free-form title so users can label the plan independently of
--    the slug ("Spring 2026 Launch" vs. /plan/spring-launch-9f2). Defaults
--    to '' so existing rows are unaffected; the UI falls back to the slug
--    when empty.
--
-- 2) `promotion_plan_platforms.position` & `promotion_plan_content.position`
--    Switch from `integer` to `double precision` so we can use the
--    standard fractional-position trick for reordering: when an item
--    moves between A and B, its new position is `(A.position + B.position) / 2`.
--    That's a single PATCH per move with no risk of collisions and no
--    need to re-number every sibling. Existing integer values cast
--    losslessly to double precision.

alter table public.promotion_plans
  add column if not exists title text not null default '';

alter table public.promotion_plan_platforms
  alter column position type double precision using position::double precision;

alter table public.promotion_plan_content
  alter column position type double precision using position::double precision;
