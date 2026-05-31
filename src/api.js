import { supabase } from "./supabaseClient.js";

// ---------- profiles / auth ----------
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data || null;
}

export async function listProfiles() {
  const { data } = await supabase.from("profiles").select("*");
  return data || [];
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
export async function signOut() {
  return supabase.auth.signOut();
}

// ---------- reference data ----------
export async function listProjects() {
  const { data } = await supabase.from("projects").select("*").order("created_at");
  return data || [];
}
export async function listContacts() {
  const { data } = await supabase.from("contacts").select("*").order("name");
  return data || [];
}
export async function createProject(name, color) {
  return supabase.from("projects").insert({ name, color }).select().single();
}
export async function renameProject(id, name) {
  return supabase.from("projects").update({ name }).eq("id", id);
}

// ---------- items ----------
export async function listItems() {
  const { data } = await supabase.from("action_items").select("*").order("updated_at", { ascending: false });
  return data || [];
}
export async function listComments() {
  const { data } = await supabase.from("comments").select("*").order("created_at");
  return data || [];
}
export async function listActivity() {
  const { data } = await supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(60);
  return data || [];
}

export async function updateItem(id, fields) {
  return supabase.from("action_items").update(fields).eq("id", id);
}

export async function createItem(fields, actorKey) {
  const { data, error } = await supabase.from("action_items")
    .insert({ ...fields, source: "manual", status: "open" })
    .select().single();
  if (!error && data) await logActivity(data.id, actorKey, "Created manually");
  return { data, error };
}

export async function setStatus(item, to, changeText, actorKey, extra = {}) {
  const patch = { status: to, ...extra };
  const { error } = await supabase.from("action_items").update(patch).eq("id", item.id);
  if (!error) await logActivity(item.id, actorKey, changeText);
  return { error };
}

export async function addComment(itemId, author, body, type = "comment") {
  return supabase.from("comments").insert({ action_item_id: itemId, author, body, type });
}

// Nicole asks a question → store comment, remember where to resume, block on principal.
export async function askQuestion(item, body) {
  await addComment(item.id, "nicole", body, "question");
  await supabase.from("action_items")
    .update({ status: "awaiting_principal", return_status: item.status })
    .eq("id", item.id);
  await logActivity(item.id, "nicole", "Question raised");
}

// Stephane answers → store answer, resume the remembered state.
export async function submitAnswer(item, body) {
  const back = item.return_status || "in_progress";
  await addComment(item.id, "stephane", body, "answer");
  await supabase.from("action_items")
    .update({ status: back, return_status: null })
    .eq("id", item.id);
  await logActivity(item.id, "stephane", "Question answered");
}

export async function requestFollowup(item, note, actorKey) {
  if (note && note.trim()) await addComment(item.id, actorKey, note.trim(), "comment");
  await supabase.from("action_items").update({ status: "follow_up" }).eq("id", item.id);
  await logActivity(item.id, actorKey, "Follow-up requested");
}

export async function logActivity(itemId, actor, change) {
  return supabase.from("activity_log").insert({ action_item_id: itemId, actor, change });
}

// ---------- profile photo (Supabase Storage: bucket "avatars") ----------
export async function uploadAvatar(profile, file) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${profile.user_key}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (up.error) return { error: up.error };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error } = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", profile.id);
  return { error, url: data.publicUrl };
}
export async function removeAvatar(profile) {
  return supabase.from("profiles").update({ avatar_url: null }).eq("id", profile.id);
}

// ---------- realtime ----------
// Fires `onChange` whenever any tracked table changes, so the UI can refetch.
export function subscribe(onChange) {
  const ch = supabase.channel("gtd-live");
  ["action_items", "comments", "activity_log", "projects", "profiles"].forEach((table) => {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  });
  ch.subscribe();
  return () => supabase.removeChannel(ch);
}
