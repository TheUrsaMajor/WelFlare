# WelFlare

WelFlare is a community donation coordination app. The interface is a runnable preview; real accounts, saved donations, private NGO documents and review decisions require connecting a Supabase project as described below.

## Run the preview

1. Install [Node.js](https://nodejs.org/) if it is not installed.
2. Open this folder in a terminal.
3. Run `npm install`, then `npm run dev`.
4. Open the local web address printed in the terminal.

You can browse the sample community feed without credentials. Sample listings and statistics are example content, not live donations or verified organizations. Creating a donation in preview mode only updates the browser session.

## Connect real sign-in and storage

1. Create a Supabase project.
2. In Supabase, run [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) in the SQL Editor.
3. Copy `.env.example` to `.env.local`. Add the Supabase project URL and the **publishable/anon** key. Never put the service-role key in a `VITE_` variable.
4. Configure Google OAuth in Supabase Authentication → Providers → Google and add the Supabase callback URL to your Google OAuth client.
5. Deploy the Edge Functions listed in `supabase/config.toml`. They handle donation photos, NGO submissions and admin review, and volunteer pickup flows. Keep JWT verification enabled. Set `DATA_ENCRYPTION_KEY` and `APP_ORIGIN` as function secrets before accepting real applications. Generate a private 32-byte key (64 hexadecimal characters) and store it only in Supabase secrets; do not paste it into this repository or a `VITE_` variable.
6. Restart the development server after editing environment variables.

Password sign-in is handled by Supabase Auth. Google credentials are handled by Google and Supabase OAuth. This app never asks for a Google password.

## Publish the website with GitHub and Vercel

The project is a Vite app. Import its GitHub repository into Vercel using the **Vite** framework preset. Use `npm run build` as the build command and `dist` as the output directory. Vercel normally detects these settings automatically.

In the Vercel project’s **Settings → Environment Variables**, add these two values for Production, Preview, and Development:

- `VITE_SUPABASE_URL`: the project URL from Supabase.
- `VITE_SUPABASE_ANON_KEY`: the Supabase publishable key (or anon/public key).

The publishable key is expected in browser code and must be protected by the database’s Row Level Security policies. Never add a Supabase secret/service-role key, `DATA_ENCRYPTION_KEY`, or bank/document secrets to Vercel variables that begin with `VITE_`. Set **Production** and **Preview** values only for the exact site domains you intend to use.

After the first Vercel deployment, copy its production domain (for example, `https://your-project.vercel.app`). In Supabase **Authentication → URL Configuration**, set the Site URL to that production domain and allow the exact production callback, such as `https://your-project.vercel.app/**`. Keep `http://127.0.0.1:5173/**` in the redirect allowlist for local development. Add a separate preview URL only if you need sign-in on preview deployments; avoid allowing every `*.vercel.app` site.

The Edge Functions use an exact `APP_ORIGIN` for browser requests. Set it to the production site origin (no trailing slash) for the hosted website. If you need both local and production origins at the same time, add explicit origin-list support to the Edge Functions before configuring them; do not use a wildcard origin. After changing function secrets, verify the live app’s donation and organization flows.

## Organization verification

NGO DARPAN is treated as a record to check, not as a live API or a government endorsement. For the hackathon MVP, applicants submit DARPAN details and documents for human review. Statuses are `pending_verification`, `under_review`, `verified`, `rejected` and `suspended`. Only verified organizations with the matching donation type and current required documents can be recipients. FCRA is separate: domestic donations do not require FCRA; foreign-contribution eligibility needs its own review.

The database migration separates public organization fields from encrypted identification and bank information. Private files use a non-public Storage bucket. The service-role key must remain server-side. To grant admin access, first create the admin's account, then use the Supabase SQL Editor to add that account to `private.platform_admins` and grant the `ADMIN` role in `public.user_roles`. Never expose admin setup in the browser. Every review action records its administrator, time, decision and reason. DARPAN and financial documents are queued for human review; no government API is faked. Bank ownership is a manual review in this hackathon version. Only after review and current required documents can an organization receive matching donations.

The code and preview are ready, but real sign-in, uploads, persistent records and review decisions remain disabled until you connect your own Supabase project and deploy these server functions. For a hackathon demo, use fictional/sample personal data and review the security setup before collecting real identity or bank details.

## Current MVP boundaries

- The two donation categories are food and other items. Every new listing requires a photo.
- Food listings require a future best-before time and the food handling acknowledgement. Expired food is excluded on the server and rechecked when a pickup is claimed.
- The preview includes sample listings, metrics and organization cards to show the layout.
- The verification form and admin review screen are interface previews; they do not approve or reject organizations. Never advertise a preview profile as actually verified.
- Monetary donations, payments, live maps, volunteer routing and push notifications are not enabled.

## Design direction

The dashboard takes layout cues from the attached restaurant POS screenshots: compact left navigation, category controls, image-led tiles and a clear right-sized interface. WelFlare uses a quieter green palette and community-focused language. User uploads are required on the donation form; NGO records and donation photos have separate storage rules.
