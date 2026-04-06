# Site API Requirements

The extensiblecontent.com site should expose these endpoints for the Chrome extension. If any are missing, the extension will fall back to local behavior or show errors where those features are used.

## Required by extension

- **Page captures:** GET/POST /api/extension/page-captures, POST /api/extension/page-capture-sections
- **Social profiles:** GET/POST /api/extension/social-profiles, GET/PATCH/DELETE /api/extension/social-profiles/[id] ✓ (uses upload_post_accounts; creates in Upload-Post)
- **Upload-Post key:** GET /api/extension/upload-post-key ✓
- **Pro status:** GET /api/extension/has-upgraded ✓ — JSON `{ has_upgraded, pro, num_accounts, max_accounts }`. Field `pro` mirrors `has_upgraded` for older clients. `num_accounts` is the user’s Upload-Post / Connected profile count (`upload_post_accounts`). `max_accounts` is `users.max_upload_post_accounts` (same limit as POST `/api/extension/social-profiles`); when `max_accounts <= 0`, new Connected profiles are not allowed (server returns **403** on POST). Extensions should use `num_accounts` / `max_accounts` for UI such as “Connected: (n / max)” and upgrade CTAs; the server remains authoritative.
- **Default project:** GET/PATCH /api/extension/user/default-project ✓

## Implemented extension APIs

