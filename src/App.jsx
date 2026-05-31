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

/* ============================================================
   Root
   ============================================================ */
export default function App() {
  const [theme, setTheme] = useState("light");
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

  // ui
  const [view, setView] = useState("dashboard");
  const [currentId, setCurrentId] = useState(null);
  const [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [itemsStatus, setItemsStatus] = useState("all");
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

  // theme on mount
  useEffect(() => {
    let saved = "light";
    try { saved = localStorage.getItem("gtd-theme") || "light"; } catch {}
    applyTheme(saved);
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
    const [it, cm, pr, ct, ac, pf] = await Promise.all([
      api.listItems(), api.listComments(), api.listProjects(),
      api.listContacts(), api.listActivity(), api.listProfiles(),
    ]);
    setItems(it); setComments(cm); setProjects(pr);
    setContacts(ct); setActivity(ac); setProfiles(pf);
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
  if (booting) return <div className="app-loading">Loading…</div>;
  if (!session) return <Login notify={notify} />;
  if (!profile) return <div className="app-loading">Setting up your profile…</div>;

  const me = profile.user_key;          // 'stephane' | 'nicole'
  const isPrincipal = profile.role === "principal";
  const current = items.find((i) => i.id === currentId) || null;

  const ctx = {
    me, isPrincipal, profile, profiles, items, comments, projects, contacts, activity,
    notify, reload: loadData,
    open: (id) => { setCurrentId(id); setView("detail"); },
    goItems: (status) => { setCurrentId(null); setItemsStatus(status || "all"); setView("items"); },
    goNew: () => { setCurrentId(null); setView("new"); },
    initialStatus: itemsStatus,
  };

  const NAV = [
    { key: "dashboard", label: "Dashboard", icon: I.dashboard },
    { key: "items", label: "All Items", icon: I.items },
    { key: "new", label: "New Item", icon: I.add },
    { key: "projects", label: "Projects", icon: I.projects },
    { key: "contacts", label: "Contacts", icon: I.contacts },
    { key: "activity", label: "Activity", icon: I.activity },
    { key: "profiles", label: "Profiles", icon: I.user },
    ...(isPrincipal ? [{ key: "audit", label: "Audit log", icon: I.shield }] : []),
  ];
  const myQueue = items.filter((i) => ownerOf(i) === me).length;
  const titles = {
    dashboard: "Dashboard", items: "All Items", new: "New Item", projects: "Projects",
    activity: "Activity", profiles: "Profiles", audit: "Audit log", contacts: "Contacts",
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
              onClick={() => { setCurrentId(null); setView(n.key); setNavOpen(false); }}>
              <Ico d={n.icon} /><span>{n.label}</span>
              {n.key === "dashboard" && (
                <span className={"badge " + (myQueue ? "" : "zero")}>{myQueue}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sb-foot">
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

        <div className="content" key={view + (currentId || "")}>
          {view === "dashboard" && <Dashboard ctx={ctx} />}
          {view === "items" && <ItemsList ctx={ctx} />}
          {view === "detail" && current && <ItemDetail ctx={ctx} item={current} />}
          {view === "new" && <NewItem ctx={ctx} />}
          {view === "projects" && <Projects ctx={ctx} />}
          {view === "contacts" && <Contacts ctx={ctx} />}
          {view === "activity" && <Activity ctx={ctx} />}
          {view === "profiles" && <Profiles ctx={ctx} />}
          {view === "audit" && isPrincipal && <Audit ctx={ctx} />}
        </div>
      </div>

      <div className={"toast" + (toast ? " show" : "")}><span className="td" />{toast}</div>
    </div>
  );
}

/* ============================================================
   Item row + group
   ============================================================ */
function ItemRow({ it, ctx }) {
  const proj = ctx.projects.find((p) => p.id === it.project_id);
  const contact = ctx.contacts.find((c) => c.id === it.contact_id);
  return (
    <div className="item" onClick={() => ctx.open(it.id)}>
      <div className="grow">
        <div className="ttl">{it.title}</div>
        <div className="meta">
          <span className="src"><Ico d={it.source === "email" ? I.mail : I.pencil} /> {it.source}</span>
          {proj && <span className="tag"><span className="pdot" style={{ background: proj.color }} />{proj.name}</span>}
          {contact && <span className="muted">{contact.name}</span>}
          {it.due_date && <span className="muted">due {it.due_date}</span>}
          <span className="muted">{ago(it.updated_at)}</span>
        </div>
      </div>
      <Prio p={it.priority} />
      <StateBadge s={it.status} />
      <span className="chev"><Ico d={I.chev} /></span>
    </div>
  );
}
function Group({ title, icon, arr, ctx, empty }) {
  return (
    <div className="group">
      <div className="group-head"><span className="gi"><Ico d={icon} /></span>{title}<span className="count">{arr.length}</span></div>
      {arr.length ? arr.map((it) => <ItemRow key={it.id} it={it} ctx={ctx} />) : <div className="empty">{empty}</div>}
    </div>
  );
}

/* ============================================================
   Dashboard
   ============================================================ */
function Dashboard({ ctx }) {
  const { items, me, isPrincipal, profile } = ctx;
  const by = (s) => items.filter((i) => i.status === s);
  const Stat = ({ n, l, alert, to }) => (
    <div className={"stat " + (alert && n ? "alert " : "") + (to ? "clickable" : "")}
      onClick={to ? () => ctx.goItems(to) : undefined}>
      <div className="n">{n}</div><div className="l">{l}</div>
    </div>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{isPrincipal ? "Principal" : "Assistant"} workspace</div>
          <h2>Hello, {profile.name.split(" ")[0]}</h2>
          <div className="sub">Here's where things stand right now.</div>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => ctx.goNew()}>
          <Ico d={I.add} /> New item
        </button>
      </div>

      {isPrincipal ? (
        <>
          <div className="cards">
            <Stat n={by("awaiting_principal").length} l="Need my answer" alert to="awaiting_principal" />
            <Stat n={by("pending_review").length} l="To review" alert to="pending_review" />
            <Stat n={by("open").length + by("in_progress").length} l="With Nicole" to="in_progress" />
            <Stat n={by("closed").length} l="Closed" to="closed" />
          </div>
          <Group title="Needs my answer" icon={I.flag} arr={by("awaiting_principal")} ctx={ctx} empty="Nothing waiting on you right now." />
          <Group title="To review" icon={I.check} arr={by("pending_review")} ctx={ctx} empty="Nothing to review right now." />
          <Group title="In Nicole's hands" icon={I.dots} arr={items.filter((i) => ["open", "in_progress", "follow_up"].includes(i.status))} ctx={ctx} empty="Nothing in progress." />
        </>
      ) : (
        <>
          <div className="cards">
            <Stat n={by("open").length} l="To start" alert to="open" />
            <Stat n={by("in_progress").length} l="In progress" to="in_progress" />
            <Stat n={by("follow_up").length} l="Follow-ups" alert to="follow_up" />
            <Stat n={by("awaiting_principal").length} l="Waiting on Stephane" to="awaiting_principal" />
          </div>
          <Group title="To do" icon={I.circle} arr={by("open")} ctx={ctx} empty="Nothing new assigned." />
          <Group title="In progress" icon={I.dots} arr={by("in_progress")} ctx={ctx} empty="Nothing in progress." />
          <Group title="Follow-up from Stephane" icon={I.loop} arr={by("follow_up")} ctx={ctx} empty="No follow-ups." />
          <Group title="Waiting on Stephane" icon={I.clock} arr={by("awaiting_principal")} ctx={ctx} empty="Nothing waiting on Stephane." />
        </>
      )}
    </>
  );
}

/* ============================================================
   Items list
   ============================================================ */
function ItemsList({ ctx }) {
  const { items, projects, contacts } = ctx;
  const [f, setF] = useState({ status: ctx.initialStatus || "all", project: "all", contact: "all", source: "all", q: "" });
  let list = items.slice();
  if (f.status !== "all") list = list.filter((i) => i.status === f.status);
  if (f.project !== "all") list = list.filter((i) => i.project_id === f.project);
  if (f.contact !== "all") list = list.filter((i) => i.contact_id === f.contact);
  if (f.source !== "all") list = list.filter((i) => i.source === f.source);
  if (f.q) list = list.filter((i) => (i.title + " " + (i.description || "")).toLowerCase().includes(f.q.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <div><h2>All Items</h2><div className="sub">{list.length} of {items.length} shown</div></div>
        <div className="spacer" />
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
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })}>
          <option value="all">All contacts</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="all">Any source</option>
          <option value="email">Email</option>
          <option value="manual">Manual</option>
        </select>
      </div>
      <div className="group">
        {list.length ? list.map((it) => <ItemRow key={it.id} it={it} ctx={ctx} />)
          : <div className="empty">No items match these filters.</div>}
      </div>
    </>
  );
}

/* ============================================================
   Item detail
   ============================================================ */
function ItemDetail({ ctx, item }) {
  const { me, isPrincipal, projects, contacts, profiles } = ctx;
  const [comment, setComment] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [projDraft, setProjDraft] = useState("");
  const [contactDraft, setContactDraft] = useState("");
  const [prioDraft, setPrioDraft] = useState("");
  const [dueDraft, setDueDraft] = useState("");
  const answerRef = useRef(null);
  const owner = ownerOf(item);
  const itemComments = ctx.comments.filter((c) => c.action_item_id === item.id);
  const proj = projects.find((p) => p.id === item.project_id);
  const contact = contacts.find((c) => c.id === item.contact_id);

  const run = async (fn) => { setBusy(true); try { await fn(); await ctx.reload(); } finally { setBusy(false); } };

  const doStatus = (to, text) => run(async () => {
    await api.setStatus(item, to, text, me);
    ctx.notify("Moved to " + STATES[to].label);
  });
  const doComment = () => { if (!comment.trim()) return; run(async () => {
    await api.addComment(item.id, me, comment.trim());
    await api.logActivity(item.id, me, "Comment added");
    setComment(""); ctx.notify("Comment added");
  }); };
  const doAsk = () => {
    const q = (comment.trim() || window.prompt("What is your question for Stephane?") || "").trim();
    if (!q) return;
    run(async () => { await api.askQuestion(item, q, me); setComment(""); ctx.notify("Question raised"); });
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
    setContactDraft(item.contact_id || "");
    setPrioDraft(item.priority || "");
    setDueDraft(item.due_date || "");
    setEditing(true);
  };
  const saveEdit = () => {
    if (!titleDraft.trim()) { ctx.notify("Title can't be empty"); return; }
    run(async () => {
      await api.updateItem(item.id, {
        title: titleDraft.trim(),
        description: descDraft,
        project_id: projDraft || null,
        contact_id: contactDraft || null,
        priority: prioDraft || null,
        due_date: dueDraft || null,
      });
      await api.logActivity(item.id, me, "Edited details");
      setEditing(false); ctx.notify("Item updated");
    });
  };

  // lifecycle actions — available to both roles, driven by state
  const actions = [];
  if (item.status === "open") actions.push(<button key="s" className="btn green" disabled={busy} onClick={() => doStatus("in_progress", "Started work")}><Ico d={I.check} /> Start work</button>);
  if (item.status === "in_progress") actions.push(<button key="c" className="btn green" disabled={busy} onClick={() => doStatus("pending_review", "Marked complete")}><Ico d={I.check} /> Mark complete</button>);
  if (item.status === "follow_up") actions.push(<button key="r" className="btn green" disabled={busy} onClick={() => doStatus("in_progress", "Resumed work")}><Ico d={I.check} /> Resume work</button>);
  if (["open", "in_progress", "follow_up"].includes(item.status)) actions.push(<button key="q" className="btn amber" disabled={busy} onClick={doAsk}><Ico d={I.flag} /> Ask a question</button>);
  if (item.status === "awaiting_principal") actions.push(<button key="an" className="btn primary" onClick={() => answerRef.current?.focus()}><Ico d={I.pencil} /> Answer below</button>);
  if (item.status === "pending_review") {
    if (isPrincipal) actions.push(<button key="ac" className="btn green" disabled={busy} onClick={() => doStatus("closed", "Reviewed & closed")}><Ico d={I.check} /> Accept & close</button>);
    actions.push(<button key="fu" className="btn amber" disabled={busy} onClick={doFollowup}><Ico d={I.loop} /> Request follow-up</button>);
  }
  if (item.status === "closed" && isPrincipal) actions.push(<button key="re" className="btn" disabled={busy} onClick={() => doStatus("follow_up", "Reopened")}><Ico d={I.loop} /> Reopen</button>);

  let banner = null;
  if (item.status === "awaiting_principal")
    banner = <div className="banner warn"><Ico d={I.flag} /> A question was raised — answer it below to resume the work.</div>;
  else if (item.status === "pending_review")
    banner = <div className="banner review"><Ico d={I.check} /> Marked complete — ready for review.</div>;
  else if (item.status === "follow_up")
    banner = <div className="banner warn"><Ico d={I.loop} /> Follow-up requested — resume work to continue.</div>;
  else if (owner && owner !== me && item.status !== "closed")
    banner = <div className="banner info"><Ico d={I.dots} /> This item is currently with {profileFor(owner, profiles).name}.</div>;

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
            <StateBadge s={item.status} /><Prio p={item.priority} />
            <div style={{ flex: 1 }} />
            {!editing && <button className="btn ghost sm" onClick={startEdit}><Ico d={I.pencil} /> Edit</button>}
            {!editing && isPrincipal && <button className="btn danger sm" disabled={busy} onClick={doDelete}>Delete</button>}
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
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="fld">Contact</label>
                  <select value={contactDraft} onChange={(e) => setContactDraft(e.target.value)}>
                    <option value="">— none —</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
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
                  <input type="date" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)} />
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
              <h3>{item.title}</h3>
              <div className="muted">Created by {profileFor(item.created_by, profiles).name} · {ago(item.created_at)}</div>
              {banner}
              {item.description && <div className="desc">{item.description}</div>}
            </>
          )}
          {item.source === "email" && <EmailAttachment item={item} />}
          {!editing && <div className="actions">{actions.length ? actions : <span className="muted">No actions for you in this state.</span>}</div>}

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
                  <div className="mbody">{m.body}</div>
                  <div className="t">{ago(m.created_at)}</div>
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
                  <button className="btn" disabled={busy} onClick={doComment}>Comment</button>
                  {canAsk && <button className="btn amber" disabled={busy} onClick={doAsk}><Ico d={I.flag} /> Ask a question instead</button>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="side-h">Details</div>
          <div className="kv"><span className="k">Owner now</span><span className="v">{owner ? profileFor(owner, profiles).name : "—"}</span></div>
          <div className="kv"><span className="k">Assigned to</span><span className="v">{profileFor(item.assigned_to, profiles).name}</span></div>
          <div className="kv"><span className="k">Project</span><span className="v">{proj ? <span className="tag"><span className="pdot" style={{ background: proj.color }} />{proj.name}</span> : "—"}</span></div>
          <div className="kv"><span className="k">Contact</span><span className="v">{contact ? contact.name : "—"}</span></div>
          <div className="kv"><span className="k">Source</span><span className="v">{item.source === "email" ? (safeUrl(item.source_email_url) ? <a href={safeUrl(item.source_email_url)} target="_blank" rel="noreferrer">Open in Mail ↗</a> : "Email") : "Created manually"}</span></div>
          <div className="kv"><span className="k">Priority</span><span className="v">{item.priority || "—"}</span></div>
          <div className="kv"><span className="k">Due</span><span className="v">{item.due_date || "—"}</span></div>
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
  return (
    <div className="email-card">
      <div className="email-head">
        <span className="email-ico"><Ico d={I.mail} /></span>
        <div className="grow">
          <div className="email-subj">{item.email_subject || item.title}</div>
          <div className="email-meta">
            From {item.email_from || "—"}{when ? " · " + when : ""}
          </div>
        </div>
        {safeUrl(item.source_email_url) && (
          <a className="btn ghost sm" href={safeUrl(item.source_email_url)} target="_blank" rel="noreferrer">Open in Mail ↗</a>
        )}
      </div>
      {body && <div className="email-body">{body}</div>}
      <div className="email-foot">Original email · attached automatically when the “GTD” label was applied</div>
    </div>
  );
}

