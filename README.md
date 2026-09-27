# WelFlare

WelFlare is a community donation coordination app for food and other useful goods. Accounts, listings, uploads, organization reviews and notification records are stored through Supabase.

## Run the preview

1. Install [Node.js](https://nodejs.org/) if it is not installed.
2. Open this folder in a terminal.
3. Run `npm install`, then `npm run dev`.
4. Open the local web address printed in the terminal.

The app starts with empty real-data screens; it does not invent donations, organizations or impact counts. Sign in to create listings or request a pickup.

## Connect real sign-in and storage

1. Create a Supabase project.
2. In Supabase, run [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql), then [`supabase/migrations/002_profiles_maps_notifications.sql`](supabase/migrations/002_profiles_maps_notifications.sql), in the SQL Editor.
3. Copy `.env.example` to `.env.local`. Add the Supabase project URL and the **publishable/anon** key. Never put the service-role key in a `VITE_` variable.
4. Configure Google OAuth in Supabase Authentication → Providers → Google and add the Supabase callback URL to your Google OAuth client.
5. Deploy the Edge Functions listed in `supabase/config.toml`. They handle donation photos, NGO submissions and admin review, and volunteer pickup flows. Keep JWT verification enabled. Set `DATA_ENCRYPTION_KEY` and `APP_ORIGIN` as function secrets before accepting real applications. Generate a private 32-byte key (64 hexadecimal characters) and store it only in Supabase secrets; do not paste it into this repository or a `VITE_` variable. Redeploy `create-donation` whenever you update its source.
6. Restart the development server after editing environment variables.

Password sign-in is handled by Supabase Auth. Google credentials are handled by Google and Supabase OAuth. This app never asks for a Google password.

## Publish the website with GitHub and Vercel

The project is a Vite app. Import its GitHub repository into Vercel using the **Vite** framework preset. Use `npm run build` as the build command and `dist` as the output directory. Vercel normally detects these settings automatically.

In the Vercel project’s **Settings → Environment Variables**, add these two values for Production, Preview, and Development:

- `VITE_SUPABASE_URL`: the project URL from Supabase.
- `VITE_SUPABASE_ANON_KEY`: the Supabase publishable key (or anon/public key).

The publishable key is expected in browser code and must be protected by the database’s Row Level Security policies. Never add a Supabase secret/service-role key, `DATA_ENCRYPTION_KEY`, or bank/document secrets to Vercel variables that begin with `VITE_`. Set **Production** and **Preview** values only for the exact site domains you intend to use.

After the first Vercel deployment, copy its production domain (for example, `https://your-project.vercel.app`). In Supabase **Authentication → URL Configuration**, set the Site URL to that production domain and allow the exact production callback, such as `https://your-project.vercel.app/**`. Keep `http://127.0.0.1:5173/**` in the redirect allowlist for local development. Add a separate preview URL only if you need sign-in on preview deployments; avoid allowing every `*.vercel.app` site.

The Edge Functions use an exact `APP_ORIGIN` for browser requests. Set it to the production site origin (no trailing slash) for the hosted website. If you need both local and production origins at the same time, add explicit origin-list support to the Edge Functions before configuring them; do not use a wildcard origin. After changing function secrets, verify the live app’s donation and organization flows. Google sign-in also requires valid Google OAuth credentials in Supabase; enabling the provider without client credentials is not enough.

## Organization verification

NGO DARPAN is treated as a record to check, not as a live API or a government endorsement. For the hackathon MVP, applicants submit DARPAN details and documents for human review. Statuses are `pending_verification`, `under_review`, `verified`, `rejected` and `suspended`. Only verified organizations with the matching donation type and current required documents can be recipients. FCRA is separate: domestic donations do not require FCRA; foreign-contribution eligibility needs its own review.

The database migration separates public organization fields from encrypted identification and bank information. Private files use a non-public Storage bucket. The service-role key must remain server-side. To grant admin access, first create the admin's account, then use the Supabase SQL Editor to add that account to `private.platform_admins` and grant the `ADMIN` role in `public.user_roles`. Never expose admin setup in the browser. Every review action records its administrator, time, decision and reason. DARPAN and financial documents are queued for human review; no government API is faked. Bank ownership is a manual review in this hackathon version. Only after review and current required documents can an organization receive matching donations.

The organization review process uses manual administrator checks. The public dashboard only shows organizations that passed review. Do not collect real NGO identity or bank details until access controls and hosting security have been reviewed.

## Current MVP boundaries

- The two donation categories are food and other items. Every new listing requires a photo.
- Food listings require a future best-before time and the food handling acknowledgement. Expired food is excluded on the server and rechecked when a pickup is claimed.
- Every new donation requires a photo. Pickup pins are rounded to three decimal places before storage; exact addresses should be shared directly only after a pickup is arranged.
- Maps use Leaflet and OpenStreetMap tiles with attribution. People can choose an approximate point on the map or allow their browser to share an approximate location. Browser geolocation requires the user's consent.
- Notifications are private in-app records, not push or email notifications.
- Monetary transfers, payment processing, automatic DARPAN checks and foreign-contribution transfers are not enabled.

## Design direction

The dashboard takes layout cues from the attached restaurant POS screenshots: compact left navigation, category controls, image-led tiles and a clear right-sized interface. WelFlare uses a quieter green palette and community-focused language. User uploads are required on the donation form; NGO records and donation photos have separate storage rules.
