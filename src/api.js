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
  const { data } = await supabase.from("projects").select("*")
    .order("sort_order", { ascending: true, nullsFirst: false }).order("name");
  return data || [];
}
export async function updateProjectOrder(id, order) {
  return supabase.from("projects").update({ sort_order: order }).eq("id", id);
}

// ---------- locations ----------
export async function listLocations() {
  const { data } = await supabase.from("locations").select("*")
    .order("sort_order", { ascending: true, nullsFirst: false }).order("name");
  return data || [];
}
export async function createLocation(name) {
  return supabase.from("locations").insert({ name }).select().single();
}
export async function updateLocation(id, fields) {
  return supabase.from("locations").update(fields).eq("id", id);
}
export async function deleteLocation(id) {
  return supabase.from("locations").delete().eq("id", id);
}
export async function updateLocationOrder(id, order) {
  return supabase.from("locations").update({ sort_order: order }).eq("id", id);
}
export async function updateContactOrder(id, order) {
  return supabase.from("contacts").update({ sort_order: order }).eq("id", id);
}
export async function listContacts() {
  const { data } = await supabase.from("contacts").select("*")
    .order("sort_order", { ascending: true, nullsFirst: false }).order("name");
  return data || [];
}
export async function createContact(name, email) {
  return supabase.from("contacts").insert({ name, email: email || null }).select().single();
}
export async function updateContact(id, fields) {
  return supabase.from("contacts").update(fields).eq("id", id);
}
export async function deleteContact(id) {
  // action_items.contact_id is ON DELETE SET NULL — items are kept, just untagged
  return supabase.from("contacts").delete().eq("id", id);
}
export async function createProject(name, color) {
  return supabase.from("projects").insert({ name, color }).select().single();
}
export async function renameProject(id, name) {
  return supabase.from("projects").update({ name }).eq("id", id);
}
export async function deleteProject(id) {
  // action_items.project_id is ON DELETE SET NULL — items are kept, just unassigned
  return supabase.from("projects").delete().eq("id", id);
}

// ---------- items ----------
export async function listItems() {
  const { data } = await supabase.from("action_items")
    .select("*, action_contacts(contact_id), action_locations(location_id)")
    .order("updated_at", { ascending: false });
  return (data || []).map((it) => ({
    ...it,
    contact_ids: (it.action_contacts || []).map((r) => r.contact_id),
    location_ids: (it.action_locations || []).map((r) => r.location_id),
  }));
}
export async function setItemContacts(itemId, ids) {
  // Diff-based so we only touch links that actually change — a blanket delete+insert
  // would briefly remove kept links and trip the "no open actions" auto-prune trigger.
  const want = ids || [];
  const { data } = await supabase.from("action_contacts").select("contact_id").eq("action_item_id", itemId);
  const cur = (data || []).map((r) => r.contact_id);
  const toAdd = want.filter((id) => !cur.includes(id));
  const toRemove = cur.filter((id) => !want.includes(id));
  if (toRemove.length) await supabase.from("action_contacts").delete().eq("action_item_id", itemId).in("contact_id", toRemove);
  if (toAdd.length) await supabase.from("action_contacts").insert(toAdd.map((cid) => ({ action_item_id: itemId, contact_id: cid })));
}
export async function setItemLocations(itemId, ids) {
  await supabase.from("action_locations").delete().eq("action_item_id", itemId);
  if (ids && ids.length) await supabase.from("action_locations").insert(ids.map((lid) => ({ action_item_id: itemId, location_id: lid })));
}
export async function listComments() {
  const { data } = await supabase.from("comments").select("*").order("created_at");
  return data || [];
}
export async function listActivity() {
  const { data } = await supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(500);
  return data || [];
}

// ---------- reactions (emoji on conversation messages) ----------
export async function listReactions() {
  const { data } = await supabase.from("comment_reactions").select("*");
  return data || [];
}
export async function toggleReaction(commentId, userKey, emoji) {
  const { data } = await supabase.from("comment_reactions")
    .select("comment_id").eq("comment_id", commentId).eq("user_key", userKey).eq("emoji", emoji).maybeSingle();
  if (data) {
    return supabase.from("comment_reactions").delete()
      .eq("comment_id", commentId).eq("user_key", userKey).eq("emoji", emoji);
  }
  return supabase.from("comment_reactions").insert({ comment_id: commentId, user_key: userKey, emoji });
}

export async function updateItem(id, fields) {
  return supabase.from("action_items").update(fields).eq("id", id);
}

export async function deleteItem(id) {
  // comments + activity_log are removed automatically via ON DELETE CASCADE
  return supabase.from("action_items").delete().eq("id", id);
}

