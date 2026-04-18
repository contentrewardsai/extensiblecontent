-- Distribution Comparison config for the promotion plan editor.
--
-- Stores the per-plan settings for the side-by-side comparison of
-- Organic / Clippers / Ads (funnel rates, budgets, product price,
-- profit margin, etc.). The shape is intentionally a single JSONB
-- column so the client can iterate on the funnel structure without
-- needing schema migrations for every new field.
--
-- Default mirrors the in-app default in `lib/promotion-plan.ts` ->
-- `defaultComparison()` so new rows inserted by /api/plan/:planId
-- (PUT) AND legacy rows that predate this column both end up with a
-- usable starting point.

alter table public.promotion_plans
  add column if not exists comparison jsonb not null default jsonb_build_object(
    'funnel_type', 'leads',
    'product_price', 97,
    'profit_margin', 50,
    'organic',  jsonb_build_object(
      'tier', 1.33,
      'posts_per_day', 5,
      'views_per_post', 500,
      'rates', jsonb_build_object('click', 0.5, 'lp', 80, 'lead', 30, 'sale', 2)
    ),
    'clippers', jsonb_build_object(
      'budget', 4.34,
      'rate_per_1k', 1.0,
      'posts_per_day', 15,
      'rates', jsonb_build_object('click', 0.5, 'lp', 80, 'lead', 30, 'sale', 1)
    ),
    'ads', jsonb_build_object(
      'budget', 4.33,
      'cpm', 20,
      'rates', jsonb_build_object('click', 2.0, 'lp', 85, 'lead', 30, 'sale', 3)
    )
  );
