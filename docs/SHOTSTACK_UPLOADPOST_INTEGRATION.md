# ShotStack & Upload-Post Integration

This document describes the backend integration for ShotStack (video rendering) and Upload-Post (social media posting).

## Architecture Overview

### ShotStack
- **Managed keys**: `SHOTSTACK_STAGING_API_KEY` (sandbox, watermarked) and `SHOTSTACK_API_KEY` (production)
- **BYOK**: Users can provide their own API key (`shotstack_api_key_encrypted` on users table)
- **Credits**: 1 credit = 1 minute of video, billed by the second. We track credits ourselves (ShotStack has no credits API).

### Upload-Post
- **Managed accounts**: We create profiles under our `UPLOAD_POST_API_KEY`; users connect social handles via JWT URL
- **BYOK**: Users can connect accounts using their own Upload-Post API key (`uses_own_key` on upload_post_accounts)
- **Limits**: `max_upload_post_accounts` on users table (0 = disabled, 1+ = limit)

---

## Database Schema

### users (extended)
| Column | Type | Description |
|--------|------|-------------|
| shotstack_credits | numeric | Credits remaining (1/min) |
| shotstack_api_key_encrypted | text | BYOK: encrypted key (TODO: implement encryption) |
| max_upload_post_accounts | int | Max Upload-Post accounts (0 = none) |

### upload_post_accounts
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to users |
| name | text | User-facing label |
| upload_post_username | text | Stable ID for Upload-Post API |
| uses_own_key | bool | true = user's key, false = our key |
| upload_post_api_key_encrypted | text | BYOK: user's API key (plain for now; TODO encrypt) |
| jwt_access_url | text | Cached JWT URL (valid 48h) |
| jwt_expires_at | timestamptz | When cached JWT expires |

### shotstack_usage
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | FK to users |
| shotstack_render_id | text | From ShotStack response |
| duration_seconds | numeric | Video length |
| credits_used | numeric | duration_seconds / 60 |

---

## API Endpoints

### ShotStack
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/extension/shotstack/render | Queue render. Body: `{ edit, duration_seconds, env?, use_own_key? }` |
| GET | /api/extension/shotstack/status/[id] | Check render status (updates output_url when done) |
| GET | /api/extension/shotstack/renders | List user's renders (optional ?env=stage) |
| GET | /api/extension/shotstack/credits | Get user's credits |
| POST | /api/shotstack/test-render | Backend test: submit Summer Holiday to staging. Header: `X-Test-Secret`. Query: `?wait=true` to poll until done. |

### Upload-Post Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/extension/upload-post-accounts | List user's accounts |
| POST | /api/extension/upload-post-accounts | Create account. Body: `{ name, api_key? }`. With `api_key` = BYOK |
| POST | /api/extension/upload-post-accounts/repair | Repair orphaned accounts (create missing Upload-Post profiles) |
| GET | /api/extension/upload-post-accounts/[id] | Get one account |
| PATCH | /api/extension/upload-post-accounts/[id] | Update name |
| DELETE | /api/extension/upload-post-accounts/[id] | Delete account |
| POST | /api/extension/upload-post-accounts/[id]/connect-url | Get JWT URL (cached if >24h valid) |

### Posting Methods
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/extension/upload-post/proxy | Proxy multipart upload. Add `account_id` and `endpoint` (photos\|video) to form |
| POST | /api/extension/social-post/upload | Proxy JSON upload (video/photo/text) through backend |

---

## Posting Flow

### Cloud Proxy
1. Extension builds a JSON payload with `postType`, `platform`, `title`, `description`, `profile_username`, and media URLs
2. POSTs to `POST /api/extension/social-post/upload`
3. Backend resolves account ownership, injects the master API key, forwards to Upload-Post
4. The API key never leaves the server

---

## Connect Flow (JWT)

1. User creates upload-post account via `POST /api/extension/upload-post-accounts` (optional `api_key` for BYOK)
2. User requests connect URL: `POST /api/extension/upload-post-accounts/[id]/connect-url`
3. Backend returns cached JWT if valid (>24h remaining), else calls Upload-Post `generate-jwt`, caches, returns `access_url`
4. User opens URL, connects Instagram/TikTok/etc. via OAuth
5. JWT expires in 48h; cron refreshes daily at 00:05 UTC

---

## Whop Webhooks

When `payment.succeeded` fires, map the product to:
- `shotstack_credits`: add credits to `users.shotstack_credits`
- `max_upload_post_accounts`: set `users.max_upload_post_accounts`

Look up user by `whop_user_id` from payment metadata.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| SHOTSTACK_STAGING_API_KEY | Sandbox key (watermarked) |
| SHOTSTACK_API_KEY | Production key |
| UPLOAD_POST_API_KEY | Main key for managed accounts & proxy |
| NEXT_PUBLIC_APP_ORIGIN | Base URL for JWT redirect |
| CRON_SECRET | For Vercel cron (upload-post JWT refresh); set in Vercel dashboard |
