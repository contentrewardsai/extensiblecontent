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
- GET/POST /api/extension/following, GET/PATCH/DELETE /api/extension/following/[id]
- GET /api/extension/sidebars, POST /api/extension/sidebars/register, POST /api/extension/sidebars/disconnect, GET/PATCH /api/extension/sidebars/[id]
- GET /api/extension/industries, GET /api/extension/platforms, GET /api/extension/monetization
- **Upload-Post accounts:** GET/POST /api/extension/upload-post-accounts, POST /api/extension/upload-post-accounts/repair, GET/PATCH/DELETE /api/extension/upload-post-accounts/[id], POST /api/extension/upload-post-accounts/[id]/connect-url
- **Upload-Post proxy:** POST /api/extension/upload-post/proxy
- **ShotStack:** POST /api/extension/shotstack/render, GET /api/extension/shotstack/status/[id], GET /api/extension/shotstack/renders, GET /api/extension/shotstack/credits
