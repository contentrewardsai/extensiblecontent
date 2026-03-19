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
| GET | /api/extension/shotstack/status/[id] | Check render status |
| GET | /api/extension/shotstack/credits | Get user's credits |

### Upload-Post Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/extension/upload-post-accounts | List user's accounts |
| POST | /api/extension/upload-post-accounts | Create account (name required) |
| GET | /api/extension/upload-post-accounts/[id] | Get one account |
| PATCH | /api/extension/upload-post-accounts/[id] | Update name |
| DELETE | /api/extension/upload-post-accounts/[id] | Delete account |
| POST | /api/extension/upload-post-accounts/[id]/connect-url | Get JWT URL for connecting social handles |

### Posting Methods
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/extension/upload-post-key | **Method A**: Return API key for extension direct posting (rotate key every few days) |
| POST | /api/extension/upload-post/proxy | **Method B**: Proxy multipart upload. Add `account_id` and `endpoint` (photos\|video) to form |

---

## Posting Flow

### Method A: Extension Direct Posting
1. Extension calls `GET /api/extension/upload-post-key` with Bearer token
2. Backend returns `UPLOAD_POST_EXTENSION_KEY` (or `UPLOAD_POST_API_KEY`)
3. Extension uses key to call Upload-Post API directly with `user` = account's `upload_post_username`
4. **Risk**: Key is in extension; rotate `UPLOAD_POST_EXTENSION_KEY` every few days

### Method B: Cloud Proxy
1. Extension builds FormData like Upload-Post API (photos[], platform[], title, etc.)
2. Adds `account_id` (our upload_post_accounts.id) and `endpoint` (photos | video)
3. POSTs to `POST /api/extension/upload-post/proxy`
4. Backend verifies ownership, injects `user` = upload_post_username, forwards to Upload-Post

---

## Connect Flow (JWT)

1. User creates upload-post account via `POST /api/extension/upload-post-accounts`
2. User requests connect URL: `POST /api/extension/upload-post-accounts/[id]/connect-url`
3. Backend calls Upload-Post `generate-jwt`, returns `access_url`
4. User opens URL, connects Instagram/TikTok/etc. via OAuth
5. After 48h, JWT expires; user can request a new connect URL if needed

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
| UPLOAD_POST_EXTENSION_KEY | Optional: key for extension (rotate frequently) |
| NEXT_PUBLIC_APP_ORIGIN | Base URL for JWT redirect |