- POST /api/extension/auth, POST /api/extension/refresh
- GET /api/extension/proxy
- GET/POST /api/extension/projects, GET/PATCH/DELETE /api/extension/projects/[id]
- GET/POST /api/extension/workflows, GET/PATCH/DELETE /api/extension/workflows/[id]
- **Workflow step media:** `POST /api/extension/workflow-step-media` — multipart FormData: `file`, `workflow_id`, `step_index`, `block_id`, `kind`. Bearer required. Returns `{ url }` (Supabase Storage public URL, bucket `workflow-data`). See [BACKEND.md](BACKEND.md).
- GET/POST /api/extension/following, GET/PATCH/DELETE /api/extension/following/[id]
- GET/HEAD /api/extension/sidebars (HEAD: no body, count-only query, **`X-Result-Count`**; CORS **`Access-Control-Expose-Headers: X-Result-Count`**; optional `since` — rows with **`last_seen` strictly after** the given ISO instant (incremental list / probe), `limit` 1–200, `omit_connected`; `Cache-Control: private, no-store`, `Vary: Authorization`; extension **`SidebarsApi.probeSidebarsListCount`** = MCP **`HEAD /api/sidebars`** or direct **`HEAD`**; MCP relay forwards **`resultCount`** from response header over WebSocket), POST /api/extension/sidebars/register (`window_id` ≤512 chars, `sidebar_name` ≤256; `active_project_id` must belong to caller or **404**; **Realtime `list_updated`** only on new row or when `sidebar_name` / `active_project_id` change, not on heartbeat-only upsert), POST /api/extension/sidebars/disconnect (exactly one of `sidebar_id` or `window_id`; `sidebar_id` must be UUID), POST /api/extension/sidebars/heartbeat (single: exactly one of `sidebar_id` or `window_id` with UUID for `sidebar_id`; batch: `backend_ids: string[]` only — Supabase UUIDs, max 64, deduped; **`200`** with `updated`, `requested`, `skipped`, `sidebars` — batch **`updated` may be `0`** when no id matches the user, still **`200`** not **404**), GET/PATCH/POST /api/extension/sidebars/[id] (`[id]` UUID; POST aliases PATCH; non-empty `sidebar_name` ≤256; non-null `active_project_id` must be caller's project — **404**)
- GET /api/extension/industries, GET /api/extension/platforms, GET /api/extension/monetization
- **Upload-Post accounts:** GET/POST /api/extension/upload-post-accounts, POST /api/extension/upload-post-accounts/repair, GET/PATCH/DELETE /api/extension/upload-post-accounts/[id], POST /api/extension/upload-post-accounts/[id]/connect-url
- **Upload-Post proxy:** POST /api/extension/upload-post/proxy
- **ShotStack:** POST /api/extension/shotstack/render, GET /api/extension/shotstack/status/[id], GET /api/extension/shotstack/renders, GET /api/extension/shotstack/credits
- **Cloud templates (sync with Whop web app):**
  - `GET/POST /api/extension/generator-templates`, `GET/PATCH/DELETE /api/extension/generator-templates/[id]` — JSON `payload` is an opaque generator document (extension-defined). **Extension:** on save / panel load, POST or GET to merge with local `generator/templates`.
  - `GET/POST /api/extension/shotstack-templates`, `GET/PATCH/DELETE /api/extension/shotstack-templates/[id]` — `edit` is ShotStack timeline JSON; `default_env`: `stage` \| `v1`. **Extension:** sync saved ShotStack templates the same way.

**ExtensibleContentExtension repo:** On generator “save template” / ShotStack template save, call `POST` or `PATCH` the routes above with `Authorization: Bearer <access_token>`. On side panel load, `GET` both lists and merge with local files under `generator/templates/` (merge strategy: by stable `id` from server, or name + `updated_at`). The Whop web app at `/experiences/[experienceId]/…` reads the same tables.
- **Knowledge (domain Q&A → workflows + text):**
  - `GET /api/extension/knowledge/qa` — Bearer required. Query: exactly one of `origin`, `hostname`, or `domain` (normalized to `site_domain`: lowercase host, strip leading `www.`). Returns JSON array of `{ question: { id, text, site_domain, created_at }, answer: { id, workflow_id, answer_text, created_at, thumbs_up_count, thumbs_down_count, my_vote }, workflow: { id, name, version } | null }` for **approved** questions and **approved** answers only. `workflow` is `null` for text-only answers; `answer_text` may accompany a linked workflow (no full `workflow` JSON). `thumbs_*_count` are non-negative integers; `my_vote` is `'up'`, `'down'`, or `null` when the caller has not voted.
  - `POST /api/extension/knowledge/questions` — Body: `{ text, origin | hostname | domain }` (exactly one of the three). Creates question with `status: pending`.
  - `POST /api/extension/knowledge/answers` — **ExtensionApi.addWorkflowAnswerQA** shape extended: `{ question_id, workflow_id?, text?, for_review? }` — at least one of `workflow_id` or non-empty `text`. With `workflow_id` and **without** `for_review: true`, workflow must be **published**, **approved**, **not private**, and **not archived** (`400` with the same message as today if not). With **`for_review: true`**, `workflow_id` is **required**; catalog eligibility is skipped, but the bearer must be the workflow **creator** or in **`workflow_added_by`** (otherwise `404` “Workflow not found”, same as GET workflow). The row is stored with `status: pending` and `workflow_kb_check_bypass: true`; **moderation must not set `approved` until the workflow satisfies the same KB rules** (enforced by DB on `status → approved`). Successful JSON includes `workflow_kb_check_bypass` and, when that path was used, `submission_kind: "workflow_pending_catalog"` (for client UX). `409` if the same `question_id` + `workflow_id` pair already exists (text-only rows do not use that unique key).
  - `POST /api/extension/knowledge/votes` — Bearer required. Body: `{ answer_id, direction: 'up' | 'down' | 'none' }`. Targets **approved** answers whose question is **approved** (same visibility as QA list). `up` / `down` upserts one row per caller per answer (unique `(answer_id, user_id)`), replacing a previous vote so the caller can flip. `none` deletes the caller’s vote row if present. Returns JSON `{ answer_id, direction, thumbs_up_count, thumbs_down_count, my_vote }` (`my_vote` is `null` after `none`).

## Workflow sync payload limits

`POST` and `PATCH` `/api/extension/workflows` send the full `workflow` document as JSON. Multiple `data:` URLs for embedded video/audio can make a single request body very large.

- **Vercel Serverless Functions:** request body limit is **4.5 MB**; larger bodies typically fail with **413** (`FUNCTION_PAYLOAD_TOO_LARGE`). See [Vercel: bypass body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) and [FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE).
- **Self-hosted / other proxies:** confirm limits separately (e.g. nginx `client_max_body_size`; defaults are often **1 MB** unless raised).
- **Mitigation:** upload media to object storage (presigned S3, Supabase Storage, Vercel Blob) and persist **HTTPS URLs** in `comment.items[].url` (or equivalent) instead of huge inline `data:` payloads. No separate “comments API” is required if the workflow blob stays the source of truth.
- **Database:** Postgres `jsonb` handles nested structures; very large inlined base64 still increases row/TOAST size—monitor storage if many workflows embed large blobs.
