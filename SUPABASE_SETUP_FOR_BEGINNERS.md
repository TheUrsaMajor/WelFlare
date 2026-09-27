# WelFlare + Supabase: beginner setup

This guide connects the WelFlare website to a Supabase project. Take it one section at a time. You do not need to understand SQL; you will copy the provided migration file into Supabase using the CLI.

## Before you start

You need:

- A Supabase account.
- Node.js 20 or newer. (WelFlare already runs with Node installed.)
- The WelFlare folder on your computer: `C:\Users\prsru\OneDrive\Desktop\WelFlare`.
- A Google account only if you want Google sign-in enabled.

Keep this distinction in mind:

- **Publishable / anon key:** goes into the local website settings. It is designed for browser use.
- **Secret / service-role key:** gives powerful server access. Never paste it into a website setting, chat, screenshot, or file beginning with `VITE_`.
- **Database password:** the password you choose when creating the Supabase project. It is different from your Supabase account password.

## 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. Click **New project**. If asked, choose or create an organization.
3. Enter a project name, for example `welflare-hackathon`.
4. Create a strong **Database password**. Save it in a password manager. You will need it once when linking the project.
5. Choose a region close to your users, such as Mumbai if it is offered.
6. Click **Create new project** and wait for the project to finish setting up.

## 2. Copy your project reference

1. Open your project in the Supabase dashboard.
2. Look at the browser address. It will look like `https://supabase.com/dashboard/project/abcdefghijklmnop`.
3. Copy only the final part after `/project/`. That is your **project reference**. You will use it in Step 4.

## 3. Open PowerShell in the WelFlare folder

