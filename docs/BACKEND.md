# Host backend: workflows and step narration

This document is the implementer-facing spec for **extensiblecontent.com** (or any host of the extension API). Canonical contract details also appear in [BACKEND_IMPLEMENTATION_PROMPT.md](BACKEND_IMPLEMENTATION_PROMPT.md) and [EXTENSION_API_REQUIREMENTS.md](EXTENSION_API_REQUIREMENTS.md).

## Step narration (block list in workflow JSON)

Step narration is **not** stored in a separate table or narration API. The extension embeds narration in the workflow document under analyzed actions, typically:

- `analyzed.actions[].comment` — object the client owns (may include a block list and other fields).
- `analyzed.actions[].comment.items` — array of blocks. Common `type` values include `text`, `video`, and `audio`. Items often carry `id`, `text`, and `url` (HTTPS after upload, or `data:` when upload is unavailable).

The host **must** persist and return the full `workflow` JSONB from `POST`/`PATCH`/`GET` `/api/extension/workflows` **without** stripping, allowlisting, or normalizing away `comment`, `comment.items`, or unknown keys anywhere in the tree. See [lib/workflow-json-contract.ts](../lib/workflow-json-contract.ts) for forward-compatible typing notes.

## Recorded video/audio uploads

`POST /api/extension/workflow-step-media` accepts **multipart FormData** so large recordings are not inlined in the workflow PATCH body:

| Field | Required | Description |
|--------|----------|-------------|
| `file` | Yes | Binary file (e.g. webm, mp4). |
| `workflow_id` | Yes | UUID of the workflow the user may edit. |
| `step_index` | Yes | Non-negative integer (step index in the workflow). |
| `block_id` | Yes | Client block id (sanitized for storage path). |
| `kind` | Yes | Opaque tag (e.g. `video` / `audio`); used in the storage path. |

**Response:** `{ "url": "https://..." }` — public object URL from Supabase Storage (bucket `workflow-data`). The extension should write this `url` into the appropriate `comment.items[]` entry and PATCH the workflow.

**Auth:** `Authorization: Bearer <token>` (same Whop-backed extension user as other extension routes).

**Image / link blocks:** Today the host only exposes this multipart route for **file** uploads. Image or link blocks that are already URL-based continue to use **URLs only** in JSON (no extra multipart `kind` beyond what the client sends for recorded media).

## Host verification checklist

After deploy, confirm the following against the live API (replace `BASE` and use a real Bearer token and workflow id you own):

1. **Route exists:** `POST BASE/api/extension/workflow-step-media` returns `401` without `Authorization` (body `{"error":"Unauthorized"}`), and with valid auth + valid form fields returns `200` and JSON `{ url }` with an `https` URL. Quick smoke: `curl -sS -X POST "$BASE/api/extension/workflow-step-media"` → `401`.
2. **Size limit:** Default max upload size is **4,500,000** bytes (Vercel-friendly). Optional env: `WORKFLOW_STEP_MEDIA_MAX_BYTES`. Over-limit returns **413**.
3. **Access:** Wrong or non-accessible `workflow_id` returns **404** (not 403). User must be creator or in `workflow_added_by`; workflow must not be archived.
4. **Storage URL:** `GET` the returned `url` in a browser or `curl` and expect **200** if the bucket allows public read (or adjust policies / CDN as needed).
5. **Round-trip `comment.items`:** `PATCH` `/api/extension/workflows/{id}` with a `workflow` object that includes `analyzed.actions[0].comment.items` (e.g. text + video + audio entries and extra passthrough keys). `GET` the same workflow and assert the same `comment.items` subtree is unchanged.

## Environment and storage

- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required for uploads.
- Supabase Storage bucket **`workflow-data`** must exist. The app uses `@supabase/supabase-js` storage APIs (not direct S3 from the route handler); an S3-compatible endpoint on the project is optional for other tools.

## Extension client

The Chrome extension should call `{siteOrigin}/api/extension/workflow-step-media` with the FormData fields above. **This repository may not contain** `extension/api.js`; whichever repo ships the extension must keep the path and field names in sync with [app/api/extension/workflow-step-media/route.ts](../app/api/extension/workflow-step-media/route.ts).

## Sidebars (extension presence)

Implemented under `app/api/extension/sidebars/`. The [ExtensibleContentExtension](https://github.com/contentrewardsai/ExtensibleContentExtension) `SidebarsApi` and MCP server call these routes.

| Method | Path | Purpose |
|--------|------|--------|
| GET, HEAD | `/api/extension/sidebars` | **GET**: full rows; each includes `connected` unless `omit_connected=1`/`true`/`yes`. **HEAD**: same auth and query params; count-only DB request (no row bodies); **`X-Result-Count`** = number of rows that would be returned (honors `since` and `limit`). **`since`**: rows with **`last_seen` strictly after** the parsed instant (incremental polling / probes). CORS exposes `X-Result-Count` for browser extension `fetch`. Optional: `since` (ISO 8601); `limit` (1–200). Both: `Cache-Control: private, no-store`, `Vary: Authorization`. |
| POST | `/api/extension/sidebars/register` | Upsert on `(user_id, window_id)`; `window_id` max 512 chars, `sidebar_name` max 256; optional `active_project_id` must be a project owned by the user (**404** if UUID valid but not yours; invalid UUID coerced to null). **Realtime** `list_updated` is broadcast only on **insert** or when **`sidebar_name`** or **`active_project_id`** change vs the existing row — not on re-register that only refreshes `last_seen` / IP (reduces channel noise; other clients still see presence via polling / their own heartbeats). |
| GET, PATCH, POST | `/api/extension/sidebars/[id]` | `[id]` must be a UUID. Update name/project; non-null `active_project_id` must belong to user (**404** otherwise). Always bumps `last_seen` (POST aliases PATCH for relays). |
| POST | `/api/extension/sidebars/heartbeat` | Touch `last_seen` only: exactly one of `sidebar_id` or `window_id`, or batch body with `backend_ids` only (max 64 UUIDs). Batch JSON: `{ updated, requested, skipped, sidebars }` (`skipped` = ids not owned / unknown). |
| POST | `/api/extension/sidebars/disconnect` | Delete row; exactly one of `sidebar_id` or `window_id`. |

Details and limits: [EXTENSION_API_REQUIREMENTS.md](EXTENSION_API_REQUIREMENTS.md).

**ExtensibleContentExtension:** `SidebarsApi.listSidebars` and **`SidebarsApi.probeSidebarsListCount`** use MCP **`GET` / `HEAD` `/api/sidebars`** when healthy; the MCP server proxies to the host via the relay (relay WebSocket includes **`resultCount`** from **`X-Result-Count`** on HEAD). The Activity tab uses two **`HEAD`** probes when a prior list exists: **`since`** = max **`last_seen`** from the cache (count of rows **newer** than that watermark) and a second probe **without** `since` (total row count). It skips **`listSidebars`** only when the incremental count is **0** **and** the total count still equals the cached list length (avoids stale UI after a disconnect, which does not bump `last_seen`). **`refreshActivitySidebarsSoon()`** clears cache after local register/update so the list refetches immediately. Full patch: [docs/patches/extensible-content-extension-sidebar-heartbeat.patch](patches/extensible-content-extension-sidebar-heartbeat.patch). From a clone of that repo: `git apply /path/to/this-repo/docs/patches/extensible-content-extension-sidebar-heartbeat.patch` (or cherry-pick if you maintain a fork).