export async function createItem(fields, actorKey) {
  const { contact_ids = [], location_ids = [], ...base } = fields;
  const { data, error } = await supabase.from("action_items")
    .insert({ ...base, source: "manual", status: "open" })
    .select().single();
  if (error || !data) return { data, error };
  await setItemContacts(data.id, contact_ids);
  await setItemLocations(data.id, location_ids);
  await logActivity(data.id, actorKey, "Created manually");
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
export async function updateComment(id, body) {
  return supabase.from("comments").update({ body, edited_at: new Date().toISOString() }).eq("id", id);
}

// ---------- comment read-state (per user, per item) ----------
export async function listCommentReads() {
  const { data } = await supabase.from("comment_reads").select("*");
  return data || [];
}
export async function markItemSeen(userKey, itemId) {
  return supabase.from("comment_reads")
    .upsert({ user_key: userKey, action_item_id: itemId, last_seen_at: new Date().toISOString() }, { onConflict: "user_key,action_item_id" });
}

// ---------- general chat (questions not tied to an action) ----------
export async function listGeneralMessages() {
  const { data } = await supabase.from("general_messages").select("*").order("created_at");
  return data || [];
}
export async function sendGeneralMessage(author, body) {
  return supabase.from("general_messages").insert({ author, body });
}
export async function listChatReads() {
  const { data } = await supabase.from("chat_reads").select("*");
  return data || [];
}
export async function markChatSeen(userKey) {
  return supabase.from("chat_reads")
    .upsert({ user_key: userKey, last_seen_at: new Date().toISOString() }, { onConflict: "user_key" });
}

// Ask a question → store comment, remember where to resume, route it to the OTHER person.
// Nicole asking → awaiting_principal (to Stephane); Stephane asking → follow_up (to Nicole).
export async function askQuestion(item, body, actor, askerIsPrincipal) {
  const target = askerIsPrincipal ? "follow_up" : "awaiting_principal";
  await addComment(item.id, actor, body, "question");
  await supabase.from("action_items")
    .update({ status: target, return_status: item.status })
    .eq("id", item.id);
  await logActivity(item.id, actor, "Question raised");
}

// Answer → store answer, resume the remembered state.
export async function submitAnswer(item, body, actor) {
  const back = item.return_status || "in_progress";
  await addComment(item.id, actor, body, "answer");
  await supabase.from("action_items")
    .update({ status: back, return_status: null })
    .eq("id", item.id);
  await logActivity(item.id, actor, "Question answered");
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

// ---------- private notes (Principal only; RLS-protected) ----------
export async function getPrivateNote(itemId) {
  const { data } = await supabase.from("private_notes").select("body").eq("action_item_id", itemId).maybeSingle();
  return data ? data.body : "";
}
export async function savePrivateNote(itemId, body) {
  return supabase.from("private_notes")
    .upsert({ action_item_id: itemId, body, updated_at: new Date().toISOString() }, { onConflict: "action_item_id" });
}

// ---------- private note attachments (Storage bucket "note-files", principal-only) ----------
export async function listNoteFiles(itemId) {
  const { data } = await supabase.from("private_note_files").select("*").eq("action_item_id", itemId).order("uploaded_at");
  return data || [];
}
export async function uploadNoteFile(itemId, file) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${itemId}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from("note-files").upload(path, file, { upsert: false });
  if (up.error) return { error: up.error };
  const { error } = await supabase.from("private_note_files").insert({ action_item_id: itemId, file_name: file.name, storage_path: path });
  return { error };
}
export async function noteFileUrl(path, download) {
  // download = filename → signed URL serves with Content-Disposition: attachment (forces a download)
  const opts = download ? { download } : undefined;
  const { data } = await supabase.storage.from("note-files").createSignedUrl(path, 3600, opts);
  return data ? data.signedUrl : null;
}
export async function deleteNoteFile(f) {
  await supabase.storage.from("note-files").remove([f.storage_path]);
  return supabase.from("private_note_files").delete().eq("id", f.id);
}

// ---------- private links (Principal only; RLS-protected) ----------
export async function listPrivateLinks(itemId) {
  const { data } = await supabase.from("private_links").select("*").eq("action_item_id", itemId).order("created_at");
  return data || [];
}
export async function addPrivateLink(itemId, url, label) {
  return supabase.from("private_links").insert({ action_item_id: itemId, url, label: label || null });
}
export async function deletePrivateLink(id) {
  return supabase.from("private_links").delete().eq("id", id);
}

// ---------- access / audit log ----------
export async function startSession(userKey) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
  if (!id) return null;
  await supabase.from("access_log").insert({ id, user_key: userKey });
  return id;
}
export async function touchSession(id) {
  if (!id) return;
  return supabase.from("access_log").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
}
export async function listSessions() {
  const { data } = await supabase.from("access_log").select("*").order("started_at", { ascending: false }).limit(100);
  return data || [];
}

// ---------- realtime ----------
// Fires `onChange` whenever any tracked table changes, so the UI can refetch.
export function subscribe(onChange) {
  const ch = supabase.channel("gtd-live");
  ["action_items", "comments", "activity_log", "projects", "profiles", "locations", "action_contacts", "action_locations", "comment_reactions", "comment_reads", "general_messages", "chat_reads"].forEach((table) => {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  });
  ch.subscribe();
  return () => supabase.removeChannel(ch);
}
