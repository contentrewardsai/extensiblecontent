# Site API Requirements

The extensiblecontent.com site should expose these endpoints for the Chrome extension. If any are missing, the extension will fall back to local behavior or show errors where those features are used.

## Required by extension

- **Page captures:** GET/POST /api/extension/page-captures, POST /api/extension/page-capture-sections
- **Social profiles:** GET/POST /api/extension/social-profiles, GET/PATCH/DELETE /api/extension/social-profiles/[id] ✓ (uses upload_post_accounts; creates in Upload-Post)
- **Upload-Post key:** GET /api/extension/upload-post-key ✓
- **Pro status:** GET /api/extension/has-upgraded ✓
- **Default project:** GET/PATCH /api/extension/user/default-project ✓

## Implemented extension APIs

- POST /api/extension/auth, POST /api/extension/refresh
- GET /api/extension/proxy
- GET/POST /api/extension/projects, GET/PATCH/DELETE /api/extension/projects/[id]
- GET/POST /api/extension/workflows, GET/PATCH/DELETE /api/extension/workflows/[id]
- **Workflow step media:** `POST /api/extension/workflow-step-media` — multipart FormData: `file`, `workflow_id`, `step_index`, `block_id`, `kind`. Bearer required. Returns `{ url }` (Supabase Storage public URL, bucket `workflow-data`). See [BACKEND.md](BACKEND.md).
- GET/POST /api/extension/following, GET/PATCH/DELETE /api/extension/following/[id]
- GET /api/extension/sidebars, POST /api/extension/sidebars/register, POST /api/extension/sidebars/disconnect, GET/PATCH /api/extension/sidebars/[id]
- GET /api/extension/industries, GET /api/extension/platforms, GET /api/extension/monetization
- **Upload-Post accounts:** GET/POST /api/extension/upload-post-accounts, POST /api/extension/upload-post-accounts/repair, GET/PATCH/DELETE /api/extension/upload-post-accounts/[id], POST /api/extension/upload-post-accounts/[id]/connect-url
- **Upload-Post proxy:** POST /api/extension/upload-post/proxy
- **ShotStack:** POST /api/extension/shotstack/render, GET /api/extension/shotstack/status/[id], GET /api/extension/shotstack/renders, GET /api/extension/shotstack/credits
- **Knowledge (domain Q&A → workflows + text):**
  - `GET /api/extension/knowledge/qa` — Bearer required. Query: exactly one of `origin`, `hostname`, or `domain` (normalized to `site_domain`: lowercase host, strip leading `www.`). Returns JSON array of `{ question: { id, text, site_domain, created_at }, answer: { id, workflow_id, answer_text, created_at, thumbs_up_count, thumbs_down_count, my_vote }, workflow: { id, name, version } | null }` for **approved** questions and **approved** answers only. `workflow` is `null` for text-only answers; `answer_text` may accompany a linked workflow (no full `workflow` JSON). `thumbs_*_count` are non-negative integers; `my_vote` is `'up'`, `'down'`, or `null` when the caller has not voted.
  - `POST /api/extension/knowledge/questions` — Body: `{ text, origin | hostname | domain }` (exactly one of the three). Creates question with `status: pending`.
  - `POST /api/extension/knowledge/answers` — **ExtensionApi.addWorkflowAnswerQA** shape extended: `{ question_id, workflow_id?, text? }` — at least one of `workflow_id` or non-empty `text`. With `workflow_id`, workflow must be **published**, **approved**, **not private**, and **not archived**. `409` if the same `question_id` + `workflow_id` pair already exists (text-only rows do not use that unique key).
  - `POST /api/extension/knowledge/votes` — Bearer required. Body: `{ answer_id, direction: 'up' | 'down' | 'none' }`. Targets **approved** answers whose question is **approved** (same visibility as QA list). `up` / `down` upserts one row per caller per answer (unique `(answer_id, user_id)`), replacing a previous vote so the caller can flip. `none` deletes the caller’s vote row if present. Returns JSON `{ answer_id, direction, thumbs_up_count, thumbs_down_count, my_vote }` (`my_vote` is `null` after `none`).

## Workflow sync payload limits

`POST` and `PATCH` `/api/extension/workflows` send the full `workflow` document as JSON. Multiple `data:` URLs for embedded video/audio can make a single request body very large.

- **Vercel Serverless Functions:** request body limit is **4.5 MB**; larger bodies typically fail with **413** (`FUNCTION_PAYLOAD_TOO_LARGE`). See [Vercel: bypass body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) and [FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE).
- **Self-hosted / other proxies:** confirm limits separately (e.g. nginx `client_max_body_size`; defaults are often **1 MB** unless raised).
- **Mitigation:** upload media to object storage (presigned S3, Supabase Storage, Vercel Blob) and persist **HTTPS URLs** in `comment.items[].url` (or equivalent) instead of huge inline `data:` payloads. No separate “comments API” is required if the workflow blob stays the source of truth.
- **Database:** Postgres `jsonb` handles nested structures; very large inlined base64 still increases row/TOAST size—monitor storage if many workflows embed large blobs.
