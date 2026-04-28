This is a template for a whop app built in NextJS. Fork it and keep the parts you need for your app.

# Whop NextJS App Template

To run this project:

1. Install dependencies with: `pnpm i`

2. Create a Whop App on your [whop developer dashboard](https://whop.com/dashboard/developer/), then go to the "Hosting" section and:
	- Ensure the "Base URL" is set to the domain you intend to deploy the site on.
	- Ensure the "App path" is set to `/experiences/[experienceId]`
	- Ensure the "Dashboard path" is set to `/dashboard/[companyId]`
	- Ensure the "Discover path" is set to `/discover`

3. Create a `.env.local` file with your environment variables. Get real values from:
	- **Whop**: [Whop developer dashboard](https://whop.com/dashboard/developer/) → your app → Hosting
	- **Supabase**: [Supabase dashboard](https://supabase.com/dashboard) → your project → Settings → API (Project URL, `anon` key, and `service_role` key for extension auth)
	- **GoHighLevel**: [GHL Marketplace](https://marketplace.gohighlevel.com/) → your app → Manage → Secrets (Client ID & Client Secret)
	- Copy `.env.example` as a template and fill in the values.
	- For the Chrome extension: add `WHOP_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.

4. Go to a whop created in the same org as the app you created. Navigate to the tools section and add your app.

5. Run `pnpm dev` to start the dev server. Then in the top right of the window find a translucent settings icon. Select "localhost". The default port 3000 should work.

## Deploying

1. Upload your fork / copy of this template to github.

2. Go to [Vercel](https://vercel.com/new) and link the repository. Add the same environment variables from your `.env.local` in Project → Settings → Environment Variables (Whop and Supabase keys for Production, Preview, and Development as needed).

3. If necessary update your "Base Domain" and webhook callback urls on the app settings page on the whop dashboard.

## Chrome Extension

The `extension/` folder contains a Chrome extension that connects to this Whop app via OAuth.

### Setup

1. **Whop OAuth**: In the [Whop developer dashboard](https://whop.com/dashboard/developer/) → your app → OAuth, add these redirect URIs:
	- `http://localhost:3000/extension/login` (development)
	- `https://your-production-domain.com/extension/login` (production)
	- `https://your-production-domain.com/api/ghl/connect-whop/callback` (GHL → Whop linking)

2. **Supabase migration**: Link your project (one-time) then run migrations:
	```bash
	supabase link --project-ref <your-project-ref>
	pnpm db:migrate
	```
	Or apply `supabase/migrations/20250318000000_create_users_table.sql` manually in the Supabase SQL editor.

3. **Load the extension**: In Chrome, go to `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the `extension/` folder.

4. **Production**: Update `extension/manifest.json` `host_permissions` and `externally_connectable` with your production domain. Update `extension/popup.js` and `extension/background.js` `getAppOrigin()` to return your production URL when not in development.

## Troubleshooting

**App not loading properly?** Make sure to set the "App path" in your Whop developer dashboard. The placeholder text in the UI does not mean it's set - you must explicitly enter `/experiences/[experienceId]` (or your chosen path name)
a

**Make sure to add .env.local** Get real values from the Whop dashboard, Supabase dashboard, and GHL Marketplace, then set them in `.env.local`. Never commit `.env.local` or `.env.development`—they are gitignored.

## GoHighLevel Integration

The app integrates with GoHighLevel via a Marketplace App for media library and social planner access.

### Required Environment Variables

| Variable | Source |
|---|---|
| `GHL_CLIENT_ID` | GHL Marketplace → Manage → Secrets → Client Keys |
| `GHL_CLIENT_SECRET` | Generated alongside Client ID (copy immediately, shown once) |
| `GHL_REDIRECT_URI` | Your OAuth callback, e.g. `https://your-domain.com/api/ghl/auth/callback` |
| `GHL_APP_VERSION_ID` | GHL Marketplace → your app → Versions tab → Live version row → 24-char hex id. Required by HighLevel's `/oauth/chooselocation` install URL since the rollout of app versioning; without it install fails with `error.noAppVersionIdFound`. |
| `GHL_API_BASE` | `https://services.leadconnectorhq.com` |
| `GHL_SHARED_SECRET` | GHL Marketplace → Manage → Secrets → Shared Secret Key |
| `GHL_EXT_AUTH_CLIENT_ID` | Self-generated (`openssl rand -hex 16`), entered in GHL External Auth config |
| `GHL_EXT_AUTH_CLIENT_SECRET` | Self-generated (`openssl rand -hex 32`), entered in GHL External Auth config |
| `GHL_EXT_AUTH_REDIRECT_URI` | GHL's External Auth callback URL (provided by GHL in the form) |

### GHL Marketplace App Setup

1. Create a Private app at [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com)
2. Target User: Sub-Account, Who Can Install: Both Agency & Sub-Account
3. Add scopes: `medias.readonly`, `medias.write`, `socialplanner/post.readonly`, `socialplanner/post.write`, `socialplanner/account.readonly`, `oauth.readonly`, `oauth.write`
4. Set Redirect URL to `GHL_REDIRECT_URI`
5. Set Webhook URL to `https://your-domain.com/api/ghl/webhooks`
6. Generate Client Keys and store in `.env.local`

For more info, see our docs at https://dev.whop.com/introduction