1. Open File Explorer and go to `C:\Users\prsru\OneDrive\Desktop\WelFlare`.
2. Click the address bar, type `powershell`, and press **Enter**. A PowerShell window should open in that folder.
3. Type `node --version` and press **Enter**. It should show version 20 or higher. If it does not, install the current LTS version from [nodejs.org](https://nodejs.org/), then reopen PowerShell.
4. Type `npm install` and press **Enter**. Wait until it finishes.
5. Type `npm install --save-dev supabase` and press **Enter**. This adds the Supabase command-line helper to this project.

## 4. Link this folder to your Supabase project and create the database tables

Run these commands one at a time in the same PowerShell window:

```powershell
npx supabase login
```

A browser opens. Sign in to Supabase and approve the CLI login. Return to PowerShell when it says you are logged in.

Now link WelFlare to your project. Replace the example text with the project reference you copied in Step 2:

```powershell
npx supabase link --project-ref YOUR_PROJECT_REFERENCE
```

For example, if your reference is `abcdefghijklmnop`, the command is `npx supabase link --project-ref abcdefghijklmnop`. When asked for the database password, enter the password you created in Step 1. PowerShell may not show dots or stars while you type; that is normal. Press **Enter** when done.

Apply the database setup from the project:

```powershell
npx supabase db push
```

If asked to confirm, read the prompt and type `Y`, then press **Enter**. This is for a new Supabase project with no WelFlare tables yet. It creates the app's tables, access rules, and private file storage. Do not run this against a project that already contains important data without getting help first.

## 5. Put the public connection settings in WelFlare

1. In the Supabase dashboard, open **Project Settings → API Keys** (or click **Connect** and find the API keys).
2. Copy the **Project URL**. It looks like `https://abcdefghijklmnop.supabase.co`.
3. Copy the **publishable** key if available, or the older **anon/public** key. Do not copy the secret/service-role key.
4. In File Explorer, open the WelFlare folder. Make a copy of `.env.example` and name the copy `.env.local`.
   - In Windows, turn on **View → Show → File name extensions** if you cannot tell whether the file is named `.env.local.txt`. The final name must be exactly `.env.local`.
5. Open `.env.local` in Notepad. Replace the two example values so it looks like this, using your own URL and key:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REFERENCE.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Do not add quotation marks. Do not add spaces around `=`. Keep the variable names exactly as shown, even if the key you copied is called a publishable key. Save and close Notepad. Do not send anyone the contents of this file.

## 6. Set the two private Edge Function settings

WelFlare's backend needs one encryption key to protect private NGO information and one browser address for upload permissions.

1. In PowerShell, generate a private encryption key by running:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Copy the resulting 64-character value. Treat it like a password. If you lose it, encrypted NGO application details cannot be decrypted. Do not put it in `.env.local`, the source code, or a public repository.
3. In the Supabase dashboard, open **Edge Functions → Secrets** (sometimes shown under **Project Settings → Edge Functions**).
4. Add a secret named `DATA_ENCRYPTION_KEY` and paste the generated value as its secret value.
5. Add a second secret named `APP_ORIGIN` with this value:

```text
http://127.0.0.1:5173
```

This is the local WelFlare address. If you later host the site at a real domain, change it to that exact address, including `https://`.

The Supabase project automatically provides the server-only Supabase keys to Edge Functions. You do not need to copy a service-role key into WelFlare.

## 7. Deploy WelFlare's eight backend functions

Back in PowerShell, run each command separately. Wait for each to finish before running the next one:

```powershell
npx supabase functions deploy create-donation
npx supabase functions deploy submit-ngo-application
npx supabase functions deploy review-organization
npx supabase functions deploy get-review-queue
npx supabase functions deploy request-pickup
npx supabase functions deploy advance-pickup
npx supabase functions deploy invite-volunteer
npx supabase functions deploy accept-volunteer-invitation
```

The project configuration keeps sign-in checks enabled for these functions. If a deployment asks whether to enable JWT verification, keep it enabled.

## 8. Turn on email sign-in

Email/password accounts are handled by Supabase Auth. In the Supabase dashboard:

1. Open **Authentication → Providers → Email**.
2. Make sure Email is enabled.
3. For a quick hackathon test, you may leave email confirmation enabled. After signing up, open the inbox and click Supabase's confirmation link before trying to sign in. (If you change confirmation settings, understand the security tradeoff before using real users.)

## 9. Optional: enable Google sign-in

Google sign-in needs setup in both Supabase and Google. Two different redirect addresses are involved: Google's address points back to Supabase; Supabase's address points back to WelFlare.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Open **Google Auth Platform** and configure the app name and audience. If the app is in testing mode, add your Google account under test users.
3. In its **Clients** section, create an OAuth client ID and choose **Web application**.
4. For **Authorized JavaScript origins**, add:

```text
http://127.0.0.1:5173
```

5. In Supabase, open **Authentication → Providers → Google**. Copy the callback URL displayed there. It looks like `https://YOUR_PROJECT_REFERENCE.supabase.co/auth/v1/callback`.
6. Return to the Google OAuth client and add that Supabase callback URL under **Authorized redirect URIs**. Save the client and copy its Client ID and Client Secret.
7. Return to Supabase **Authentication → Providers → Google**. Turn Google on, paste the Client ID and Client Secret into the matching fields, and save.
8. In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to `http://127.0.0.1:5173` and add `http://127.0.0.1:5173/**` to the allowed redirect URLs. You may also add `http://localhost:5173/**` if you sometimes use that address.

Never put Google's Client Secret in `.env.local` or in the website code. Supabase stores it as provider configuration.

## 10. Create your first administrator

Do this only for your own account. First create an account in WelFlare using an email address you control, then sign in once so Supabase creates that user. Next:

1. In Supabase, open **SQL Editor → New query**.
2. Replace `admin@example.com` in the query below with the exact email address you used in WelFlare.
3. Run the query. It gives that account administrator access; do not share this email or grant admin access to applicants.

```sql
insert into private.platform_admins (user_id)
select id from auth.users where lower(email) = lower('admin@example.com')
on conflict (user_id) do nothing;

insert into public.user_roles (user_id, role, granted_by)
select id, 'ADMIN', id from auth.users where lower(email) = lower('admin@example.com')
on conflict (user_id, role) do nothing;
```

## 11. Start WelFlare and check the connection

In PowerShell, make sure you are still in the WelFlare folder. Stop any old preview by pressing **Ctrl+C**, then run:

```powershell
npm run dev
```

Open the address Vite prints (usually `http://localhost:5173` or `http://127.0.0.1:5173`). Sign up with an email and password, confirm the email if asked, and sign in again. Try Google only after completing Step 9. A newly created account should now use Supabase; sample listings in the Preview feed are still example content.

## What should work after setup

- Email and Google authentication (Google only if configured).
- Server-checked donation creation, including the mandatory item photo.
- Private NGO application documents and encrypted identification/bank fields.
- Admin review and audit history after Step 10.
- Pickup requests and status updates.

NGO DARPAN checks are manual in this hackathon setup. A submitted application remains unverified until an administrator checks the information and reviews the documents. Domestic donations do not require FCRA. Do not enter real NGO PAN, bank details, or private documents in a hackathon deployment until you have reviewed access and hosting security.

## Common problems

- **`npx` is not recognized:** install Node.js 20 or newer, close PowerShell, open it again, then retry.
- **The project cannot be linked:** check the project reference copied from the Dashboard URL. It is not your project name or database password.
- **Database password rejected:** use the database password set when the Supabase project was created, not your Supabase website password. Reset it in project database settings if you have forgotten it.
- **App still shows Preview:** check that `.env.local` is in the same folder as `package.json`, the filename is exactly `.env.local`, and both values are correct. Stop and restart `npm run dev` after editing it.
- **Google says redirect URL mismatch:** check the two addresses in Step 9 carefully. Google must use Supabase's `/auth/v1/callback`; Supabase's allowed redirect list must include the local WelFlare URL.
- **Private NGO submission says service unavailable:** confirm the `DATA_ENCRYPTION_KEY` secret exists, is 64 hex characters, and that all Edge Functions were deployed after setting it.
- **Images or functions fail in the browser:** check `APP_ORIGIN` is exactly the address open in the browser. `localhost` and `127.0.0.1` are treated as different addresses.