/* ============================================================
   New item
   ============================================================ */
function NewItem({ ctx }) {
  const { projects, contacts, me } = ctx;
  const [form, setForm] = useState({ title: "", description: "", project_id: "", contact_id: "", priority: "normal", due_date: "", assigned_to: "nicole" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });

  const create = async () => {
    if (!form.title.trim()) { ctx.notify("Give the item a title"); return; }
    setBusy(true);
    const fields = {
      title: form.title.trim(),
      description: form.description.trim(),
      project_id: form.project_id || null,
      contact_id: form.contact_id || null,
      priority: form.priority || null,
      due_date: form.due_date || null,
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
              <option value="">— none —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="fld">Contact</label>
            <select value={form.contact_id} onChange={(e) => set("contact_id", e.target.value)}>
              <option value="">— none —</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="fld">Priority (optional)</label>
            <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="">— blank —</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select></div>
          <div><label className="fld">Due date (optional)</label><input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></div>
          <div className="full"><label className="fld">Assign to</label>
            <select value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
              <option value="nicole">Nicole Sciacca</option><option value="stephane">Stephane (myself)</option>
            </select></div>
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
  const { projects, items, isPrincipal } = ctx;
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
  return (
    <>
      <div className="page-head"><div><h2>Projects</h2><div className="sub">Group action items by project</div></div><div className="spacer" />
        <button className="btn primary" onClick={add}><Ico d={I.add} /> New project</button></div>
      <div className="group">
        {projects.map((p) => {
          const n = items.filter((i) => i.project_id === p.id && i.status !== "closed").length;
          return (
            <div key={p.id} className="proj-row">
              <span className="pc" style={{ background: p.color }} /><b>{p.name}</b>
              <span className="badge-mini">{n} open item{n === 1 ? "" : "s"}</span>
              <div style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={() => rename(p)}>Rename</button>
              {isPrincipal && <button className="btn danger sm" onClick={() => del(p)}>Delete</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   Contacts (same rights model as Projects)
   ============================================================ */
function Contacts({ ctx }) {
  const { contacts, items, isPrincipal } = ctx;
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
  return (
    <>
      <div className="page-head"><div><h2>Contacts</h2><div className="sub">People &amp; companies your items relate to</div></div><div className="spacer" />
        <button className="btn primary" onClick={add}><Ico d={I.add} /> New contact</button></div>
      <div className="group">
        {contacts.length === 0 && <div className="empty">No contacts yet.</div>}
        {contacts.map((c) => {
          const n = items.filter((i) => i.contact_id === c.id && i.status !== "closed").length;
          return (
            <div key={c.id} className="proj-row">
              <span className="pc" style={{ background: "#94A3B8", borderRadius: "50%" }} />
              <b>{c.name}</b>
              {c.email && <span className="badge-mini">{c.email}</span>}
              <span className="badge-mini">{n} open item{n === 1 ? "" : "s"}</span>
              <div style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={() => edit(c)}>Edit</button>
              {isPrincipal && <button className="btn danger sm" onClick={() => del(c)}>Delete</button>}
            </div>
          );
        })}
      </div>
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
      <div className="group">
        {activity.map((a) => {
          const it = items.find((i) => i.id === a.action_item_id);
          const who = a.actor === "system" ? "System" : profileFor(a.actor, profiles).name;
          return (
            <div key={a.id} className="item" onClick={() => it && ctx.open(it.id)}>
              <div className="grow"><div className="ttl">{a.change}</div>
                <div className="meta">{it ? it.title : "—"}<span className="muted">{who} · {ago(a.created_at)}</span></div></div>
              {it && <StateBadge s={it.status} />}
              <span className="chev"><Ico d={I.chev} /></span>
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
  const { profiles, items, activity } = ctx;
  const [sessions, setSessions] = useState(null);
  useEffect(() => { api.listSessions().then(setSessions); }, []);
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
        <div className="group-head"><span className="gi"><Ico d={I.clock} /></span>Access sessions<span className="count">{sessions ? sessions.length : "…"}</span></div>
        {sessions === null && <div className="empty">Loading…</div>}
        {sessions && sessions.length === 0 && <div className="empty">No sessions recorded yet.</div>}
        {sessions && sessions.map((s) => (
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
                <div className="rl">{p.role === "principal" ? "Principal" : "Assistant"}{mine ? " · you" : ""}</div>
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
