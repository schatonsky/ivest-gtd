import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Helpful, explicit message if the .env file is missing.
export const isConfigured = Boolean(url && anon);

const _client = isConfigured
  ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// ---------- read-only preview guard ----------
// When the principal is "viewing as" the other person, block every write so nothing
// can be changed by accident. Reads (select), auth, storage downloads and realtime
// are left untouched.
let __readOnly = false;
export function setReadOnly(v) { __readOnly = !!v; }
export function isReadOnly() { return __readOnly; }

function blockedResult() {
  // A chainable, awaitable stand-in that mimics a Supabase write result so callers
  // that do .insert().select().single() / .update().eq() etc. don't crash.
  const res = { data: null, error: { message: "Read-only preview — switch back to your own view to make changes.", code: "readonly" } };
  const p = Promise.resolve(res);
  ["select", "single", "maybeSingle", "eq", "in", "order", "limit", "match", "neq", "is"].forEach((m) => { p[m] = () => p; });
  return p;
}

if (_client) {
  const realFrom = _client.from.bind(_client);
  _client.from = (table) => {
    const qb = realFrom(table);
    if (!__readOnly) return qb;
    ["insert", "update", "delete", "upsert"].forEach((m) => {
      if (typeof qb[m] === "function") qb[m] = () => blockedResult();
    });
    return qb;
  };
  const realStorageFrom = _client.storage.from.bind(_client.storage);
  _client.storage.from = (bucket) => {
    const sb = realStorageFrom(bucket);
    if (!__readOnly) return sb;
    ["upload", "remove", "move", "copy"].forEach((m) => {
      if (typeof sb[m] === "function") sb[m] = () => Promise.resolve({ data: null, error: { message: "Read-only preview" } });
    });
    return sb;
  };
}

export const supabase = _client;
