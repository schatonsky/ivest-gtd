// ============================================================
// Interactive GTD — Gmail ingestion (Supabase Edge Function)
// STATUS: scaffold. The structure, dedupe, and DB insert are real;
// the Gmail fetch is marked TODO and needs Google OAuth wiring.
//
// What it will do once Gmail is connected:
//   1. Read Stephane's messages that carry the Gmail label "GTD".
//   2. For each NEW message (not seen before), create an action_item
//      with the ORIGINAL EMAIL ATTACHED (from, subject, date, body, link).
//   3. Skip anything already imported (dedupe on Gmail message id).
//
// Deploy:   supabase functions deploy gmail-ingest --no-verify-jwt
// Schedule: run every few minutes via Supabase Scheduled Functions / cron.
// Secrets:  supabase secrets set GMAIL_LABEL=GTD GMAIL_USER=stephane@chatonsky.com \
//           GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Service-role client (server-side only — bypasses RLS to insert items).
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GMAIL_LABEL = Deno.env.get("GMAIL_LABEL") ?? "GTD";

interface ParsedEmail {
  gmailId: string;
  threadUrl: string;
  from: string;
  subject: string;
  date: string;       // ISO timestamp
  body: string;       // plain-text body
  contactEmail?: string; // a non-Stephane / non-Nicole address on the thread, if any
}

// ---- TODO: implement with the Gmail API ----
// Use users.messages.list?q=label:GTD then users.messages.get for each id.
// Decode the base64url body, pull headers (From/Subject/Date), and build the
// thread deep link: https://mail.google.com/mail/u/0/#all/<threadId>
async function fetchLabelledEmails(): Promise<ParsedEmail[]> {
  // const accessToken = await getAccessTokenFromRefreshToken();
  // ... call Gmail REST API here ...
  console.log(`[gmail-ingest] STUB: would fetch messages with label "${GMAIL_LABEL}"`);
  return []; // returns [] until Gmail is wired up
}

async function alreadyImported(gmailId: string): Promise<boolean> {
  const { data } = await supabase
    .from("action_items").select("id").eq("source_email_id", gmailId).maybeSingle();
  return Boolean(data);
}

// Find or create a contact for the external party on the email.
async function resolveContact(email?: string): Promise<string | null> {
  if (!email) return null;
  const { data: existing } = await supabase
    .from("contacts").select("id").eq("email", email).maybeSingle();
  if (existing) return existing.id;
  const name = email.split("@")[0].replace(/[._]/g, " ");
  const { data } = await supabase.from("contacts").insert({ name, email }).select("id").single();
  return data?.id ?? null;
}

async function createItemFromEmail(e: ParsedEmail) {
  const contactId = await resolveContact(e.contactEmail);
  const { error } = await supabase.from("action_items").insert({
    title: e.subject || "(no subject)",
    description: e.body,            // the instruction text
    status: "open",
    source: "email",
    source_email_id: e.gmailId,     // dedupe key (unique)
    source_email_url: e.threadUrl,
    email_from: e.from,             // ← original email attached
    email_subject: e.subject,
    email_date: e.date,
    email_body: e.body,
    contact_id: contactId,
    created_by: "stephane",
    assigned_to: "nicole",
  });
  if (error && error.code !== "23505") throw error; // ignore unique-violation races
  await supabase.from("activity_log").insert({
    actor: "system", change: "Created from GTD-labelled email",
  });
}

Deno.serve(async () => {
  try {
    const emails = await fetchLabelledEmails();
    let created = 0;
    for (const e of emails) {
      if (await alreadyImported(e.gmailId)) continue;
      await createItemFromEmail(e);
      created++;
    }
    return new Response(JSON.stringify({ ok: true, scanned: emails.length, created }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
