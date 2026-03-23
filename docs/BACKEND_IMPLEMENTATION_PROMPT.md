# Backend contract (extension sync)

## Workflow document JSON (`workflows.workflow`)

The `workflows` table stores the extension workflow as a single **`workflow` JSONB column**. The API must treat this blob as **opaque JSON**: persist whatever the client sends (after shallow checks: non-null object on create/update) and return it intact on read.

**Do not** introduce allowlists, `pick`/`omit`, or recursive normalization that **drops unknown keys**, including anywhere under `analyzed.actions[].comment` (e.g. rich `comment.items[]`, future fields). Forward-compatible clients rely on round-tripping extra properties.

**Optional product shape (documentation only):** If you add server-side validation later, extend it to **allow** `comment.items[]` entries with `type` in `text | video | audio` and optional `id`, `text`, `url`, while still **preserving** other keys on those objects and on the workflow tree (e.g. in Zod, use `.passthrough()` or validate only known branches without stripping the rest). Type-level notes: [`lib/workflow-json-contract.ts`](../lib/workflow-json-contract.ts).

**Payload size:** Large `data:` URLs in the JSON can exceed host request body limits. See [Workflow sync payload limits](EXTENSION_API_REQUIREMENTS.md#workflow-sync-payload-limits) in `EXTENSION_API_REQUIREMENTS.md`.

Signed-in clients already sync the **full** workflow document; new nested fields ride along automatically once the extension writes them to local state and PATCHes/POSTs the body.

## Step narration in workflow JSON

**No separate narration API.** Step narration lives inside the workflow document (e.g. `analyzed.actions[].comment` and `comment.items[]` with blocks such as `type: text | video | audio` and fields like `id`, `text`, `url`).

**Do not prune:** Treat `workflows.workflow` as **opaque JSON** for all nested keys. Never allowlist or strip `comment`, `comment.items`, or unknown properties on items. If you add Zod (or similar) later, use `.passthrough()` on objects that clients extend. See [`lib/workflow-json-contract.ts`](../lib/workflow-json-contract.ts) and [BACKEND.md](BACKEND.md).

## `POST /api/extension/workflow-step-media`

Multipart **FormData** upload to Supabase Storage (`workflow-data` bucket); response `{ url }` for HTTPS URLs in `comment.items[].url` (avoids huge `data:` payloads in PATCH bodies).

**Checklist for implementers**

- [ ] **Auth:** `Authorization: Bearer <token>` via same extension user resolution as other `/api/extension/*` routes (`getExtensionUser`).
- [ ] **Fields:** `file`, `workflow_id` (UUID), `step_index` (non-negative int), `block_id`, `kind` (all required; `kind` / `block_id` sanitized for object path).
- [ ] **Access:** Workflow exists, not archived; user is `created_by` or in `workflow_added_by`.
- [ ] **Storage path pattern:** `{user_id}/{workflow_id}/step-{n}/{kind}/{block_id}/{uuid}{ext}` (see route implementation).
- [ ] **Public URL:** `getPublicUrl` — ensure bucket or policies allow clients to **read** objects if the extension or site loads media by URL.
- [ ] **Size:** Default max **4,500,000** bytes; optional `WORKFLOW_STEP_MEDIA_MAX_BYTES`. Return **413** when over limit.
- [ ] **Errors:** **401** missing/invalid token; **400** bad multipart/validation; **404** workflow not found or no access; **503** Supabase env missing; **500** upload failure.

Reference: [app/api/extension/workflow-step-media/route.ts](../app/api/extension/workflow-step-media/route.ts), [docs/BACKEND.md](BACKEND.md).

## Cursor / agent prompt (copy-paste)

```
Implement or verify the extension host backend for step narration:

1. Workflows API must persist workflows.workflow as opaque JSON — never strip analyzed.actions[].comment or comment.items[] (or unknown keys). POST/PATCH/GET /api/extension/workflows must round-trip the full blob. See docs/BACKEND_IMPLEMENTATION_PROMPT.md and lib/workflow-json-contract.ts.

2. Expose POST /api/extension/workflow-step-media: multipart FormData fields file, workflow_id, step_index, block_id, kind; Bearer auth; upload to Supabase bucket workflow-data; return JSON { url }. Enforce workflow access, default ~4.5MB max (WORKFLOW_STEP_MEDIA_MAX_BYTES optional). Document verification in docs/BACKEND.md.

3. After implementation, run the host verification checklist in docs/BACKEND.md (401 without auth, 200 + url with auth, GET url, PATCH/GET comment.items round-trip).
```

## Following row timestamps

Each **following** row returned by the extension API (`GET`/`POST`/`PATCH` `/api/extension/following` and `/api/extension/following/[id]`) includes **`updated_at`** as an ISO-8601 timestamp string (Postgres `timestamptz` serialized by Supabase/Next).

Clients use this as **`server_updated_at`** for profile-level last-write-wins (LWW) against local edit times. Nested rows (`following_accounts`, phones, emails, etc.) do not carry separate LWW in v1 unless the API is extended later.

If a response omits `updated_at` or it is unparseable, the extension **does not apply the LWW branches** and falls back to legacy merge behavior (union of child rows; scalar merge as documented in the client).
