import { useEffect, useRef, useState } from "react";
import { supabase, isConfigured } from "./supabaseClient.js";
import { STATES, ownerOf, ago, I } from "./model.js";
import * as api from "./api.js";
import markUrl from "./assets/ivest-mark.png";
import logoUrl from "./assets/ivest-logo.png";

/* ============================================================
   Small shared helpers / components
   ============================================================ */
const DEFAULTS = {
  stephane: { name: "Stephane Chatonsky", initials: "SC", av: "av-stephane" },
  nicole:   { name: "Nicole Sciacca",     initials: "NS", av: "av-nicole" },
};
// Status → accent colour, used for the left stripe on item rows.
const STATE_COLOR = {
  open: "#3B6CF0", in_progress: "#0EA5E9", awaiting_principal: "#E0A82E",
  pending_review: "#9F5CF0", follow_up: "#F43F5E", on_hold: "#A98467", closed: "#98A2B3",
};
function profileFor(key, profiles) {
  const p = profiles.find((x) => x.user_key === key);
  const d = DEFAULTS[key] || { name: key, initials: "?", av: "av-nicole" };
  return {
    user_key: key,
    name: p?.name || d.name,
    initials: p?.initials || d.initials,
    av: d.av,
    avatar_url: p?.avatar_url || null,
    role: p?.role,
  };
}
function Ico({ d }) {
  return <span style={{ display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: d }} />;
}
// Only allow safe link schemes (prevents javascript: etc. from a crafted record)
function safeUrl(u) {
  return (typeof u === "string" && /^(https:\/\/|message:)/i.test(u.trim())) ? u.trim() : null;
}
// Deterministic color from a seed (for contacts/locations that have no stored color)
function colorFor(seed) {
  const palette = ["#3B6CF0", "#0E9F6E", "#B45309", "#7C3AED", "#E11D48", "#0EA5E9", "#D946EF", "#F59E0B", "#14B8A6", "#6366F1"];
  let h = 0; const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function Avatar({ k, size = 30, profiles }) {
  const p = profileFor(k, profiles);
  if (p.avatar_url)
    return <img className="avatar-img" src={p.avatar_url} alt={p.name} style={{ width: size, height: size }} />;
  return (
    <div className={"avatar " + p.av} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {p.initials}
    </div>
  );
}
function StateBadge({ s }) {
  return (
    <span className={"badge-state s-" + s}>
      <span className="sd" />
      {STATES[s].label}
    </span>
  );
}
function Prio({ p }) {
  if (!p) return null;
  return <span className={"prio " + p}>{p}</span>;
}
// Multi-select as toggleable chips
// Sort reference lists (projects/contacts/locations) alphabetically by name for dropdowns.
const byName = (a, b) => (a.name || "").localeCompare(b.name || "");

// List vs Cards view toggle for the directory tabs, persisted per tab.
function useView(key) {
  const [view, setV] = useState(() => { try { return localStorage.getItem(key) || "list"; } catch (e) { return "list"; } });
  const setView = (v) => { setV(v); try { localStorage.setItem(key, v); } catch (e) {} };
  return [view, setView];
}
function ViewToggle({ view, setView }) {
  return (
    <span className="viewtoggle" style={{ marginRight: 8 }}>
      <button className={"vt" + (view === "list" ? " on" : "")} onClick={() => setView("list")} title="List view" aria-label="List view"><Ico d={I.items} /></button>
      <button className={"vt" + (view === "cards" ? " on" : "")} onClick={() => setView("cards")} title="Card view" aria-label="Card view"><Ico d={I.grid} /></button>
    </span>
  );
}
function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function ChipMulti({ options, selected, onToggle, empty }) {
  const opts = [...(options || [])].sort(byName);
  return (
    <div className="chipmulti">
      {opts.length === 0 && <span className="muted">{empty || "—"}</span>}
      {opts.map((o) => {
        const on = (selected || []).includes(o.id);
        return (
          <button type="button" key={o.id} className={"chip" + (on ? " on" : "")} onClick={() => onToggle(o.id)}>
            {o.color && <span className="pdot" style={{ background: o.color }} />}{o.name}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Root
   ============================================================ */
export default function App() {
  const [theme, setTheme] = useState("light");
  const [width, setWidth] = useState("comfortable");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);

  // data
  const [items, setItems] = useState([]);
  const [comments, setComments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activity, setActivity] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [reads, setReads] = useState([]);
  const [chat, setChat] = useState([]);
  const [chatReads, setChatReads] = useState([]);

  // ui
  const [view, setView] = useState("plate");
  const [density, setDensity] = useState("comfortable");
  const [currentId, setCurrentId] = useState(null);
  const [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const allFilter = { status: "all", project: "all", contact: "all", location: "all" };
  const [itemsFilter, setItemsFilter] = useState(allFilter);
  const toastTimer = useRef(null);

  function notify(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2300);
  }
  function applyTheme(t) {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("gtd-theme", t); } catch {}
  }
  function applyWidth(w) {
    setWidth(w);
    try { localStorage.setItem("gtd-width", w); } catch {}
  }
  function applyDensity(d) {
    setDensity(d);
    try { localStorage.setItem("gtd-density", d); } catch {}
  }

  // theme + width on mount
  useEffect(() => {
    let savedTheme = "light", savedWidth = "comfortable", savedDensity = "comfortable";
    try { savedTheme = localStorage.getItem("gtd-theme") || "light"; } catch {}
    try { savedWidth = localStorage.getItem("gtd-width") || "comfortable"; } catch {}
    try { savedDensity = localStorage.getItem("gtd-density") || "comfortable"; } catch {}
    if (savedDensity !== "oneline") savedDensity = "comfortable"; // Compact option removed
    applyTheme(savedTheme);
    setWidth(savedWidth);
    setDensity(savedDensity);
  }, []);

  // auth
  useEffect(() => {
    if (!isConfigured) { setBooting(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadData() {
    const [it, cm, pr, ct, ac, pf, lo, rx, rd, gm, cr] = await Promise.all([
      api.listItems(), api.listComments(), api.listProjects(),
      api.listContacts(), api.listActivity(), api.listProfiles(), api.listLocations(),
      api.listReactions(), api.listCommentReads(), api.listGeneralMessages(), api.listChatReads(),
    ]);
    setItems(it); setComments(cm); setProjects(pr);
    setContacts(ct); setActivity(ac); setProfiles(pf); setLocations(lo); setReactions(rx); setReads(rd);
    setChat(gm); setChatReads(cr);
  }

  // record an access session + heartbeat while signed in (for the audit log)
  useEffect(() => {
    if (!profile) return;
    let sid = null, iv = null;
    (async () => {
      try { sid = await api.startSession(profile.user_key); } catch {}
      iv = setInterval(() => { api.touchSession(sid); }, 60000);
    })();
    return () => { if (iv) clearInterval(iv); api.touchSession(sid); };
  }, [profile && profile.id]);

  // when logged in: load profile + data, subscribe to realtime
  useEffect(() => {
    if (!session) { setProfile(null); return; }
    let unsub = null;
    (async () => {
      const me = await api.getMyProfile();
      setProfile(me);
      await loadData();
      unsub = api.subscribe(() => loadData());
    })();
    return () => { if (unsub) unsub(); };
  }, [session]);

  // ----- gates -----
  if (!isConfigured) return <ConfigWarning />;
  if (booting) return <AppSkeleton />;
  if (!session) return <Login notify={notify} />;
  if (!profile) return <AppSkeleton />;

  const me = profile.user_key;          // 'stephane' | 'nicole'
  const isPrincipal = profile.role === "principal";
  const current = items.find((i) => i.id === currentId) || null;

  const ctx = {
    me, isPrincipal, profile, profiles, items, comments, projects, contacts, activity, locations, reactions, reads, chat, chatReads,
    notify, reload: loadData,
    open: (id) => { setCurrentId(id); setView("detail"); },
    goItems: () => { setCurrentId(null); setItemsFilter(allFilter); setView("items"); },
    goFiltered: (spec) => { setCurrentId(null); setItemsFilter({ ...allFilter, ...spec }); setView("items"); },
    goNew: () => { setCurrentId(null); setView("new"); },
    goChat: () => { setCurrentId(null); setView("chat"); },
    initialFilter: itemsFilter,
  };

  const NAV = [
    { key: "plate", label: "On my plate", icon: I.plate },
    { key: "dashboard", label: "Dashboard", icon: I.dashboard },
    { key: "items", label: "All Items", icon: I.items },
    { key: "recurring", label: "Recurring", icon: I.loop },
    { key: "new", label: "New Item", icon: I.add },
    { key: "chat", label: "Chat", icon: I.chat },
    { key: "projects", label: "Projects", icon: I.projects },
    { key: "contacts", label: "Contacts", icon: I.contacts },
    { key: "locations", label: "Locations", icon: I.pin },
    { key: "activity", label: "Activity", icon: I.activity },
    { key: "profiles", label: "Profiles", icon: I.user },
    ...(isPrincipal ? [{ key: "audit", label: "Audit log", icon: I.shield }] : []),
  ];
  const myQueue = items.filter((i) => ownerOf(i) === me).length;
  const myChatRead = chatReads.find((r) => r.user_key === me);
  const chatSeenAt = myChatRead ? new Date(myChatRead.last_seen_at).getTime() : 0;
  const chatUnread = chat.filter((m) => m.author !== me && new Date(m.created_at).getTime() > chatSeenAt).length;
  const titles = {
    plate: "On my plate",
    dashboard: "Dashboard", items: "All Items", new: "New Item", projects: "Projects",
    activity: "Activity", profiles: "Profiles", audit: "Audit log", contacts: "Contacts", locations: "Locations",
    chat: "Chat", email: "Email update", recurring: "Recurring",
    detail: <span><span className="crumb">All Items › </span>Item Detail</span>,
  };

  return (
    <div className="app">
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className={"sidebar" + (navOpen ? " open" : "")}>
        <div className="brand">
          <div className="logo"><img src={markUrl} alt="Ivest" /></div>
          <div className="name">Interactive GTD<small>Ivest</small></div>
        </div>
        <nav className="nav">
          <div className="sect">Workspace</div>
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""}
              onClick={() => { setCurrentId(null); if (n.key === "items") setItemsFilter(allFilter); setView(n.key); setNavOpen(false); }}>
              <Ico d={n.icon} /><span>{n.label}</span>
              {n.key === "dashboard" && (
                <span className={"badge " + (myQueue ? "" : "zero")}>{myQueue}</span>
              )}
              {n.key === "chat" && chatUnread > 0 && (
                <span className="badge chatnew"><span className="bdot" />{chatUnread} new</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="width-ctl" title="Row density">
            {[["comfortable", "Comfortable"], ["oneline", "One line"]].map(([d, label]) => (
              <button key={d} className={density === d ? "on" : ""} onClick={() => applyDensity(d)}>{label}</button>
            ))}
          </div>
          <button className="who-card" onClick={() => { setView("profiles"); setNavOpen(false); }}>
            <Avatar k={me} size={34} profiles={profiles} />
            <div className="meta">
              <div className="nm">{profile.name}</div>
              <div className="rl">{isPrincipal ? "Principal" : "Assistant"}</div>
            </div>
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="btn ghost sm hamburger" aria-label="Menu" onClick={() => setNavOpen(true)}><Ico d={I.menu} /></button>
          <h1>{titles[view]}</h1>
          <button className="btn ghost sm topsearch" aria-label="Search" onClick={() => setSearchOpen((s) => !s)}><Ico d={I.search} /></button>
          <GlobalSearch ctx={ctx} mobileOpen={searchOpen} />
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => applyTheme(theme === "dark" ? "light" : "dark")}>
            <Ico d={theme === "dark" ? I.sun : I.moon} />
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <div className="role-tag">
            <Avatar k={me} size={30} profiles={profiles} />
          </div>
          <button className="btn ghost sm" title="Sign out" onClick={() => supabase.auth.signOut()}>
            <Ico d={I.logout} />
          </button>
        </div>

        <div className={"content width-comfortable density-" + density} key={view + (currentId || "")}>
          {view === "plate" && <OnMyPlate ctx={ctx} />}
          {view === "dashboard" && <Dashboard ctx={ctx} />}
          {view === "items" && <ItemsList ctx={ctx} />}
          {view === "recurring" && <Recurring ctx={ctx} />}
          {view === "detail" && current && <ItemDetail ctx={ctx} item={current} />}
          {view === "new" && <NewItem ctx={ctx} />}
          {view === "chat" && <Chat ctx={ctx} />}
          {view === "projects" && <Projects ctx={ctx} />}
          {view === "contacts" && <Contacts ctx={ctx} />}
          {view === "locations" && <Locations ctx={ctx} />}
          {view === "activity" && <Activity ctx={ctx} />}
          {view === "profiles" && <Profiles ctx={ctx} />}
          {view === "audit" && isPrincipal && <Audit ctx={ctx} />}
        </div>
      </div>

      <nav className="botbar">
        {[
          { key: "plate", label: "Plate", icon: I.plate },
          { key: "items", label: "Items", icon: I.items },
          { key: "dashboard", label: "Home", icon: I.dashboard },
          { key: "chat", label: "Chat", icon: I.chat, badge: chatUnread },
        ].map((t) => (
          <button key={t.key} className={"bb" + (view === t.key ? " on" : "")}
            onClick={() => { setCurrentId(null); if (t.key === "items") setItemsFilter(allFilter); setView(t.key); setNavOpen(false); }}>
            <span className="bb-ic"><Ico d={t.icon} />{t.badge > 0 && <span className="bb-dot" />}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <button className={"bb" + (["plate", "items", "dashboard", "chat", "detail", "new"].indexOf(view) === -1 ? " on" : "")} onClick={() => setNavOpen(true)}>
          <span className="bb-ic"><Ico d={I.dots} /></span><span>More</span>
        </button>
      </nav>
      <button className="fab" aria-label="New item" onClick={() => { setCurrentId(null); setView("new"); setNavOpen(false); }}><Ico d={I.add} /></button>

      <div className={"toast" + (toast ? " show" : "")}><span className="td" />{toast}</div>
    </div>
  );
}

function dayLabel(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function AppSkeleton() {
  return (
    <div className="app-skel">
      <div className="sk sk-line" style={{ width: "38%", height: 22 }} />
      <div className="sk sk-line" style={{ width: "55%", height: 13, marginTop: 10 }} />
      <div className="sk-cards">{[0, 1, 2].map((i) => <div key={i} className="sk sk-card" />)}</div>
      {[0, 1, 2, 3].map((i) => <div key={i} className="sk sk-rowbig" />)}
    </div>
  );
}
const STEP_OF = { open: 0, in_progress: 1, awaiting_principal: 1, follow_up: 1, on_hold: 1, pending_review: 2, closed: 3 };
function Stepper({ status, onPick, isPrincipal, busy }) {
  const cur = STEP_OF[status] != null ? STEP_OF[status] : 0;
  const steps = [["open", "Open"], ["in_progress", "In progress"], ["pending_review", "Review"], ["closed", "Closed"]];
  const lockedClosed = !isPrincipal; // only the Principal opens/closes
  return (
    <div className="stepper">
      {steps.map(([key, label], i) => {
        const clickable = onPick && !busy && key !== status && !(key === "closed" && lockedClosed) && !(status === "closed" && lockedClosed);
        return (
          <button type="button" key={key} disabled={!clickable}
            className={"step " + (i < cur ? "done" : i === cur ? "current" : "todo") + (clickable ? " clickable" : "")}
            onClick={() => clickable && onPick(key)} title={clickable ? "Move to " + label : ""}>
            <span className="step-dot">{i < cur ? <Ico d={I.check} /> : <span className="step-inner" />}</span>
            <span className="step-lbl">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Item row + group
   ============================================================ */
function ItemRow({ it, ctx }) {
  const proj = ctx.projects.find((p) => p.id === it.project_id);
  const cnames = (it.contact_ids || []).map((id) => (ctx.contacts.find((c) => c.id === id) || {}).name).filter(Boolean);
  const contactLabel = cnames.length ? (cnames.length > 1 ? cnames[0] + " +" + (cnames.length - 1) : cnames[0]) : "";
  const myRead = (ctx.reads || []).find((r) => r.user_key === ctx.me && r.action_item_id === it.id);
  const seenAt = myRead ? new Date(myRead.last_seen_at).getTime() : 0;
  const unread = (ctx.comments || []).filter((c) => c.action_item_id === it.id && c.author !== ctx.me && new Date(c.created_at).getTime() > seenAt).length;
  // Most recent activity_log entry for this item (list is newest-first) → "last action by …".
  const lastAct = (ctx.activity || []).find((a) => a.action_item_id === it.id);
  const lastActor = lastAct ? (lastAct.actor === "system" ? "System" : ((profileFor(lastAct.actor, ctx.profiles).name || "").split(" ")[0] || "someone")) : "";

  // Swipe-to-reveal (touch only): slide a row left to show Open + a safe one-step action.
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const st = useRef({ x: 0, y: 0, base: 0, dir: null });
  const quick = (() => {
    if (ownerOf(it) !== ctx.me) return null;
    if (it.status === "open") return { label: "Start", to: "in_progress", color: "#0EA5E9" };
    if (it.status === "in_progress") return { label: "Review", to: "pending_review", color: "#9F5CF0" };
    if (it.status === "follow_up") return { label: "Resume", to: "in_progress", color: "#0EA5E9" };
    if (it.status === "pending_review" && ctx.isPrincipal) return { label: "Close", to: "closed", color: "#0E9F6E" };
    return null;
  })();
  const W = quick ? 144 : 76;
  const onStart = (e) => { const t = e.touches[0]; st.current = { x: t.clientX, y: t.clientY, base: dx, dir: null }; };
  const onMove = (e) => {
    const t = e.touches[0], s = st.current;
    const ddx = t.clientX - s.x, ddy = t.clientY - s.y;
    if (!s.dir) { if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy)) { s.dir = "h"; setDragging(true); } else if (Math.abs(ddy) > 8) s.dir = "v"; }
    if (s.dir === "h") setDx(Math.max(-W, Math.min(0, s.base + ddx)));
  };
  const onEnd = () => { setDragging(false); setDx(dx < -W / 2 ? -W : 0); };
  const doQuick = async (e) => {
    e.stopPropagation(); setDx(0);
    await api.setStatus(it, quick.to, "Status changed to " + STATES[quick.to].label, ctx.me);
    ctx.reload();
  };
  const onRowClick = () => { if (dx < 0) { setDx(0); return; } ctx.open(it.id); };

  return (
    <div className="swipe-wrap">
      <div className="swipe-actions" style={{ width: W }}>
        {quick && <button className="swa" style={{ background: quick.color }} onClick={doQuick}>{quick.label}</button>}
        <button className="swa swa-open" onClick={(e) => { e.stopPropagation(); setDx(0); ctx.open(it.id); }}>Open</button>
      </div>
      <div className="item striped" onClick={onRowClick}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        style={{ borderLeftColor: STATE_COLOR[it.status] || "transparent", transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? "none" : "transform .18s ease" }}>
        <div className="grow">
          <div className="ttl">
            {it.priority && <span className={"pri-dot pri-" + it.priority} title={it.priority + " priority"} />}
            {it.title}
            {unread > 0 && <span className="newc" title={unread + " new comment" + (unread > 1 ? "s" : "")}><Ico d={I.chat} />{unread}</span>}
          </div>
          <div className="meta">
            <span className="src"><Ico d={it.source === "email" ? I.mail : I.pencil} /> {it.source}</span>
            {proj && <span className="tag"><span className="pdot" style={{ background: proj.color }} />{proj.name}</span>}
            {it.is_recurring && <span className="tag recur"><Ico d={I.loop} />Recurring</span>}
            {contactLabel && <span className="muted">{contactLabel}</span>}
            <span className="muted">added {ago(it.created_at)}</span>
            {lastAct && <span className="muted">· last action by {lastActor} {ago(lastAct.created_at)}</span>}
          </div>
        </div>
        <StateBadge s={it.status} />
        <span className="chev"><Ico d={I.chev} /></span>
      </div>
    </div>
  );
}
function Group({ title, icon, arr, ctx, empty, tone, startOpen }) {
  const [open, setOpen] = useState(startOpen !== undefined ? startOpen : arr.length > 0); // empty categories start collapsed (compact)
  return (
    <div className="group" style={tone ? { borderLeft: "3px solid " + tone } : undefined}>
      <div className="group-head group-toggle" onClick={() => setOpen(!open)}>
        <span className="gi" style={tone ? { color: tone } : undefined}><Ico d={icon} /></span>{title}<span className="count">{arr.length}</span>
        <div style={{ flex: 1 }} />
        <span className={"twist" + (open ? " open" : "")}><Ico d={I.chev} /></span>
      </div>
      {open && (arr.length ? arr.map((it) => <ItemRow key={it.id} it={it} ctx={ctx} />) : <div className="empty"><span className="empty-ic"><Ico d={I.check} /></span>{empty}</div>)}
    </div>
  );
}

/* ============================================================
   On my plate — focused landing: only what's waiting on YOU
   ============================================================ */
function OnMyPlate({ ctx }) {
  const { items, isPrincipal, me, profiles, projects, contacts } = ctx;
  const otherName = (profileFor(isPrincipal ? "nicole" : "stephane", profiles).name || "").split(" ")[0];
  const prioRank = (p) => (p === "high" ? 2 : p === "low" ? 0 : 1);
  const byPrio = (a, b) => prioRank(b.priority) - prioRank(a.priority) || (new Date(a.created_at) - new Date(b.created_at));
  const projName = (id) => { const p = projects.find((x) => x.id === id); return p ? p.name : null; };
  const firstContact = (it) => { const id = (it.contact_ids || [])[0]; const c = id && contacts.find((x) => x.id === id); return c ? c.name : null; };
  const groups = (isPrincipal
    ? [
        { key: "awaiting_principal", label: "Needs your answer", color: "#E0A82E", action: "Answer" },
        { key: "pending_review", label: "Ready to review", color: "#9F5CF0", action: "Review" },
      ]
    : [
        { key: "open", label: "To do", color: "#3B6CF0", action: "Start" },
        { key: "in_progress", label: "In progress", color: "#0EA5E9", action: "Open" },
        { key: "follow_up", label: "Follow-up needed", color: "#F43F5E", action: "Resume" },
      ]
  ).map((g) => ({ ...g, list: items.filter((i) => i.status === g.key && ownerOf(i) === me).sort(byPrio) })).filter((g) => g.list.length);
  const total = groups.reduce((s, g) => s + g.list.length, 0);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <div className="page-head"><div><h2>On my plate</h2>
        <div className="brief"><span className="brief-date">{today}</span><span className="dot-sep">·</span>
          <span>{total === 0 ? "nothing waiting on you" : <><b>{total}</b> item{total === 1 ? "" : "s"} waiting on you</>}</span>
        </div></div></div>
      {total === 0 ? (
        <div className="empty"><span className="empty-ic"><Ico d={I.check} /></span>You're all caught up — nothing needs you right now.</div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="plate-sect">
            <div className="plate-h"><span className="plate-h-lbl" style={{ color: g.color }}>{g.label}</span><span className="plate-h-n">{g.list.length}</span></div>
            <div className="plate-list">
              {g.list.map((it) => (
                <div key={it.id} className="plate-row" style={{ borderLeftColor: g.color }} onClick={() => ctx.open(it.id)}>
                  <span className={"pri-dot pri-" + (it.priority || "normal")} title={(it.priority || "normal") + " priority"} />
                  <div className="plate-body">
                    <div className="plate-ttl">{it.title}</div>
                    <div className="plate-meta">{[projName(it.project_id), firstContact(it), "added " + ago(it.created_at)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); ctx.open(it.id); }}>{g.action}</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {total > 0 && (
        <div className="plate-foot"><Ico d={I.check} /><span>Everything else is with {otherName} — nothing else needs you right now.</span></div>
      )}
    </>
  );
}

/* ============================================================
   Dashboard
   ============================================================ */
function Dashboard({ ctx }) {
  const { items, me, isPrincipal, profile } = ctx;
  const by = (s) => items.filter((i) => i.status === s);
  const [briefOpen, setBriefOpen] = useState(() => { try { return localStorage.getItem("gtd-brief") !== "off"; } catch (e) { return true; } });
  const setBrief = (v) => { setBriefOpen(v); try { localStorage.setItem("gtd-brief", v ? "on" : "off"); } catch (e) {} };
  const Stat = ({ n, l, to, tone }) => (
    <div className={"stat " + (to ? "clickable" : "")} style={tone ? { "--bar": tone } : undefined}
      onClick={to ? () => ctx.goFiltered({ status: to }) : undefined}>
      <div className="n" style={tone ? { color: tone } : undefined}>{n}</div><div className="l">{l}</div>
    </div>
  );
  return (
    <>
      <div className="page-head">
        <div>
          {briefOpen ? (
            <>
              <div className="eyebrow">{isPrincipal ? "Principal" : "Assistant"} workspace</div>
              <h2>Hello, {profile.name.split(" ")[0]}</h2>
              <div className="brief">
                <span className="brief-date">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span>
                {isPrincipal ? (<>
                  <span className="dot-sep">·</span><span><b style={{ color: "#E0A82E" }}>{by("awaiting_principal").length}</b> need your answer</span>
                  <span className="dot-sep">·</span><span><b style={{ color: "#9F5CF0" }}>{by("pending_review").length}</b> to review</span>
                  <span className="dot-sep">·</span><span><b style={{ color: "#3B6CF0" }}>{by("open").length + by("in_progress").length}</b> with Nicole</span>
                </>) : (<>
                  <span className="dot-sep">·</span><span><b style={{ color: "#3B6CF0" }}>{by("open").length}</b> to start</span>
                  <span className="dot-sep">·</span><span><b style={{ color: "#0EA5E9" }}>{by("in_progress").length}</b> in progress</span>
                  <span className="dot-sep">·</span><span><b style={{ color: "#F43F5E" }}>{by("follow_up").length}</b> follow-ups</span>
                </>)}
                <button className="brief-toggle" title="Hide" onClick={() => setBrief(false)}>Hide</button>
              </div>
            </>
          ) : (
            <button className="brief-toggle show" onClick={() => setBrief(true)}>Show summary</button>
          )}
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => ctx.goNew()}>
          <Ico d={I.add} /> New item
        </button>
      </div>

      <WhatsNew ctx={ctx} />
      {isPrincipal && <RecentlyAdded ctx={ctx} />}

      {isPrincipal ? (
        <>
          <Group title="Needs my answer" icon={I.flag} arr={by("awaiting_principal")} ctx={ctx} empty="Nothing waiting on you right now." tone="#E0A82E" />
          <Group title="To review" icon={I.check} arr={by("pending_review")} ctx={ctx} empty="Nothing to review right now." tone="#9F5CF0" />
          <Group title="Follow-up required" icon={I.loop} arr={by("follow_up")} ctx={ctx} empty="No follow-ups outstanding." tone="#F43F5E" />
          <Group title="In Nicole's hands" icon={I.dots} arr={items.filter((i) => ["open", "in_progress"].includes(i.status))} ctx={ctx} empty="Nothing in progress." tone="#3B6CF0" />
          <Group title="Closed" icon={I.check} arr={by("closed")} ctx={ctx} empty="Nothing closed yet." tone="#98A2B3" startOpen={false} />
        </>
      ) : (
        <>
          <Group title="To do" icon={I.circle} arr={by("open")} ctx={ctx} empty="Nothing new assigned." tone="#3B6CF0" />
          <Group title="In progress" icon={I.dots} arr={by("in_progress")} ctx={ctx} empty="Nothing in progress." tone="#0EA5E9" />
          <Group title="Follow-up from Stephane" icon={I.loop} arr={by("follow_up")} ctx={ctx} empty="No follow-ups." tone="#F43F5E" />
          <Group title="Waiting on Stephane" icon={I.clock} arr={by("awaiting_principal")} ctx={ctx} empty="Nothing waiting on Stephane." tone="#E0A82E" />
          <Group title="Closed" icon={I.check} arr={by("closed")} ctx={ctx} empty="Nothing closed yet." tone="#98A2B3" startOpen={false} />
        </>
      )}
    </>
  );
}

/* ============================================================
   What's new — unread comments/answers on actions + chat
   ============================================================ */
function WhatsNew({ ctx }) {
  const { me, comments, items, reads, chat, chatReads, profiles } = ctx;
  const readMap = {};
  (reads || []).forEach((r) => { if (r.user_key === me) readMap[r.action_item_id] = new Date(r.last_seen_at).getTime(); });
  const itemById = {};
  items.forEach((i) => { itemById[i.id] = i; });
  const unread = (comments || []).filter((c) => c.author !== me && itemById[c.action_item_id] && new Date(c.created_at).getTime() > (readMap[c.action_item_id] || 0));
  const byItem = {};
  unread.forEach((c) => { const cur = byItem[c.action_item_id]; if (!cur || new Date(c.created_at) > new Date(cur.created_at)) byItem[c.action_item_id] = c; });
  const itemRows = Object.values(byItem).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const myChat = (chatReads || []).find((r) => r.user_key === me);
  const chatSeen = myChat ? new Date(myChat.last_seen_at).getTime() : 0;
  const unreadChat = (chat || []).filter((m) => m.author !== me && new Date(m.created_at).getTime() > chatSeen)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const total = itemRows.length + (unreadChat.length ? 1 : 0);
  if (!total) return null;
  const verb = (t) => (t === "answer" ? "answered" : t === "question" ? "asked on" : "commented on");
  const first = (k) => profileFor(k, profiles).name.split(" ")[0];
  const dismiss = (e, itemId) => { e.stopPropagation(); api.markItemSeen(me, itemId).then(() => ctx.reload()); };
  const dismissChat = (e) => { e.stopPropagation(); api.markChatSeen(me).then(() => ctx.reload()); };
  const clearAll = () => {
    Promise.all([...itemRows.map((c) => api.markItemSeen(me, c.action_item_id)), unreadChat.length ? api.markChatSeen(me) : Promise.resolve()])
      .then(() => ctx.reload());
  };
  const lastChat = unreadChat[unreadChat.length - 1];
  return (
    <div className="whatsnew">
      <div className="wn-head"><Ico d={I.activity} /> What's new <span className="count">{total}</span>
        <span style={{ flex: 1 }} />
        <button className="linkbtn" onClick={clearAll}>Mark all read</button>
      </div>
      {lastChat && (
        <div className="wn-row" onClick={() => ctx.goChat()}>
          <Avatar k={lastChat.author} size={26} profiles={profiles} />
          <span className="wn-txt"><b>{first(lastChat.author)}</b> sent {unreadChat.length} new message{unreadChat.length > 1 ? "s" : ""} in Chat</span>
          <span className="wn-when">{ago(lastChat.created_at)}</span>
          <button className="wn-tick" title="Mark read" onClick={dismissChat}><Ico d={I.check} /></button>
        </div>
      )}
      {itemRows.map((c) => (
        <div key={c.id} className="wn-row" onClick={() => ctx.open(c.action_item_id)}>
          <Avatar k={c.author} size={26} profiles={profiles} />
          <span className="wn-txt"><b>{first(c.author)}</b> {verb(c.type)} “{itemById[c.action_item_id].title}”</span>
          <span className="wn-when">{ago(c.created_at)}</span>
          <button className="wn-tick" title="Mark read" onClick={(e) => dismiss(e, c.action_item_id)}><Ico d={I.check} /></button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Recently added — newest actions, to confirm they came in
   ============================================================ */
function RecentlyAdded({ ctx }) {
  const { items, projects, reads, me } = ctx;
  const seen = new Set((reads || []).filter((r) => r.user_key === me).map((r) => r.action_item_id));
  const cutoff = Date.now() - 7 * 86400000;
  const recent = items
    .filter((i) => i.status !== "closed" && !seen.has(i.id) && new Date(i.created_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8);
  if (!recent.length) return null;
  const projName = (id) => (projects.find((p) => p.id === id) || {}).name || "";
  const dismiss = (e, id) => { e.stopPropagation(); api.markItemSeen(me, id).then(() => ctx.reload()); };
  const markAll = () => Promise.all(recent.map((i) => api.markItemSeen(me, i.id))).then(() => ctx.reload());
  return (
    <div className="whatsnew">
      <div className="wn-head"><Ico d={I.clock} /> Recently added <span className="count">{recent.length}</span>
        <span style={{ flex: 1 }} />
        <button className="linkbtn" onClick={markAll}>Mark all seen</button>
      </div>
      {recent.map((i) => (
        <div key={i.id} className="wn-row" onClick={() => ctx.open(i.id)}>
          <span className="ra-src" title={i.source === "email" ? "From email" : "Added manually"}><Ico d={i.source === "email" ? I.mail : I.pencil} /></span>
          <span className="wn-txt">{i.title}{projName(i.project_id) ? <span className="ra-proj"> · {projName(i.project_id)}</span> : ""}</span>
          <StateBadge s={i.status} />
          <span className="wn-when">{ago(i.created_at)}</span>
          <button className="wn-tick" title="Mark as seen (stays in the app)" onClick={(e) => dismiss(e, i.id)}><Ico d={I.check} /></button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Chat — running conversation not tied to an action
   ============================================================ */
function Chat({ ctx }) {
  const { me, chat, profiles } = ctx;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { api.markChatSeen(me).then(() => ctx.reload()); }, [me, chat.length]);
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ block: "end" }); }, [chat.length]);
  const send = () => {
    if (!text.trim()) return;
    setBusy(true);
    api.sendGeneralMessage(me, text.trim()).then(() => { setText(""); setBusy(false); ctx.reload(); });
  };
  return (
    <div className="chatpage">
      <p className="muted" style={{ marginTop: 0 }}>A shared space for questions and notes that aren't tied to a specific action.</p>
      <div className="chatthread">
        {chat.length === 0 && <div className="muted">No messages yet — start the conversation.</div>}
        {(() => {
          let lastDay = null;
          const out = [];
          chat.forEach((m) => {
            const d = new Date(m.created_at);
            const key = d.toDateString();
            if (key !== lastDay) { lastDay = key; out.push(<div key={"d-" + m.id} className="chat-day"><span>{dayLabel(d)}</span></div>); }
            const mine = m.author === me;
            out.push(
              <div key={m.id} className={"cmsg" + (mine ? " mine" : "")}>
                {!mine && <Avatar k={m.author} size={30} profiles={profiles} />}
                <div className="cbubble">
                  {!mine && <div className="cwho">{profileFor(m.author, profiles).name.split(" ")[0]}</div>}
                  <div className="ctext">{m.body}</div>
                  <div className="cwhen">{ago(m.created_at)}</div>
                </div>
                {mine && <Avatar k={m.author} size={30} profiles={profiles} />}
              </div>
            );
          });
          return out;
        })()}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={send}><Ico d={I.check} /> Send</button>
          <span className="muted" style={{ fontSize: 11 }}>⌘/Ctrl + Enter to send</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Email update — formatted status email Nicole/Stephane can send
   ============================================================ */
const USER_EMAILS = { stephane: "stephane.chatonsky@ivest.com.au", nicole: "nicole.sciacca@ivest.com.au" };
function EmailUpdate({ ctx }) {
  const { me, items, projects } = ctx;
  const [days, setDays] = useState(7);
  const otherKey = me === "stephane" ? "nicole" : "stephane";
  const otherName = (DEFAULTS[otherKey] || {}).name ? DEFAULTS[otherKey].name.split(" ")[0] : "there";
  const projName = (id) => (projects.find((p) => p.id === id) || {}).name || "";
  const OUT = ["open", "in_progress", "follow_up", "awaiting_principal", "pending_review"];
  const cutoff = Date.now() - days * 86400000;
  const outstanding = items.filter((i) => OUT.includes(i.status));
  const closedRecent = items.filter((i) => i.status === "closed" && new Date(i.updated_at).getTime() >= cutoff);
  const line = (i) => `- ${i.title}${projName(i.project_id) ? " [" + projName(i.project_id) + "]" : ""}${i.due_date ? " (due " + i.due_date + ")" : ""}`;
  const grouped = OUT.map((s) => {
    const g = outstanding.filter((i) => i.status === s);
    return g.length ? `${STATES[s].label} (${g.length})\n${g.map(line).join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
  const subject = `Action items update — ${new Date().toLocaleDateString()}`;
  const body = `Hi ${otherName},\n\nHere's where things stand.\n\nOUTSTANDING (${outstanding.length})\n${grouped || "- none -"}\n\nCLOSED IN THE LAST ${days} DAY${days === 1 ? "" : "S"} (${closedRecent.length})\n${closedRecent.length ? closedRecent.map(line).join("\n") : "- none -"}\n\nThanks`;
  const copy = () => { if (navigator.clipboard) navigator.clipboard.writeText(body); ctx.notify("Update copied"); };
  const mailto = `mailto:${USER_EMAILS[otherKey]}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="emailupd">
      <p className="muted" style={{ marginTop: 0 }}>A status email of outstanding items plus anything closed recently — addressed to {otherName}.</p>
      <div className="eu-controls">
        <label className="eu-days">Include items closed in the last
          <input type="number" min="1" max="120" value={days}
            onChange={(e) => setDays(Math.min(120, Math.max(1, parseInt(e.target.value || "1", 10))))} />
          day{days === 1 ? "" : "s"}
        </label>
        <div className="eu-actions">
          <button className="btn" onClick={copy}><Ico d={I.check} /> Copy</button>
          <a className="btn primary" href={mailto}><Ico d={I.mail} /> Open in Mail</a>
        </div>
      </div>
      <pre className="eu-preview">{body}</pre>
    </div>
  );
}

/* ============================================================
   Global search (top bar)
   ============================================================ */
function GlobalSearch({ ctx, mobileOpen }) {
  const { items } = ctx;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = q.trim().toLowerCase();
  const results = term.length >= 2
    ? items.filter((i) => (i.title + " " + (i.description || "")).toLowerCase().includes(term)).slice(0, 8)
    : [];
  const go = (id) => { ctx.open(id); setQ(""); setOpen(false); };
  return (
    <div className={"gsearch" + (mobileOpen ? " mopen" : "")}>
      <input type="text" value={q} placeholder="Search actions…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && term.length >= 2 && (
        <div className="gsearch-pop">
          {results.length ? results.map((i) => (
            <button key={i.id} className="gsearch-row" onMouseDown={() => go(i.id)}>
              <span className="gs-ttl">{i.title}</span>
              <StateBadge s={i.status} />
            </button>
          )) : <div className="gsearch-empty">No matches</div>}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Recurring view
   ============================================================ */
function Recurring({ ctx }) {
  const { items } = ctx;
  const recurring = items.filter((i) => i.is_recurring);
  const active = recurring.filter((i) => i.status !== "closed");
  const closed = recurring.filter((i) => i.status === "closed");
  return (
    <>
      <div className="page-head">
        <div><h2>Recurring</h2><div className="sub">{recurring.length} marked recurring</div></div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => ctx.goNew()}><Ico d={I.add} /> New item</button>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>Actions you set up regularly. Tick “Recurring” on any action to list it here; once you've done this round, create the next one.</p>
      {recurring.length === 0 ? (
        <div className="group"><div className="empty">Nothing marked recurring yet. Open an action, click Edit, and tick “Recurring”.</div></div>
      ) : (
        <>
          <div className="group">
            {active.length ? active.map((it) => <ItemRow key={it.id} it={it} ctx={ctx} />)
              : <div className="empty">None active right now — time to set up the next round.</div>}
          </div>
          {closed.length > 0 && <Group title="Done this round" icon={I.check} arr={closed} ctx={ctx} empty="" tone="#98A2B3" startOpen={false} />}
        </>
      )}
    </>
  );
}

/* ============================================================
   Items list
   ============================================================ */
function ItemsList({ ctx }) {
  const { items, projects, contacts, locations } = ctx;
  const init = ctx.initialFilter || {};
  const [f, setF] = useState({ status: init.status || "all", project: init.project || "all", contact: init.contact || "all", location: init.location || "all", source: "all", q: "" });
  const [sort, setSort] = useState("recent");
  let list = items.slice();
  if (f.status !== "all") list = list.filter((i) => i.status === f.status);
  if (f.project !== "all") list = list.filter((i) => i.project_id === f.project);
  if (f.contact !== "all") list = list.filter((i) => (i.contact_ids || []).includes(f.contact));
  if (f.location !== "all") list = list.filter((i) => (i.location_ids || []).includes(f.location));
  if (f.source !== "all") list = list.filter((i) => i.source === f.source);
  if (f.q) list = list.filter((i) => (i.title + " " + (i.description || "")).toLowerCase().includes(f.q.toLowerCase()));
  if (sort === "priority") {
    const rank = { high: 0, normal: 1, low: 2 };
    list = list.slice().sort((a, b) => ((rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)) || (new Date(b.updated_at) - new Date(a.updated_at)));
  } else if (sort === "due") {
    list = list.slice().sort((a, b) => (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1) || String(a.due_date || "").localeCompare(String(b.due_date || "")));
  } else if (sort === "added") {
    list = list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  const active = list.filter((i) => i.status !== "closed");
  const closed = list.filter((i) => i.status === "closed");
  return (
    <>
      <div className="page-head">
        <div><h2>All Items</h2><div className="sub">{list.length} of {items.length} shown</div></div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => ctx.goNew()}><Ico d={I.add} /> New item</button>
      </div>
      <div className="filters">
        <input className="search" type="text" placeholder="Search items…" value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="all">All states</option>
          {Object.keys(STATES).map((s) => <option key={s} value={s}>{STATES[s].label}</option>)}
        </select>
        <select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}>
          <option value="all">All projects</option>
          {[...projects].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })}>
          <option value="all">All contacts</option>
          {[...contacts].sort(byName).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
          <option value="all">All locations</option>
          {[...locations].sort(byName).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="all">Any source</option>
          <option value="email">Email</option>
          <option value="manual">Manual</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Sort: Recent</option>
          <option value="added">Sort: Recently added</option>
          <option value="priority">Sort: Priority</option>
          <option value="due">Sort: Due date</option>
        </select>
      </div>
      {f.status === "all" ? (
        <>
          <div className="group">
            {active.length ? active.map((it) => <ItemRow key={it.id} it={it} ctx={ctx} />)
              : <div className="empty">No open items match these filters.</div>}
          </div>
          {closed.length > 0 && (
            <Group title="Closed" icon={I.check} arr={closed} ctx={ctx} empty="No closed items." tone="#98A2B3" startOpen={false} />
          )}
        </>
      ) : (
        <div className="group">
          {list.length ? list.map((it) => <ItemRow key={it.id} it={it} ctx={ctx} />)
            : <div className="empty">No items match these filters.</div>}
        </div>
      )}
    </>
  );
}

/* ============================================================
   Item detail
   ============================================================ */
function ItemDetail({ ctx, item }) {
  const { me, isPrincipal, projects, contacts, locations, profiles } = ctx;
  const [comment, setComment] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [projDraft, setProjDraft] = useState("");
  const [contactsDraft, setContactsDraft] = useState([]);
  const [locsDraft, setLocsDraft] = useState([]);
  const toggleDraft = (setter) => (id) => setter((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const [prioDraft, setPrioDraft] = useState("");
  const [dueDraft, setDueDraft] = useState("");
  const [recurDraft, setRecurDraft] = useState(false);
  const [sideEdit, setSideEdit] = useState(false);
  const [asgDraft, setAsgDraft] = useState("");
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteFiles, setNoteFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const answerRef = useRef(null);
  useEffect(() => {
    let on = true;
    if (isPrincipal) {
      api.getPrivateNote(item.id).then((v) => { if (on) setNote(v || ""); });
      api.listNoteFiles(item.id).then((fs) => { if (on) setNoteFiles(fs); });
    }
    return () => { on = false; };
  }, [item.id, isPrincipal]);
  // Mark this item's comments as seen for me, so the "new comments" dot clears.
  useEffect(() => { api.markItemSeen(me, item.id).then(() => ctx.reload()); }, [item.id]);
  const saveNote = async () => { setNoteSaving(true); await api.savePrivateNote(item.id, note); setNoteSaving(false); ctx.notify("Private note saved"); };
  const onPickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const { error } = await api.uploadNoteFile(item.id, file);
    setUploading(false);
    if (error) { ctx.notify("Upload failed"); return; }
    setNoteFiles(await api.listNoteFiles(item.id));
    ctx.notify("File attached");
  };
  const openNoteFile = async (f) => { const url = await api.noteFileUrl(f.storage_path); if (url) window.open(url, "_blank", "noreferrer"); };
  const downloadNoteFile = async (f) => {
    const url = await api.noteFileUrl(f.storage_path, f.file_name);
    if (!url) { ctx.notify("Couldn't get the file"); return; }
    const a = document.createElement("a");
    a.href = url; a.download = f.file_name; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  };
  const removeNoteFile = async (f) => {
    if (!window.confirm("Remove this attachment?")) return;
    await api.deleteNoteFile(f);
    setNoteFiles(await api.listNoteFiles(item.id));
    ctx.notify("Attachment removed");
  };
  const owner = ownerOf(item);
  const itemComments = ctx.comments.filter((c) => c.action_item_id === item.id);
  const proj = projects.find((p) => p.id === item.project_id);
  const itemContacts = (item.contact_ids || []).map((id) => contacts.find((c) => c.id === id)).filter(Boolean);
  const itemLocations = (item.location_ids || []).map((id) => locations.find((l) => l.id === id)).filter(Boolean);

  const run = async (fn) => { setBusy(true); try { await fn(); await ctx.reload(); } finally { setBusy(false); } };

  const doStatus = (to, text) => run(async () => {
    await api.setStatus(item, to, text, me);
    ctx.notify("Moved to " + STATES[to].label);
  });
  const startEditMsg = (m) => { setEditId(m.id); setEditDraft(m.body); };
  const cancelEditMsg = () => { setEditId(null); setEditDraft(""); };
  const saveEditMsg = () => { if (!editDraft.trim()) return; run(async () => {
    await api.updateComment(editId, editDraft.trim());
    setEditId(null); setEditDraft(""); ctx.notify("Message updated");
  }); };
  const doComment = () => { if (!comment.trim()) return; run(async () => {
    await api.addComment(item.id, me, comment.trim());
    await api.logActivity(item.id, me, "Comment added");
    setComment(""); ctx.notify("Comment added");
  }); };
  const doAsk = () => {
    const other = isPrincipal ? "Nicole" : "Stephane";
    const q = (comment.trim() || window.prompt(`What is your question for ${other}?`) || "").trim();
    if (!q) return;
    run(async () => { await api.askQuestion(item, q, me, isPrincipal); setComment(""); ctx.notify(`Question sent to ${other}`); });
  };
  const doAnswer = () => { if (!answer.trim()) return; run(async () => {
    await api.submitAnswer(item, answer.trim(), me); setAnswer(""); ctx.notify("Answer sent");
  }); };
  const doFollowup = () => {
    const note = window.prompt("What follow-up or change do you need from Nicole?");
    run(async () => { await api.requestFollowup(item, note || "", me); ctx.notify("Sent back to Nicole as follow-up"); });
  };
  const doDelete = async () => {
    if (!window.confirm("Delete this action item permanently? Its comments and history are removed too. This can't be undone.")) return;
    setBusy(true);
    const { error } = await api.deleteItem(item.id);
    setBusy(false);
    if (error) { ctx.notify("Couldn't delete: " + error.message); return; }
    await ctx.reload();
    ctx.notify("Item deleted");
    ctx.goItems();
  };
  const startEdit = () => {
    setTitleDraft(item.title);
    setDescDraft(item.description || "");
    setProjDraft(item.project_id || "");
    setContactsDraft(item.contact_ids || []);
    setLocsDraft(item.location_ids || []);
    setPrioDraft(item.priority || "");
    setDueDraft(item.due_date || "");
    setRecurDraft(!!item.is_recurring);
    setEditing(true);
  };
  const saveEdit = () => {
    if (!titleDraft.trim()) { ctx.notify("Title can't be empty"); return; }
    run(async () => {
      await api.updateItem(item.id, {
        title: titleDraft.trim(),
        description: descDraft,
        project_id: projDraft || null,
        priority: prioDraft || null,
        due_date: dueDraft || null,
        is_recurring: recurDraft,
      });
      await api.setItemContacts(item.id, contactsDraft);
      await api.setItemLocations(item.id, locsDraft);
      await api.logActivity(item.id, me, "Edited details");
      setEditing(false); ctx.notify("Item updated");
    });
  };
  const startSideEdit = () => {
    setProjDraft(item.project_id || "");
    setContactsDraft(item.contact_ids || []);
    setLocsDraft(item.location_ids || []);
    setPrioDraft(item.priority || "");
    setDueDraft(item.due_date || "");
    setAsgDraft(item.assigned_to || "nicole");
    setSideEdit(true);
  };
  const saveSide = () => run(async () => {
    await api.updateItem(item.id, {
      project_id: projDraft || null,
      priority: prioDraft || null,
      due_date: dueDraft || null,
      assigned_to: asgDraft || "nicole",
    });
    await api.setItemContacts(item.id, contactsDraft);
    await api.setItemLocations(item.id, locsDraft);
    await api.logActivity(item.id, me, "Edited details");
    setSideEdit(false); ctx.notify("Details updated");
  });

  // lifecycle actions — available to both roles, driven by state
  const actions = [];
  if (item.status === "open") actions.push(<button key="s" className="btn green" disabled={busy} onClick={() => doStatus("in_progress", "Started work")}><Ico d={I.check} /> Start work</button>);
  if (item.status === "in_progress") actions.push(<button key="c" className="btn green" disabled={busy} onClick={() => doStatus("pending_review", "Marked complete")}><Ico d={I.check} /> Mark complete</button>);
  if (item.status === "follow_up") actions.push(<button key="r" className="btn green" disabled={busy} onClick={() => doStatus("in_progress", "Resumed work")}><Ico d={I.check} /> Resume work</button>);
  // "Ask a question" lives in the comment composer below (so it isn't duplicated up here).
  if (item.status === "awaiting_principal") actions.push(<button key="an" className="btn primary" onClick={() => answerRef.current?.focus()}><Ico d={I.pencil} /> Answer below</button>);
  if (item.status === "pending_review") {
    if (isPrincipal) actions.push(<button key="ac" className="btn green" disabled={busy} onClick={() => doStatus("closed", "Reviewed & closed")}><Ico d={I.check} /> Accept & close</button>);
    actions.push(<button key="fu" className="btn amber" disabled={busy} onClick={doFollowup}><Ico d={I.loop} /> Request follow-up</button>);
  }
  if (item.status === "closed" && isPrincipal) actions.push(<button key="re" className="btn" disabled={busy} onClick={() => doStatus("follow_up", "Reopened")}><Ico d={I.loop} /> Reopen</button>);

  // direct status override (Nicole can't set/leave "closed")
  const statusOptions = isPrincipal ? Object.keys(STATES) : Object.keys(STATES).filter((s) => s !== "closed");
  const canSetStatus = isPrincipal || item.status !== "closed";
  const setStatusDirect = (to) => { if (to !== item.status) doStatus(to, "Status changed to " + STATES[to].label); };
  // for email items the body shows in the attached card — only show the description if it differs (i.e. you've added notes)
  const showDesc = item.description && item.description.trim() &&
    !(item.source === "email" && item.description.trim() === (item.email_body || "").trim());

  let banner = null;
  if (item.status === "awaiting_principal")
    banner = <div className="banner warn"><Ico d={I.flag} /> A question was raised — answer it below to resume the work.</div>;
  else if (item.status === "pending_review")
    banner = <div className="banner review"><Ico d={I.check} /> Marked complete — ready for review.</div>;
  else if (item.status === "follow_up")
    banner = <div className="banner warn"><Ico d={I.loop} /> Follow-up requested — resume work to continue.</div>;

  const showAnswer = item.status === "awaiting_principal";
  const canComment = item.status !== "closed" && !showAnswer;
  const canAsk = ["open", "in_progress", "follow_up"].includes(item.status);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <a className="btn ghost sm" onClick={ctx.goItems}>← Back to all items</a>
      </div>
      <div className="detail-wrap">
        <div className="panel">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StateBadge s={item.status} />{item.priority && <span className={"pri-dot pri-" + item.priority} title={item.priority + " priority"} />}
            <div style={{ flex: 1 }} />
            {!editing && <button className="btn ghost sm" onClick={startEdit}><Ico d={I.pencil} /> Edit</button>}
            {!editing && isPrincipal && <button className="btn danger sm" disabled={busy} onClick={doDelete}><Ico d={I.trash} /> Delete</button>}
          </div>
          {editing ? (
            <div style={{ marginTop: 12 }}>
              <label className="fld">Title</label>
              <input type="text" style={{ width: "100%" }} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} placeholder="A clear task name…" />
              <label className="fld" style={{ marginTop: 14 }}>Description</label>
              <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} placeholder="Details / context…" />
              <div className="form-grid" style={{ marginTop: 14 }}>
                <div>
                  <label className="fld">Project</label>
                  <select value={projDraft} onChange={(e) => setProjDraft(e.target.value)}>
                    <option value="">— none —</option>
                    {[...projects].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="full">
                  <label className="fld">Contacts</label>
                  <ChipMulti options={contacts} selected={contactsDraft} onToggle={toggleDraft(setContactsDraft)} empty="No contacts yet" />
                </div>
                <div className="full">
                  <label className="fld">Locations</label>
                  <ChipMulti options={locations} selected={locsDraft} onToggle={toggleDraft(setLocsDraft)} empty="No locations yet" />
                </div>
                <div>
                  <label className="fld">Priority</label>
                  <select value={prioDraft} onChange={(e) => setPrioDraft(e.target.value)}>
                    <option value="">— blank —</option>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="fld">Due date</label>
                  <input type="date" className="datepick" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker && e.currentTarget.showPicker()} />
                </div>
                <div className="full">
                  <label className="chk"><input type="checkbox" checked={recurDraft} onChange={(e) => setRecurDraft(e.target.checked)} /> Recurring — set this up regularly</label>
                </div>
              </div>
              <div className="actions">
                <button className="btn primary" disabled={busy} onClick={saveEdit}><Ico d={I.check} /> Save</button>
                <button className="btn ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
              </div>
              <div className="hint">The original email stays attached below for reference.</div>
            </div>
          ) : (
            <>
              <h3>{item.title}{item.is_recurring && <span className="tag recur" style={{ marginLeft: 8, verticalAlign: "middle" }}><Ico d={I.loop} />Recurring</span>}</h3>
              <div className="muted">Created by {profileFor(item.created_by, profiles).name} · {ago(item.created_at)}</div>
              <Stepper status={item.status} onPick={canSetStatus ? setStatusDirect : null} isPrincipal={isPrincipal} busy={busy} />
              {banner}
              <div className="actions">
                {actions}
              </div>
              {showDesc && <div className="desc">{item.description}</div>}
            </>
          )}
          {item.source === "email" && <EmailAttachment item={item} />}

          <div className="thread">
            <h4><Ico d={I.chat} /> Conversation</h4>
            {itemComments.length === 0 && <div className="muted" style={{ marginBottom: 14 }}>No comments yet.</div>}
            {itemComments.map((m) => (
              <div key={m.id} className={"msg " + m.type}>
                <Avatar k={m.author} size={30} profiles={profiles} />
                <div className="body">
                  <div className="who">{profileFor(m.author, profiles).name}
                    {m.type === "question" && <span className="lbl q">Question</span>}
                    {m.type === "answer" && <span className="lbl a">Answer</span>}
                  </div>
                  {editId === m.id ? (
                    <div className="editmsg">
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} autoFocus />
                      <div className="row">
                        <button className="btn sm" disabled={busy} onClick={saveEditMsg}><Ico d={I.check} /> Save</button>
                        <button className="btn ghost sm" disabled={busy} onClick={cancelEditMsg}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mbody">{m.body}</div>
                  )}
                  <div className="t">{ago(m.created_at)}{m.edited_at ? " · edited" : ""}
                    {m.author === me && editId !== m.id && (
                      <button className="linkbtn" onClick={() => startEditMsg(m)}>Edit</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {showAnswer && (
              <div className="composer">
                <textarea ref={answerRef} value={answer} onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer — this resumes Nicole's work…" />
                <div className="row"><button className="btn green" disabled={busy} onClick={doAnswer}><Ico d={I.check} /> Send answer &amp; resume</button></div>
              </div>
            )}
            {canComment && (
              <div className="composer">
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" />
                <div className="row">
                  <button className="btn has-tip" disabled={busy} onClick={doComment} data-tip="Adds a note to the conversation. It doesn't change the status or ask for a reply.">Comment</button>
                  {canAsk && <button className="btn amber has-tip" disabled={busy} onClick={doAsk} data-tip={"Sends this as a question to " + (isPrincipal ? "Nicole" : "Stephane") + " — the item pauses until they answer."}><Ico d={I.flag} /> Ask a question instead</button>}
                </div>
              </div>
            )}
          </div>
          {isPrincipal && (
            <div className="privnote">
              <h4>Private note <span className="tag-private">only you</span></h4>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="A private note only you can see…" />
              <div className="actions">
                <button className="btn" disabled={noteSaving} onClick={saveNote}>Save note</button>
                <label className="btn" style={{ cursor: "pointer" }}>
                  <Ico d={I.add} /> Attach file
                  <input type="file" style={{ display: "none" }} onChange={onPickFile} disabled={uploading} />
                </label>
                {uploading && <span className="muted" style={{ fontSize: 12 }}>Uploading…</span>}
              </div>
              {noteFiles.length > 0 && (
                <div className="notefiles">
                  {noteFiles.map((f) => (
                    <div key={f.id} className="notefile">
                      <span className="nf-name" title={f.file_name}>{f.file_name}</span>
                      <button className="linkbtn nf-act" onClick={() => downloadNoteFile(f)}>Download</button>
                      <button className="linkbtn nf-act" onClick={() => openNoteFile(f)}>Open</button>
                      <button className="linkbtn" onClick={() => removeNoteFile(f)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="side-h">Details
            <span style={{ flex: 1 }} />
            {!sideEdit
              ? <button className="linkbtn" onClick={startSideEdit}>Edit</button>
              : <button className="linkbtn" onClick={() => setSideEdit(false)}>Cancel</button>}
          </div>
          {sideEdit ? (
            <>
              <div className="kv"><span className="k">Assigned to</span><span className="v">
                <select value={asgDraft} onChange={(e) => setAsgDraft(e.target.value)}>
                  <option value="nicole">Nicole Sciacca</option><option value="stephane">Stephane Chatonsky</option>
                </select></span></div>
              <div className="kv"><span className="k">Project</span><span className="v">
                <select value={projDraft} onChange={(e) => setProjDraft(e.target.value)}>
                  <option value="">— none —</option>{[...projects].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></span></div>
              <div className="kv col"><span className="k">Contacts</span>
                <ChipMulti options={contacts} selected={contactsDraft} onToggle={toggleDraft(setContactsDraft)} empty="No contacts yet" /></div>
              <div className="kv col"><span className="k">Locations</span>
                <ChipMulti options={locations} selected={locsDraft} onToggle={toggleDraft(setLocsDraft)} empty="No locations yet" /></div>
              <div className="kv"><span className="k">Priority</span><span className="v">
                <select value={prioDraft} onChange={(e) => setPrioDraft(e.target.value)}>
                  <option value="">— blank —</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                </select></span></div>
              <div className="kv"><span className="k">Due</span><span className="v">
                <input type="date" className="datepick" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)}
                  onClick={(e) => e.currentTarget.showPicker && e.currentTarget.showPicker()} /></span></div>
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn primary sm" disabled={busy} onClick={saveSide}><Ico d={I.check} /> Save</button>
              </div>
            </>
          ) : (
            <>
              <div className="kv"><span className="k">With</span><span className="v">{profileFor(owner || item.assigned_to, profiles).name}</span></div>
              {proj && <div className="kv"><span className="k">Project</span><span className="v"><span className="tag"><span className="pdot" style={{ background: proj.color }} />{proj.name}</span></span></div>}
              {itemContacts.length > 0 && <div className="kv"><span className="k">Contacts</span><span className="v">{itemContacts.map((c) => c.name).join(", ")}</span></div>}
              {itemLocations.length > 0 && <div className="kv"><span className="k">Locations</span><span className="v">{itemLocations.map((l) => l.name).join(", ")}</span></div>}
              {item.due_date && <div className="kv"><span className="k">Due</span><span className="v">{item.due_date}</span></div>}
            </>
          )}
          <div className="kv"><span className="k">Source</span><span className="v">{item.source === "email" ? (safeUrl(item.source_email_url) ? <a href={safeUrl(item.source_email_url)} target="_blank" rel="noreferrer">Open in Mail ↗</a> : "Email") : "Created manually"}</span></div>
          <div className="act-feed">
            <div className="side-h">Activity</div>
            {ctx.activity.filter((a) => a.action_item_id === item.id).map((a) => (
              <div key={a.id} className="act-row"><span className="ad" /><div>{a.change}<div className="muted">{ago(a.created_at)}</div></div></div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* The original email, attached to email-sourced items */
function EmailAttachment({ item }) {
  const body = item.email_body || "";
  const when = item.email_date ? new Date(item.email_date).toLocaleString() : "";
  // Collapsed by default on phones so the conversation is what you see first.
  const [open, setOpen] = useState(() => { try { return !window.matchMedia("(max-width:760px)").matches; } catch (e) { return true; } });
  return (
    <div className={"email-card" + (open ? "" : " collapsed")}>
      <div className="email-head email-toggle" onClick={() => setOpen(!open)}>
        <span className="email-ico"><Ico d={I.mail} /></span>
        <div className="grow">
          <div className="email-subj">{item.email_subject || item.title}</div>
          <div className="email-meta">
            From {item.email_from || "—"}{when ? " · " + when : ""}
          </div>
        </div>
        {safeUrl(item.source_email_url) && (
          <a className="btn ghost sm" href={safeUrl(item.source_email_url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open in Mail ↗</a>
        )}
        <span className={"email-tw" + (open ? " open" : "")}><Ico d={I.chev} /></span>
      </div>
      {open && body && <div className="email-body">{body}</div>}
      {open && <div className="email-foot">Original email · attached automatically when the “GTD” label was applied</div>}
    </div>
  );
}

/* ============================================================
   New item
   ============================================================ */
function NewItem({ ctx }) {
  const { projects, contacts, locations, me } = ctx;
  const [form, setForm] = useState({ title: "", description: "", project_id: "", contact_ids: [], location_ids: [], priority: "normal", due_date: "", assigned_to: "nicole", is_recurring: false });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });
  const toggle = (k, id) => setForm((f) => ({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }));

  const create = async () => {
    if (!form.title.trim()) { ctx.notify("Give the item a title"); return; }
    setBusy(true);
    const fields = {
      title: form.title.trim(),
      description: form.description.trim(),
      project_id: form.project_id || null,
      contact_ids: form.contact_ids,
      location_ids: form.location_ids,
      priority: form.priority || null,
      due_date: form.due_date || null,
      is_recurring: form.is_recurring,
      created_by: me,
      assigned_to: form.assigned_to,
    };
    const { data, error } = await api.createItem(fields, me);
    setBusy(false);
    if (error) { ctx.notify("Could not create: " + error.message); return; }
    await ctx.reload();
    ctx.notify("Item created");
    if (data) ctx.open(data.id);
  };

  return (
    <>
      <div className="page-head"><div><h2>New Item</h2><div className="sub">Create an action item manually</div></div></div>
      <div className="panel" style={{ maxWidth: 780 }}>
        <div className="form-grid">
          <div className="full"><label className="fld">Title</label><input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Book the boardroom for Thursday" /></div>
          <div className="full"><label className="fld">Description</label><textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Details for Nicole…" /></div>
          <div><label className="fld">Project</label>
            <select value={form.project_id} onChange={(e) => set("project_id", e.target.value)}>
              <option value="">— none —</option>{[...projects].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="full"><label className="fld">Contacts</label>
            <ChipMulti options={contacts} selected={form.contact_ids} onToggle={(id) => toggle("contact_ids", id)} empty="No contacts yet" />
          </div>
          <div className="full"><label className="fld">Locations</label>
            <ChipMulti options={locations} selected={form.location_ids} onToggle={(id) => toggle("location_ids", id)} empty="No locations yet" />
          </div>
          <div><label className="fld">Priority (optional)</label>
            <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="">— blank —</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select></div>
          <div><label className="fld">Due date (optional)</label><input type="date" className="datepick" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} onClick={(e) => e.currentTarget.showPicker && e.currentTarget.showPicker()} /></div>
          <div className="full"><label className="fld">Assign to</label>
            <select value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
              <option value="nicole">Nicole Sciacca</option><option value="stephane">Stephane (myself)</option>
            </select></div>
          <div className="full"><label className="chk"><input type="checkbox" checked={form.is_recurring} onChange={(e) => set("is_recurring", e.target.checked)} /> Recurring — set this up regularly</label></div>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={create}><Ico d={I.add} /> Create item</button>
          <button className="btn ghost" onClick={ctx.goItems}>Cancel</button>
        </div>
        <div className="hint">Manually-created items start in <b>Open</b>, assigned to Nicole.</div>
      </div>
    </>
  );
}

/* ============================================================
   Projects (principal only)
   ============================================================ */
function Projects({ ctx }) {
  const { projects, items, contacts, isPrincipal } = ctx;
  const [sort, setSort] = useState("custom");
  const [view, setView] = useView("gtd-proj-view");
  const openCount = (id) => items.filter((i) => i.project_id === id && i.status !== "closed").length;
  const contactsFor = (pid) => {
    const ids = [...new Set(items.filter((i) => i.project_id === pid).flatMap((i) => i.contact_ids || []))];
    return ids.map((id) => contacts.find((c) => c.id === id)).filter(Boolean);
  };
  const reorder = async (arr) => { await Promise.all(arr.map((p, i) => api.updateProjectOrder(p.id, i + 1))); await ctx.reload(); };
  const [dragId, setDragId] = useState(null);
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const arr = projects.slice();
    const from = arr.findIndex((x) => x.id === dragId), to = arr.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m); reorder(arr); setDragId(null);
  };
  const add = async () => {
    const name = window.prompt("New project name:");
    if (!name || !name.trim()) return;
    const colors = ["#3B6CF0", "#0E9F6E", "#B45309", "#7C3AED", "#E11D48", "#0EA5E9"];
    await api.createProject(name.trim(), colors[projects.length % colors.length]);
    await ctx.reload(); ctx.notify("Project added");
  };
  const rename = async (p) => {
    const name = window.prompt("Rename project:", p.name);
    if (name && name.trim()) { await api.renameProject(p.id, name.trim()); await ctx.reload(); }
  };
  const del = async (p) => {
    if (!window.confirm(`Delete the project "${p.name}"? Its items are kept but will no longer be tagged with this project.`)) return;
    const { error } = await api.deleteProject(p.id);
    if (error) { ctx.notify("Couldn't delete: " + error.message); return; }
    await ctx.reload(); ctx.notify("Project deleted");
  };
  const list = (() => {
    let l = projects.slice();
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "count") l.sort((a, b) => openCount(b.id) - openCount(a.id));
    return l;
  })();
  return (
    <>
      <div className="page-head"><div><h2>Projects</h2><div className="sub">Group action items by project</div></div><div className="spacer" />
        <ViewToggle view={view} setView={setView} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ marginRight: 8 }}>
          <option value="custom">Custom order</option>
          <option value="name">Name A–Z</option>
          <option value="count">Most items</option>
        </select>
        <button className="btn primary" onClick={add}><Ico d={I.add} /> New project</button></div>
      {view === "cards" ? (
        <div className="dir-cards">
          {list.map((p) => {
            const n = openCount(p.id); const cs = contactsFor(p.id);
            return (
              <div key={p.id} className="dir-card">
                <div className="dc-head">
                  <span className="pc" style={{ background: p.color }} />
                  <span className="dc-name" onClick={() => ctx.goFiltered({ project: p.id })} title="View items">{p.name}</span>
                  <button className="iconbtn" title="Rename" aria-label="Rename" onClick={() => rename(p)}><Ico d={I.pencil} /></button>
                  {isPrincipal && <button className="iconbtn danger" title="Delete" aria-label="Delete" onClick={() => del(p)}><Ico d={I.trash} /></button>}
                </div>
                <div className="dc-foot">
                  <span className="countchip">{n} open</span>
                  {cs.slice(0, 3).map((c) => <span key={c.id} className="tag">{c.name}</span>)}
                  {cs.length > 3 && <span className="tag">+{cs.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="group">
          {list.map((p) => {
            const n = openCount(p.id);
            return (
              <div key={p.id} className={"proj-row" + (dragId === p.id ? " dragging" : "")}
                draggable={sort === "custom"}
                onDragStart={() => sort === "custom" && setDragId(p.id)}
                onDragOver={(e) => { if (sort === "custom") e.preventDefault(); }}
                onDrop={() => onDrop(p.id)}>
                {sort === "custom" && <span className="grip" title="Drag to reorder"><Ico d={I.grip} /></span>}
                <span className="pc" style={{ background: p.color }} />
                <span className="row-open" onClick={() => ctx.goFiltered({ project: p.id })} title="View items">
                  <b>{p.name}</b><span className="countchip">{n} open</span>
                </span>
                <span className="mini-tags">
                  {contactsFor(p.id).map((c) => <span key={c.id} className="tag">{c.name}</span>)}
                </span>
                <div style={{ flex: 1 }} />
                <button className="iconbtn" title="Rename" aria-label="Rename" onClick={() => rename(p)}><Ico d={I.pencil} /></button>
                {isPrincipal && <button className="iconbtn danger" title="Delete" aria-label="Delete" onClick={() => del(p)}><Ico d={I.trash} /></button>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ============================================================
   Contacts (same rights model as Projects)
   ============================================================ */
function Contacts({ ctx }) {
  const { contacts, items, projects, isPrincipal } = ctx;
  const [sort, setSort] = useState("custom");
  const [showEmpty, setShowEmpty] = useState(false);
  const [view, setView] = useView("gtd-contact-view");
  const openCount = (id) => items.filter((i) => (i.contact_ids || []).includes(id) && i.status !== "closed").length;
  const totalCount = (id) => items.filter((i) => (i.contact_ids || []).includes(id)).length;
  const hiddenCount = contacts.filter((c) => totalCount(c.id) === 0).length;
  const projsFor = (cid) => {
    const ids = [...new Set(items.filter((i) => (i.contact_ids || []).includes(cid)).map((i) => i.project_id).filter(Boolean))];
    return ids.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
  };
  // Colour the contact by its related project (first one), falling back to a per-contact colour.
  const colorOf = (c) => { const ps = projsFor(c.id); return ps.length ? ps[0].color : colorFor(c.id); };
  const reorder = async (arr) => { await Promise.all(arr.map((c, i) => api.updateContactOrder(c.id, i + 1))); await ctx.reload(); };
  const [dragId, setDragId] = useState(null);
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const arr = contacts.slice();
    const from = arr.findIndex((x) => x.id === dragId), to = arr.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m); reorder(arr); setDragId(null);
  };
  const add = async () => {
    const name = window.prompt("Contact name:");
    if (!name || !name.trim()) return;
    const email = window.prompt("Email (optional):") || "";
    const { error } = await api.createContact(name.trim(), email.trim());
    if (error) { ctx.notify("Couldn't add: " + error.message); return; }
    await ctx.reload(); ctx.notify("Contact added");
  };
  const edit = async (c) => {
    const name = window.prompt("Contact name:", c.name);
    if (name === null) return;
    const email = window.prompt("Email:", c.email || "");
    if (email === null) return;
    const { error } = await api.updateContact(c.id, { name: name.trim() || c.name, email: email.trim() || null });
    if (error) { ctx.notify("Couldn't save: " + error.message); return; }
    await ctx.reload(); ctx.notify("Contact updated");
  };
  const del = async (c) => {
    if (!window.confirm(`Delete the contact "${c.name}"? Items are kept but lose this contact tag.`)) return;
    const { error } = await api.deleteContact(c.id);
    if (error) { ctx.notify("Couldn't delete: " + error.message); return; }
    await ctx.reload(); ctx.notify("Contact deleted");
  };
  const list = (() => {
    let l = contacts.slice();
    if (!showEmpty) l = l.filter((c) => totalCount(c.id) > 0);
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "count") l.sort((a, b) => openCount(b.id) - openCount(a.id));
    return l;
  })();
  const hiddenToggle = hiddenCount > 0 && (
    <button className="btn ghost sm" style={{ margin: "10px 12px" }} onClick={() => setShowEmpty(!showEmpty)}>
      {showEmpty ? "Hide" : "Show"} {hiddenCount} contact{hiddenCount === 1 ? "" : "s"} with no actions
    </button>
  );
  return (
    <>
      <div className="page-head"><div><h2>Contacts</h2><div className="sub">People &amp; companies your items relate to</div></div><div className="spacer" />
        <ViewToggle view={view} setView={setView} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ marginRight: 8 }}>
          <option value="custom">Custom order</option>
          <option value="name">Name A–Z</option>
          <option value="count">Most items</option>
        </select>
        <button className="btn primary" onClick={add}><Ico d={I.add} /> New contact</button></div>
      {view === "cards" ? (
        <>
          <div className="dir-cards">
            {contacts.length === 0 && <div className="empty">No contacts yet.</div>}
            {list.map((c) => {
              const n = openCount(c.id); const ps = projsFor(c.id);
              return (
                <div key={c.id} className="dir-card">
                  <div className="dc-head">
                    <span className="dc-avatar" style={{ background: colorOf(c) }}>{initials(c.name)}</span>
                    <span className="dc-person" onClick={() => ctx.goFiltered({ contact: c.id })} title="View items">
                      <span className="dc-name">{c.name}</span>
                      {c.email && <span className="dc-sub">{c.email}</span>}
                    </span>
                    <button className="iconbtn" title="Edit" aria-label="Edit" onClick={() => edit(c)}><Ico d={I.pencil} /></button>
                    {isPrincipal && <button className="iconbtn danger" title="Delete" aria-label="Delete" onClick={() => del(c)}><Ico d={I.trash} /></button>}
                  </div>
                  <div className="dc-foot">
                    <span className="countchip">{n} open</span>
                    {ps.map((p) => <span key={p.id} className="tag"><span className="pdot" style={{ background: p.color }} />{p.name}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
          {hiddenToggle}
        </>
      ) : (
        <div className="group">
          {contacts.length === 0 && <div className="empty">No contacts yet.</div>}
          {list.map((c) => {
            const n = openCount(c.id);
            return (
              <div key={c.id} className={"proj-row" + (dragId === c.id ? " dragging" : "")}
                draggable={sort === "custom"}
                onDragStart={() => sort === "custom" && setDragId(c.id)}
                onDragOver={(e) => { if (sort === "custom") e.preventDefault(); }}
                onDrop={() => onDrop(c.id)}>
                {sort === "custom" && <span className="grip" title="Drag to reorder"><Ico d={I.grip} /></span>}
                <span className="pc" style={{ background: colorOf(c), borderRadius: "50%" }} />
                <span className="row-open" onClick={() => ctx.goFiltered({ contact: c.id })} title="View items">
                  <b>{c.name}</b>
                  {c.email && <span className="badge-mini">{c.email}</span>}
                  <span className="countchip">{n} open</span>
                </span>
                <span className="mini-tags">
                  {projsFor(c.id).map((p) => (
                    <span key={p.id} className="tag"><span className="pdot" style={{ background: p.color }} />{p.name}</span>
                  ))}
                </span>
                <div style={{ flex: 1 }} />
                <button className="iconbtn" title="Edit" aria-label="Edit" onClick={() => edit(c)}><Ico d={I.pencil} /></button>
                {isPrincipal && <button className="iconbtn danger" title="Delete" aria-label="Delete" onClick={() => del(c)}><Ico d={I.trash} /></button>}
              </div>
            );
          })}
          {hiddenToggle}
        </div>
      )}
    </>
  );
}

/* ============================================================
   Locations (same rights model as Projects/Contacts)
   ============================================================ */
function Locations({ ctx }) {
  const { locations, items, isPrincipal } = ctx;
  const [sort, setSort] = useState("custom");
  const [view, setView] = useView("gtd-loc-view");
  const openCount = (id) => items.filter((i) => (i.location_ids || []).includes(id) && i.status !== "closed").length;
  const reorder = async (arr) => { await Promise.all(arr.map((l, i) => api.updateLocationOrder(l.id, i + 1))); await ctx.reload(); };
  const [dragId, setDragId] = useState(null);
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const arr = locations.slice();
    const from = arr.findIndex((x) => x.id === dragId), to = arr.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m); reorder(arr); setDragId(null);
  };
  const add = async () => {
    const name = window.prompt("Location name:");
    if (!name || !name.trim()) return;
    const { error } = await api.createLocation(name.trim());
    if (error) { ctx.notify("Couldn't add: " + error.message); return; }
    await ctx.reload(); ctx.notify("Location added");
  };
  const edit = async (l) => {
    const name = window.prompt("Location name:", l.name);
    if (name === null || !name.trim()) return;
    const { error } = await api.updateLocation(l.id, { name: name.trim() });
    if (error) { ctx.notify("Couldn't save: " + error.message); return; }
    await ctx.reload(); ctx.notify("Location updated");
  };
  const del = async (l) => {
    if (!window.confirm(`Delete the location "${l.name}"? Items are kept but lose this location tag.`)) return;
    const { error } = await api.deleteLocation(l.id);
    if (error) { ctx.notify("Couldn't delete: " + error.message); return; }
    await ctx.reload(); ctx.notify("Location deleted");
  };
  const list = (() => {
    let l = locations.slice();
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "count") l.sort((a, b) => openCount(b.id) - openCount(a.id));
    return l;
  })();
  return (
    <>
      <div className="page-head"><div><h2>Locations</h2><div className="sub">Where items take place</div></div><div className="spacer" />
        <ViewToggle view={view} setView={setView} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ marginRight: 8 }}>
          <option value="custom">Custom order</option>
          <option value="name">Name A–Z</option>
          <option value="count">Most items</option>
        </select>
        <button className="btn primary" onClick={add}><Ico d={I.add} /> New location</button></div>
      {view === "cards" ? (
        <div className="dir-cards">
          {locations.length === 0 && <div className="empty">No locations yet.</div>}
          {list.map((l) => {
            const n = openCount(l.id);
            return (
              <div key={l.id} className="dir-card">
                <div className="dc-head">
                  <span className="pc" style={{ background: colorFor(l.id), borderRadius: "50%" }} />
                  <span className="dc-name" onClick={() => ctx.goFiltered({ location: l.id })} title="View items">{l.name}</span>
                  <button className="iconbtn" title="Edit" aria-label="Edit" onClick={() => edit(l)}><Ico d={I.pencil} /></button>
                  {isPrincipal && <button className="iconbtn danger" title="Delete" aria-label="Delete" onClick={() => del(l)}><Ico d={I.trash} /></button>}
                </div>
                <div className="dc-foot"><span className="countchip">{n} open</span></div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="group">
          {locations.length === 0 && <div className="empty">No locations yet.</div>}
          {list.map((l) => {
            const n = openCount(l.id);
            return (
              <div key={l.id} className={"proj-row" + (dragId === l.id ? " dragging" : "")}
                draggable={sort === "custom"}
                onDragStart={() => sort === "custom" && setDragId(l.id)}
                onDragOver={(e) => { if (sort === "custom") e.preventDefault(); }}
                onDrop={() => onDrop(l.id)}>
                {sort === "custom" && <span className="grip" title="Drag to reorder"><Ico d={I.grip} /></span>}
                <span className="pc" style={{ background: colorFor(l.id), borderRadius: "50%" }} />
                <span className="row-open" onClick={() => ctx.goFiltered({ location: l.id })} title="View items">
                  <b>{l.name}</b>
                  <span className="countchip">{n} open</span>
                </span>
                <div style={{ flex: 1 }} />
                <button className="iconbtn" title="Edit" aria-label="Edit" onClick={() => edit(l)}><Ico d={I.pencil} /></button>
                {isPrincipal && <button className="iconbtn danger" title="Delete" aria-label="Delete" onClick={() => del(l)}><Ico d={I.trash} /></button>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ============================================================
   Activity
   ============================================================ */
function Activity({ ctx }) {
  const { activity, items, profiles } = ctx;
  return (
    <>
      <div className="page-head"><div><h2>Activity</h2><div className="sub">Everything that's happened, newest first</div></div></div>
      <div className="group timeline">
        {activity.length === 0 && <div className="empty"><span className="empty-ic"><Ico d={I.activity} /></span>Nothing has happened yet.</div>}
        {activity.map((a) => {
          const it = items.find((i) => i.id === a.action_item_id);
          const who = a.actor === "system" ? "System" : profileFor(a.actor, profiles).name;
          return (
            <div key={a.id} className="tl-row" onClick={() => it && ctx.open(it.id)}>
              <span className="tl-dot" />
              <div className="tl-body">
                <div className="ttl">{a.change}</div>
                <div className="meta">{it ? it.title : "—"}<span className="muted">{who} · {ago(a.created_at)}</span></div>
              </div>
              {it && <StateBadge s={it.status} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   Audit log (Principal only): access sessions + activity
   ============================================================ */
function Audit({ ctx }) {
  const { profiles, items, activity, me } = ctx;
  const [sessions, setSessions] = useState(null);
  useEffect(() => { api.listSessions().then(setSessions); }, []);
  const shown = sessions ? sessions.filter((s) => s.user_key !== me) : null; // hide your own sessions
  const fmtDur = (a, b) => {
    const min = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
    if (min < 1) return "under a minute";
    if (min < 60) return min + " min";
    const h = Math.floor(min / 60);
    return h + "h " + (min % 60) + "m";
  };
  return (
    <>
      <div className="page-head"><div><h2>Audit log</h2><div className="sub">Access sessions and activity — visible to you only</div></div></div>

      <div className="group">
        <div className="group-head"><span className="gi"><Ico d={I.clock} /></span>Access sessions<span className="count">{shown ? shown.length : "…"}</span></div>
        {shown === null && <div className="empty">Loading…</div>}
        {shown && shown.length === 0 && <div className="empty">No sessions recorded yet.</div>}
        {shown && shown.map((s) => (
          <div key={s.id} className="item" style={{ cursor: "default" }}>
            <Avatar k={s.user_key} size={30} profiles={profiles} />
            <div className="grow">
              <div className="ttl">{profileFor(s.user_key, profiles).name}</div>
              <div className="meta">{new Date(s.started_at).toLocaleString()}<span className="muted">active {fmtDur(s.started_at, s.last_seen_at)}</span></div>
            </div>
            <span className="muted">{ago(s.last_seen_at)}</span>
          </div>
        ))}
      </div>

      <div className="group">
        <div className="group-head"><span className="gi"><Ico d={I.activity} /></span>Activity<span className="count">{activity.length}</span></div>
        {activity.map((a) => {
          const it = items.find((i) => i.id === a.action_item_id);
          const who = a.actor === "system" ? "System" : profileFor(a.actor, profiles).name;
          return (
            <div key={a.id} className="item" onClick={() => it && ctx.open(it.id)}>
              <div className="grow"><div className="ttl">{a.change}</div>
                <div className="meta">{it ? it.title : "—"}<span className="muted">{who} · {ago(a.created_at)}</span></div></div>
              {it && <StateBadge s={it.status} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   Profiles (each user edits their own photo)
   ============================================================ */
function Profiles({ ctx }) {
  const { profiles, me } = ctx;
  const [busy, setBusy] = useState(false);
  const keys = ["stephane", "nicole"];

  const onFile = async (key, input) => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { ctx.notify("Please choose an image file"); return; }
    const prof = profiles.find((p) => p.user_key === key);
    if (!prof) { ctx.notify("Profile not found"); return; }
    setBusy(true);
    const { error } = await api.uploadAvatar(prof, f);
    setBusy(false);
    if (error) { ctx.notify("Upload failed: " + error.message); return; }
    await ctx.reload(); ctx.notify("Photo updated");
  };
  const remove = async (key) => {
    const prof = profiles.find((p) => p.user_key === key);
    if (!prof) return;
    await api.removeAvatar(prof); await ctx.reload(); ctx.notify("Photo removed");
  };

  return (
    <>
      <div className="page-head"><div><h2>Profiles</h2><div className="sub">Add a photo — it shows on the dashboard, lists, and conversations.</div></div></div>
      <div className="group">
        {keys.map((key) => {
          const p = profileFor(key, profiles);
          const mine = key === me;
          const has = !!p.avatar_url;
          return (
            <div key={key} className="profile-card">
              <label className="pi" htmlFor={mine ? "file-" + key : undefined} style={{ cursor: mine ? "pointer" : "default" }}>
                <Avatar k={key} size={64} profiles={profiles} />
                {mine && <span className="cam"><Ico d={I.camera} /></span>}
              </label>
              {mine && <input id={"file-" + key} type="file" accept="image/*" className="hidden-file" disabled={busy} onChange={(e) => onFile(key, e.target)} />}
              <div className="grow">
                <div className="nm">{p.name}</div>
                <div className="rl">
                  <span className={"role-badge " + (p.role === "principal" ? "rb-principal" : "rb-assistant")}>{p.role === "principal" ? "Principal" : "Assistant"}</span>
                  {mine && <span className="muted" style={{ marginLeft: 8 }}>you</span>}
                </div>
              </div>
              {mine ? (
                <>
                  <label className="btn sm" htmlFor={"file-" + key} style={{ cursor: "pointer" }}><Ico d={I.camera} /> {has ? "Change" : "Upload"} photo</label>
                  {has && <button className="btn ghost sm" onClick={() => remove(key)}>Remove</button>}
                </>
              ) : (
                <span className="muted">Only {p.name.split(" ")[0]} can change this</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="hint">Photos are stored in your Supabase project's <b>avatars</b> storage bucket. Each person can only change their own.</div>
    </>
  );
}

/* ============================================================
   Login
   ============================================================ */
function Login({ notify }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await api.signIn(email.trim(), pw);
    setBusy(false);
    if (error) setErr(error.message);
  };
  return (
    <div className="center-wrap">
      <form className="login" onSubmit={submit}>
        <div className="logo"><img src={logoUrl} alt="Ivest" /></div>
        <h1>Interactive GTD</h1>
        <p>Sign in to your workspace.</p>
        <label className="fld">Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ivest.com.au" />
        <label className="fld">Password</label>
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

/* ============================================================
   Config warning (missing .env)
   ============================================================ */
function ConfigWarning() {
  return (
    <div className="config-warn">
      <h2>Almost there — connect Supabase</h2>
      <p>This app needs your Supabase project keys. Copy <code>.env.example</code> to <code>.env</code>, fill in
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.</p>
      <p className="muted">Full steps are in the README.</p>
    </div>
  );
}
