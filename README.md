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

**Make sure to add .env.local** Get real values from the Whop dashboard and Supabase dashboard, then set them in `.env.local`. Never commit `.env.local` or `.env.development`—they are gitignored.


For more info, see our docs at https://dev.whop.com/introduction
