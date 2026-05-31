# Interactive GTD — Stage 1

A shared action-item platform for **Stephane** (Principal) and **Nicole** (Assistant).
Stephane delegates work; Nicole works it; questions and reviews flow back and forth;
Stephane closes items. Built with **React (Vite)** on the front end and **Supabase**
(Postgres + Auth + Realtime + Storage) on the back end.

---

## What's in here

```
gtd-app/
├─ src/                     React app (single-page)
│  ├─ App.jsx               all screens + lifecycle logic
│  ├─ api.js                Supabase data layer + realtime
│  ├─ supabaseClient.js     reads your .env keys
│  ├─ model.js              states, helpers, icons
│  └─ theme.css             light + dark styling
├─ supabase/
│  ├─ schema.sql            tables, security rules, triggers, realtime
│  ├─ seed.sql              optional sample data
│  └─ functions/gmail-ingest/index.ts   Gmail "GTD label" import (scaffold)
├─ .env.example             template for your Supabase keys
└─ package.json
```

---

## Setup (about 15–20 minutes)

You'll create a free Supabase project and paste two keys into a `.env` file. None of
this requires a credit card. If any step feels unfamiliar, a developer can run through
it quickly — but it's written to be followable on your own.

### 1. Create the Supabase project
1. Go to **https://supabase.com** → sign in → **New project**.
2. Pick a name (e.g. `interactive-gtd`), set a database password (save it), choose a region near Australia, and create it.
3. Wait ~2 minutes for it to finish provisioning.

### 2. Create the database
1. In the project, open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/schema.sql` and click **Run**.
3. (Optional) To load the demo board, open another query, paste `supabase/seed.sql`, and **Run**.

### 3. Create the storage bucket for profile photos
1. Open **Storage** → **New bucket**.
2. Name it exactly `avatars`, tick **Public bucket**, and create it.

### 4. Restrict who can sign in
1. Open **Authentication → Providers → Email** and make sure Email is enabled. Turn **Confirm email** off for the two internal accounts (simpler for Stage 1), or leave on and confirm via the links.
2. Open **Authentication → Users → Add user** and create the two accounts with a password each:
   - `stephane@chatonsky.com`  → becomes the **Principal** automatically
   - Nicole's `…@ivest.com.au` address → becomes the **Assistant** automatically
   (The role is assigned by a database trigger based on the email — no manual step.)
3. (Recommended) Under **Authentication → Sign In / Providers**, disable public sign-ups so only invited users exist, and add an allow-list / domain restriction for `ivest.com.au` plus `stephane@chatonsky.com`.

### 5. Connect the app to Supabase
1. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
2. In this folder, copy `.env.example` to `.env` and paste both values:
   ```
   VITE_SUPABASE_URL=https://YOUR-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

### 6. Run it
```bash
npm install
npm run dev
```
Open the printed URL (usually http://localhost:5173) and sign in as either user.
Toggle **Dark/Light** in the top bar; set profile photos under **Profiles**.

### 7. Deploy (optional, when ready to share online)
- Push this folder to GitHub and import it into **Vercel** or **Netlify**.
- Add the same two `VITE_…` environment variables in the host's project settings.
- Build command `npm run build`, output directory `dist`.

---

## How the lifecycle works
`Open → In Progress → (Awaiting Principal ↔ answer) → Done–Pending Review → Closed`,
with `Follow-up Required` sending an item back to Nicole. Each state has a single
"owner of the moment", shown on the dashboard. Only the Principal can close an item
(enforced in the database).

## Original emails are attached
When an item comes from email, the **original email** (sender, subject, date, full body,
and a link back to the Gmail thread) is attached and shown on the item detail — not just
referenced. Manually-created items simply omit that card.

## Gmail "GTD label" intake (next step)
`supabase/functions/gmail-ingest/index.ts` is a working skeleton: it already de-duplicates
and inserts items with the original email attached. The only missing piece is the Gmail
API call (marked `TODO`), which needs a Google Cloud OAuth client. To finish it:
1. Create a Google Cloud project, enable the Gmail API, and make an OAuth client; get a refresh token for Stephane's mailbox with the `gmail.readonly` scope.
2. `supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=… GMAIL_LABEL=GTD`
3. `supabase functions deploy gmail-ingest` and schedule it to run every few minutes.
Until then, create items manually with **New Item** — everything else is fully working.

## Notes
- Stage 1 notifications are **in-app only** (the dashboard surfaces what's waiting on you).
- Data syncs live between the two users via Supabase Realtime — no refresh needed.
- To clear sample data, run the DELETEs at the bottom of `seed.sql`.
