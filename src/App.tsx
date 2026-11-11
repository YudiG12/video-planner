import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, CLIENT_ID, type Boot, type Format, type LiveMessage, type Series, type Video } from "./api";
import * as I from "./icons";
import { t, tAction, dateLocale, weekdays, setLocale } from "./i18n";
import { Field } from "./editor";
import { DiffText } from "./diff";

type View = "kanban" | "calendario" | "derivados" | "ideias";
type Filter = "todos" | Format;

// ---------- simple global state ----------
export type Conflict = { mine: any; base: number; theirs: any; version: number };
// A block the agent changed: what it was before (as first seen here) and what it is now. `shown` = it was on screen
// while the video was open; closing and reopening the video clears it.
export type Change = { before: any; after: any; shown: boolean };
function useData() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  // script blocks whose save was rejected because someone else changed them first; key `${videoId}:${block}`
  const [conflicts, setConflictsState] = useState<Record<string, Conflict>>({});
  // kept in a ref too, so queued saves see the latest conflict (state updates land a render later)
  const cref = useRef(conflicts);
  const setConflict = (key: string, c: Conflict | null) => {
    const { [key]: _, ...rest } = cref.current;
    cref.current = c ? { ...rest, [key]: c } : rest;
    setConflictsState(cref.current);
  };
  const vref = useRef(videos); vref.current = videos;
  const queue = useRef<Record<string, Promise<unknown>>>({});
  const advanced = useRef<Record<string, Record<number, number>>>({}); // own saves: base -> new version
  const pending = useRef<Record<string, number>>({}); // blocks with a save in flight: a re-read must not undo them
  // Server data replaces local data, except blocks this tab is still saving
  const merge = (list: Video[]) => setVideos((local) => list.map((f) => {
    const l = local.find((x) => x.id === f.id);
    const keep = l ? Object.keys(pending.current).filter((k) => pending.current[k] > 0 && k.startsWith(f.id + ":")).map((k) => k.slice(f.id.length + 1)) : [];
    if (!l || !keep.length) return f;
    const script = { ...f.script }, script_versions = { ...f.script_versions };
    for (const b of keep) { script[b] = l.script[b]; if (l.script_versions?.[b] != null) script_versions[b] = l.script_versions[b]; }
    return { ...f, script, script_versions };
  }));
  const reload = () => api.list().then(merge);
  const loadBoot = () => api.boot().then((b) => { setLocale(b.locale); document.documentElement.lang = b.locale || "en"; setBoot(b); });
  useEffect(() => { loadBoot(); reload(); }, []);
  const setLocal = (id: string, block: string, value: any, version?: number) => setVideos((vs) => vs.map((v) => (v.id === id
    ? { ...v, script: { ...v.script, [block]: value }, script_versions: version == null ? v.script_versions : { ...v.script_versions, [block]: version } } : v)));
  // Saves of the same block run one at a time, in order
  const enqueue = (key: string, run: () => Promise<void>) => {
    const p = (queue.current[key] || Promise.resolve()).then(run, run);
    queue.current[key] = p.catch(() => {});
    return p;
  };
  const put = async (id: string, block: string, value: any, b: number) => {
    const key = `${id}:${block}`;
    const r = await api.putBlock(id, block, value, b);
    if ("code" in r) { setConflict(key, { mine: value, base: b, theirs: r.current.value, version: r.current.version }); return; }
    if (r.version !== b) (advanced.current[key] ||= {})[b] = r.version;
    setConflict(key, null);
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, script_versions: { ...v.script_versions, [block]: r.version } } : v)));
  };
  // Save one block with the version it was based on. A save based on a version that our own previous save replaced is
  // moved forward (our edits build on each other); anything else conflicts.
  const saveBlock = (id: string, block: string, value: any, base?: number) => {
    const key = `${id}:${block}`;
    setLocal(id, block, value);
    pending.current[key] = (pending.current[key] || 0) + 1;
    return enqueue(key, async () => {
      try {
        let b = base ?? vref.current.find((v) => v.id === id)?.script_versions?.[block] ?? 0;
        while (advanced.current[key]?.[b] != null) b = advanced.current[key][b];
        await put(id, block, value, b);
      } finally { pending.current[key]--; }
    });
  };
  // Runs after any pending save of the block (e.g. the blur save of the owner's latest text), using the conflict as it is then
  const resolve = (id: string, block: string, how: "mine" | "theirs") => {
    const key = `${id}:${block}`;
    return enqueue(key, async () => {
      const c = cref.current[key];
      if (!c) return;
      if (how === "mine") { setLocal(id, block, c.mine); await put(id, block, c.mine, c.version); return; }
      setConflict(key, null);
      setLocal(id, block, c.theirs, c.version);
    });
  };
  const patch = async (id: string, p: Partial<Video>) => {
    const { script, ...rest } = p;
    for (const [block, value] of Object.entries(script || {})) saveBlock(id, block, value);
    if (!Object.keys(rest).length) return;
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, ...rest } : v)));
    const nv = await api.update(id, rest);
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...nv, script: v.script, script_versions: v.script_versions } : v)));
    return nv;
  };
  const live = useLive({ videos: vref, merge, setVideos, loadBoot });
  return { boot, videos, setVideos, reload, patch, saveBlock, conflicts, resolve, ...live };
}

// ---------- live updates (/api/live) ----------
// Keeps a WebSocket open (reconnects with backoff). Every event re-reads the videos; blocks the agent changed get a
// Change (shown as a diff until "ok, seen"), blocks it is about to edit get an "editing" highlight, cards get a dot.
const blockKey = (id: string, block: string) => `${id}:${block}`;
const typingIn = (key: string) => !!document.activeElement?.closest(`[data-vb="${CSS.escape(key)}"]`);
function useLive({ videos, merge, setVideos, loadBoot }: { videos: React.MutableRefObject<Video[]>; merge: (l: Video[]) => void; setVideos: React.Dispatch<React.SetStateAction<Video[]>>; loadBoot: () => void }) {
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [editing, setEditing] = useState<Record<string, number>>({}); // key -> until (ms)
  const [dots, setDots] = useState<Record<string, true>>({});
  const [blockActor, setBlockActor] = useState<Record<string, string>>({}); // who last changed a block (live)
  const openNow = useRef<Record<string, number>>({}); // videos open on screen right now
  const agentBlocks = useRef<Set<string>>(new Set());
  const timer = useRef<number>();

  const markEditing = (key: string, ms: number) => {
    const until = Date.now() + ms;
    setEditing((e) => ({ ...e, [key]: until }));
    window.setTimeout(() => setEditing((e) => (e[key] && e[key] <= Date.now() ? (({ [key]: _, ...r }) => r)(e) : e)), ms + 50);
  };
  // Re-read everything (one request), then work out which agent-changed blocks to mark
  const refresh = async () => {
    const keys = [...agentBlocks.current]; agentBlocks.current.clear();
    const list = await api.list().catch(() => null);
    if (!list) return;
    const before = videos.current;
    const add: Record<string, any[]> = {};
    for (const key of keys) {
      const [id, block] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      const old = before.find((v) => v.id === id)?.script?.[block] ?? null, now = list.find((v) => v.id === id)?.script?.[block] ?? null;
      // while the owner types in that block, the editor shows "Claude changed this block · view / apply" instead
      if (JSON.stringify(old) !== JSON.stringify(now) && !typingIn(key)) add[key] = [old, now];
    }
    if (Object.keys(add).length) setChanges((c) => {
      const n = { ...c };
      for (const [k, [old, now]] of Object.entries(add)) n[k] = { before: c[k] ? c[k].before : old, after: now, shown: false };
      return n;
    });
    merge(list);
  };
  const onMessage = (m: LiveMessage) => {
    if (m.origin && m.origin === CLIENT_ID) return; // our own write
    if (m.t === "series") { loadBoot(); return; }
    if (m.t === "removed") { setVideos((vs) => vs.filter((v) => v.id !== m.id)); return; }
    if (m.t === "editing" && m.block) { markEditing(blockKey(m.id, m.block), 30_000); return; }
    if (m.actor === "agente" && !openNow.current[m.id]) setDots((d) => ({ ...d, [m.id]: true }));
    if (m.t === "block" && m.block) {
      const key = blockKey(m.id, m.block);
      setBlockActor((a) => ({ ...a, [key]: m.actor }));
      if (m.actor === "agente") { agentBlocks.current.add(key); markEditing(key, 1200); } // short finishing pulse, then the diff
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(refresh, 120); // a burst of events = one re-read
  };
  const handler = useRef(onMessage); handler.current = onMessage;
  const refreshRef = useRef(refresh); refreshRef.current = refresh;

  useEffect(() => {
    let ws: WebSocket | null = null, tries = 0, retry: number | undefined, ping: number | undefined, stopped = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
      ws.onopen = () => {
        if (tries > 0) refreshRef.current(); // catch up on whatever happened while disconnected
        tries = 0; document.documentElement.dataset.live = "on";
        ping = window.setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25_000);
      };
      ws.onmessage = (e) => { if (e.data === "pong") return; try { handler.current(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => {
        window.clearInterval(ping); document.documentElement.dataset.live = "off";
        if (stopped) return;
        const delay = Math.min(30_000, 1000 * 2 ** tries++) * (0.8 + Math.random() * 0.4);
        retry = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => { stopped = true; window.clearTimeout(retry); window.clearInterval(ping); ws?.close(); };
  }, []);

  const seen = (key: string) => setChanges(({ [key]: _, ...rest }) => rest);
  // Panel / full screen call this: opening a video clears its dot and the changes already shown last time
  const useOpenVideo = (id: string) => useEffect(() => {
    openNow.current[id] = (openNow.current[id] || 0) + 1;
    setDots(({ [id]: _, ...rest }) => rest);
    setChanges((c) => Object.fromEntries(Object.entries(c).filter(([k, ch]) => !(k.startsWith(id + ":") && ch.shown))));
    return () => {
      openNow.current[id]--;
      if (!openNow.current[id]) setChanges((c) => Object.fromEntries(Object.entries(c).map(([k, ch]) => [k, k.startsWith(id + ":") ? { ...ch, shown: true } : ch])));
    };
  }, [id]);
  return { changes, editing, dots, blockActor, seen, useOpenVideo };
}
type Data = ReturnType<typeof useData>;

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

const ch = (data: { boot: Boot | null }) => data.boot?.channel || { name: "Your Channel", handle: "yourchannel", avatar: "/avatar.svg" };
const seriesOf = (boot: Boot | null, v: Video) => boot?.series.find((s) => s.id === v.series_id) || null;
const sponsorOf = (boot: Boot | null, v: Video) => boot?.sponsors.find((s) => s.id === v.sponsor_id) || null;
const tagText = (s: Series | null, v: Video) => (s ? (v.episode && s.format === "vertical" ? `EP ${v.episode} · ${s.name}` : s.name) : "");

// ---------- app ----------
export default function App() {
  const data = useData();
  const hash = useHash();
  // each tab is a route: /kanban, /calendario, /derivados, /ideias
  const VIEWS: View[] = ["kanban", "calendario", "derivados", "ideias"];
  const fromPath = () => (VIEWS.find((x) => location.pathname === "/" + x) || "kanban") as View;
  const [view, setViewRaw] = useState<View>(fromPath);
  const setView = (x: View) => { setViewRaw(x); if (location.pathname !== "/" + x) history.pushState(null, "", "/" + x + location.hash); };
  useEffect(() => { const h = () => setViewRaw(fromPath()); window.addEventListener("popstate", h); return () => window.removeEventListener("popstate", h); }, []);
  const [filter, setFilter] = useState<Filter>("todos");
  const [openId, setOpenIdRaw] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const setOpenId = (id: string | null) => {
    if (id) { setClosing(false); setOpenIdRaw(id); return; }
    setClosing(true);
    setTimeout(() => { setOpenIdRaw(null); setClosing(false); }, 200);
  };

  const full = hash.match(/^#\/video\/(.+)$/)?.[1];
  const shown = data.videos.filter((v) => filter === "todos" || v.format === filter);

  const novo = async () => {
    const format: Format = filter === "vertical" ? "vertical" : "longo";
    const v = await api.create({ title: t("Novo vídeo"), format });
    await data.reload();
    setView("kanban");
    setOpenId(v.id);
  };

  if (full) return <FullScreen data={data} id={full} />;

  return (
    <div className="app">
      <div className="topbar">
        <div className="tabs">
          <Tab on={view === "kanban"} onClick={() => { setOpenIdRaw(null); setClosing(false); setView("kanban"); }} icon={<I.IKanban />} label={t("Kanban")} />
          <Tab on={view === "calendario"} onClick={() => { setOpenIdRaw(null); setClosing(false); setView("calendario"); }} icon={<I.ICal />} label={t("Calendário")} />
          <Tab on={view === "derivados"} onClick={() => { setOpenIdRaw(null); setClosing(false); setView("derivados"); }} icon={<I.IDeriv />} label={t("Derivados")} />
          <Tab on={view === "ideias"} onClick={() => { setOpenIdRaw(null); setClosing(false); setView("ideias"); }} icon={<I.IBulb />} label={t("Ideias")} />
        </div>
        <div className="right">
          <div className="filters">
            <button className={filter === "todos" ? "on" : ""} onClick={() => setFilter("todos")}><I.IGrid />{t("Todos")}</button>
            <button className={filter === "longo" ? "on" : ""} onClick={() => setFilter("longo")}><I.YT w={16} />{t("Longos")}</button>
            <button className={filter === "vertical" ? "on" : ""} onClick={() => setFilter("vertical")}><I.IG />{t("Verticais")}</button>
          </div>
          <button className="btn-dark" onClick={novo}>{t("+ Novo vídeo")}</button>
        </div>
      </div>
      <div className="body" onMouseDown={(e) => {
        // clicking outside the panel (and outside a card) closes it
        if (openId && !(e.target as HTMLElement).closest(".panel, .card, .chip, .idea, .drow .link")) setOpenId(null);
      }}>
        {view === "kanban" && <Kanban data={data} videos={shown} openId={openId} setOpenId={setOpenId} closing={closing} />}
        {view === "calendario" && <Calendar data={data} videos={shown} open={setOpenId} />}
        {view === "derivados" && <Derivados data={data} open={setOpenId} />}
        {view === "ideias" && <Ideias data={data} filter={filter} open={(id) => { setOpenId(id); }} />}
        {openId && view !== "kanban" && <Panel data={data} id={openId} closing={closing} close={() => setOpenId(null)} />}
      </div>
    </div>
  );
}

const Tab = (p: { on: boolean; onClick: () => void; icon: any; label: string }) => (
  <button className={"tab" + (p.on ? " on" : "")} onClick={p.onClick}>{p.icon}{p.label}</button>
);

// ---------- card ----------
function CardMeta({ data, v, small }: { data: Data; v: Video; small?: boolean }) {
  const s = seriesOf(data.boot, v);
  const sp = sponsorOf(data.boot, v);
  return (
    <div className="card-meta">
      <div className="fmt">{v.format === "longo" ? <I.YT w={small ? 15 : 18} /> : <I.IG s={small ? 12 : 14} />}</div>
      <div className="tagwrap">{s?.logo ? <span className="tag-logo" title={s.name}><img src={s.logo} alt={s.name} /></span> : s && <span className="tag" style={{ background: s.bg, color: s.color }}>{small ? s.name : tagText(s, v)}</span>}</div>
      {!small && v.publish_date && <span className="mono" style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0, marginLeft: "auto" }}>{new Date(v.publish_date + "T12:00").toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }).replace(".", "")}</span>}
      {sp?.logo && <img className="logo" src={sp.logo} alt={sp.name} title={sp.name} />}
    </div>
  );
}

// "Options" menu with delete (asks for confirmation first)
function Options({ data, v, after }: { data: Data; v: Video; after: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const kind = v.status === "Ideias" ? "Apagar ideia" : "Apagar roteiro";
  return (
    <div className="opts">
      <button className="iconbtn opts-btn" onClick={() => { setOpen(!open); setConfirm(false); }} title={t("Opções")}>{t("Opções")}</button>
      {open && (
        <div className="opts-pop" onMouseDown={(e) => e.stopPropagation()}>
          {!confirm ? <button className="opts-del" onClick={() => setConfirm(true)}>{t(kind)}</button> : (
            <div className="opts-confirm">
              <span>{t("Apagar")} <b>{v.title}</b>? {t("Não dá pra desfazer.")}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => { setConfirm(false); setOpen(false); }}>{t("Cancelar")}</button>
                <button className="btn-danger" onClick={async () => { await api.remove(v.id); setOpen(false); after(); data.reload(); }}>{t("Apagar")}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Sponsor segment lives INSIDE the content, at the [INSERÇÃO] marker line (agents write the marker too).
// Without the marker it shows right after the content. ↑/↓ move it one section at a time.
const MARK = "[INSERÇÃO]";
const isSection = (l: string) => /^(\*\*\d+\.|#{1,3} )/.test(l.trim());
type FieldLive = { vb: string; remote: string };
function Content({ sc, sp, set, ver, cf, lc, fp }: { sc: any; sp: any; set: (b: string, v: any, base?: number) => void; ver: (b: string) => number; cf: (b: string) => React.ReactNode; lc: (...b: string[]) => string; fp: (b: string) => FieldLive }) {
  const text: string = sc.conteudo || "";
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.replace(/\\/g, "").trim() === MARK);
  const before = at < 0 ? text : lines.slice(0, at).join("\n").replace(/\n+$/, "");
  const after = at < 0 ? "" : lines.slice(at + 1).join("\n").replace(/^\n+/, "");
  const join = (b: string, a: string, marker = at >= 0) => (marker ? `${b.replace(/\n+$/, "")}\n\n${MARK}\n\n${a.replace(/^\n+/, "")}` : b);
  const move = (dir: -1 | 1) => {
    const all = (before + "\n" + after).split("\n");
    const starts = all.map((l, i) => (isSection(l) ? i : -1)).filter((i) => i > 0);
    const cut = before.split("\n").length; // index where the marker sits now
    const target = dir < 0 ? [...starts].reverse().find((i) => i < cut) : starts.find((i) => i > cut);
    const k = target ?? (dir < 0 ? 0 : all.length);
    set("conteudo", join(all.slice(0, k).join("\n"), all.slice(k).join("\n"), true));
  };
  const ins = sp && (
    <div className={"ins" + lc("insercao")}>
      {sp.logo && <img className="logo" style={{ width: 26, height: 26 }} src={sp.logo} alt="" />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ color: "var(--sand-ink)", flex: 1 }}>{t("Inserção")} · {sp.name}</b>
          <button className="ins-mv" title={t("Subir")} onClick={() => move(-1)}>↑</button>
          <button className="ins-mv" title={t("Descer")} onClick={() => move(1)}>↓</button>
        </div>
        {cf("insercao")}
        <Field value={sc.insercao} version={ver("insercao")} {...fp("insercao")} onSave={(x, b) => set("insercao", x, b)} placeholder={t("Onde entra e o que falar…")} />
      </div>
    </div>
  );
  return (
    <div className={"block" + lc("conteudo")}><h3>{t("2 · Conteúdo")}</h3>{cf("conteudo")}
      {/* stable keys: a remount would drop the owner's focus (and draft) when a live change resizes the text; Field follows value changes itself */}
      <Field key="before" value={before} version={ver("conteudo")} {...fp("conteudo")} onSave={(x, b) => set("conteudo", join(x, after), b)} />
      {ins}
      {at >= 0 && <Field key="after" value={after} version={ver("conteudo")} {...fp("conteudo")} onSave={(x, b) => set("conteudo", join(before, x), b)} />}
    </div>
  );
}

function Card({ data, v, sel, onClick, noDrag }: { data: Data; v: Video; sel: boolean; onClick: () => void; noDrag?: boolean }) {
  return (
    <div className={`card ${v.format === "vertical" ? "ig" : ""} ${sel ? "sel" : ""}`} draggable={!noDrag}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", v.id); e.dataTransfer.effectAllowed = "move"; window.dispatchEvent(new CustomEvent("vp-drag", { detail: v.id })); }}
      onDragEnd={() => window.dispatchEvent(new CustomEvent("vp-drag", { detail: null }))} onClick={onClick}>
      {data.dots[v.id] && <span className="dot-changed" title={t("Alterado pelo Claude")} aria-label={t("Alterado pelo Claude")} />}
      <span className="card-t">{v.title}</span>
      <CardMeta data={data} v={v} />
    </div>
  );
}

// ---------- kanban ----------
const COL_BG: Record<string, string> = { Ideias: "#F9E9EE", "Esse mês": "#E6EEF7", Produzindo: "#F7EEDC", Editando: "#ECEAFB", Finalizado: "#E3F3EA" };
const COL_ICONS: Record<string, any> = { Ideias: <I.IBulb c="#C23B5E" />, "Esse mês": <I.ICal c="#3767A8" />, Produzindo: <I.ICam />, Editando: <I.IPen />, Finalizado: <I.ICheck /> };

function Kanban({ data, videos, openId, setOpenId, closing }: { data: Data; videos: Video[]; openId: string | null; setOpenId: (id: string | null) => void; closing: boolean }) {
  const [drag, setDrag] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent).detail; setTimeout(() => setDrag(id), 0); if (!id) setSlot(null); };
    const reset = () => setTimeout(() => { setDrag(null); setSlot(null); }, 50);
    window.addEventListener("vp-drag", h); window.addEventListener("dragend", reset); window.addEventListener("drop", reset);
    return () => { window.removeEventListener("vp-drag", h); window.removeEventListener("dragend", reset); window.removeEventListener("drop", reset); };
  }, []);
  const [slot, setSlot] = useState<{ st: string; i: number } | null>(null);
  const statuses = (data.boot?.statuses || []).filter((s) => s !== "Cancelados");
  const colItems = (st: string) => videos.filter((v) => v.status === st && v.id !== drag);
  // index where the card would drop, based on the midpoint of each card in the column
  const slotAt = (st: string, e: React.DragEvent) => {
    const cards = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(":scope > .card"));
    let i = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (i < 0) i = cards.length;
    if (!slot || slot.st !== st || slot.i !== i) setSlot({ st, i });
  };
  const end = () => { setDrag(null); setSlot(null); };
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    const id = drag || e.dataTransfer.getData("text/plain");
    if (!id || !slot) return end();
    e.stopPropagation();
    const list = colItems(slot.st);
    const prev = list[slot.i - 1]?.position, next = list[slot.i]?.position;
    const position = prev == null && next == null ? 1 : prev == null ? next! - 1 : next == null ? prev + 1 : (prev + next) / 2;
    data.setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, status: slot.st, position } : v)).sort((a, b) => a.position - b.position));
    end();
    await api.move(id, slot.st, position); data.reload();
  };
  return (
    <>
      <div className="kb-wrap">
      <div className="recent">
        <span className="recent-h"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3767A8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span className="eyebrow">{t("Recentes")}</span></span>
        <div className="recent-row">
          {[...videos].filter((v) => v.status !== "Cancelados").sort((a, b) => ((b as any).updated_at || "").localeCompare((a as any).updated_at || "")).slice(0, 6)
            .map((v) => <Card key={v.id} data={data} v={v} noDrag sel={openId === v.id} onClick={() => setOpenId(v.id)} />)}
        </div>
      </div>
      <div className="kanban">
        {statuses.map((st) => {
          const items = colItems(st);
          const all = videos.filter((v) => v.status === st).length;
          const ph = <div className="card-ph" key="ph" />;
          return (
            <div key={st} style={{ background: COL_BG[st] }} className={"col" + (slot?.st === st ? " drop" : "")}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; slotAt(st, e); }}
              onDrop={drop}>
              <div className="col-h">{COL_ICONS[st]}<b>{t(st)}</b><span>{all}</span></div>
              {(() => { let i = 0; const out: any[] = [];
                videos.filter((v) => v.status === st).forEach((v) => {
                  if (v.id === drag) { out.push(<div key={v.id} className="dragging-src"><Card data={data} v={v} sel={false} onClick={() => {}} /></div>); return; }
                  if (slot?.st === st && slot.i === i) out.push(ph);
                  out.push(<Card key={v.id} data={data} v={v} sel={openId === v.id} onClick={() => setOpenId(v.id)} />); i++;
                });
                return out; })()}
            </div>
          );
        })}
      </div>
      </div>
      {openId && <Panel data={data} id={openId} closing={closing} close={() => setOpenId(null)} />}
    </>
  );
  void setDrag;
}

// ---------- side panel ----------
function Panel({ data, id, close, closing }: { data: Data; id: string; close: () => void; closing?: boolean }) {
  const [pw, setPwRaw] = useState(() => { try { return Number(localStorage.getItem("vp-pw")) || 620; } catch { return 620; } });
  const setPw = (w: number) => { setPwRaw(w); try { localStorage.setItem("vp-pw", String(w)); } catch {} };
  data.useOpenVideo(id);
  const v = data.videos.find((x) => x.id === id);
  if (!v) return null;
  return (
    <aside className={"panel" + (closing ? " closing" : "")} style={{ ["--pw" as any]: pw + "px", width: pw }}>
      <div className="panel-grip" onMouseDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX, w0 = pw;
        const mv = (ev: MouseEvent) => setPw(Math.max(420, Math.min(window.innerWidth - 320, w0 + x0 - ev.clientX)));
        const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
      }} />
      <div className="panel-top">
        <Meta data={data} v={v} />
        <div className="meta">
          <Options data={data} v={v} after={close} />
          <a className="iconbtn" href={`#/video/${v.id}`} title={t("Abrir em tela cheia")}><I.IExpand /></a>
          <button className="iconbtn" onClick={close} title={t("Fechar")}><I.IX /></button>
        </div>
      </div>
      <TitleInput data={data} v={v} />
      <Script data={data} v={v} />
    </aside>
  );
}

function Meta({ data, v, big }: { data: Data; v: Video; big?: boolean }) {
  const s = seriesOf(data.boot, v);
  const sp = sponsorOf(data.boot, v);
  return (
    <div className="meta">
      {s ? (
        <div className="serie" style={{ background: s.bg, color: s.color }}>
          {s.logo ? <img className="serie-logo" src={s.logo} alt="" /> : <div className="logo-ph" />}
          {v.episode && s.format === "vertical" && <span className="ep">EP {v.episode}</span>}
          <b>{s.name}</b>
          {v.format === "longo" ? <I.YT w={17} /> : <I.IG s={15} />}
        </div>
      ) : v.format === "longo" ? <I.YT /> : <I.IG />}
      {sp && <span className="meta">{sp.logo && <img className="logo" src={sp.logo} alt="" />}<b style={{ fontSize: 13, color: "var(--ink-strong)" }}>{sp.name}</b></span>}
      {big && null}
    </div>
  );
}

function TitleInput({ data, v }: { data: Data; v: Video }) {
  const [t, setT] = useState(v.title);
  useEffect(() => setT(v.title), [v.id, v.title]);
  return <textarea className="title-in" rows={1} style={{ fieldSizing: "content" } as any} value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t !== v.title && data.patch(v.id, { title: t })} />;
}

// textarea that saves on blur

// ---------- script ----------
// While a block is in conflict, the editor keeps showing the owner's text and the version it was based on
function withConflicts(data: Data, v: Video): Video {
  const mine = Object.entries(data.conflicts).filter(([k]) => k.startsWith(v.id + ":"));
  if (!mine.length) return v;
  const script = { ...v.script }, script_versions = { ...v.script_versions };
  for (const [k, c] of mine) { const b = k.slice(v.id.length + 1); script[b] = c.mine; script_versions[b] = c.base; }
  return { ...v, script, script_versions };
}
const blockText = (x: any): string => x == null ? "" : typeof x === "string" ? x
  : Array.isArray(x) ? x.map((p, i) => `${i + 1}. ${p?.title || ""}${p?.thumb_note ? " · " + p.thumb_note : ""}`).join("\n")
  : Object.entries(x).filter(([, y]) => y).map(([k, y]) => `${k}: ${typeof y === "string" ? y : JSON.stringify(y)}`).join("\n");

function ConflictNote({ data, v, block }: { data: Data; v: Video; block: string }) {
  const c = data.conflicts[`${v.id}:${block}`];
  if (!c) return null;
  return (
    <div className="conflict" role="alert" data-block={block}>
      <b>{t("Este bloco foi alterado em outro lugar")}</b>
      <span className="eyebrow">{t("Versão mais nova")} (v{c.version})</span>
      <pre className="conflict-theirs">{blockText(c.theirs) || "—"}</pre>
      <span className="meta">{t("Seu texto continua no editor abaixo.")}</span>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn-dark" onClick={() => data.resolve(v.id, block, "mine")}>{t("Manter o meu")}</button>
        <button className="btn-ghost" onClick={() => data.resolve(v.id, block, "theirs")}>{t("Usar a versão nova")}</button>
      </div>
    </div>
  );
}
// The agent is editing this block (animated highlight), or changed it: inserted text marked, removed text struck through
function LiveNote({ data, v, block }: { data: Data; v: Video; block: string }) {
  const key = `${v.id}:${block}`;
  const busy = (data.editing[key] ?? 0) > Date.now();
  const c = data.changes[key];
  return (
    <>
      {busy && <div className="agent-badge" data-block={block} role="status"><i /><i /><i />{t("Claude está editando…")}</div>}
      {c && !busy && (
        <div className="change" data-block={block}>
          <div className="change-h"><b>{t("Claude alterou este bloco")}</b>
            <button className="btn-ghost change-ok" onClick={() => data.seen(key)}>{t("ok, visto")}</button></div>
          <DiffText before={blockText(c.before)} after={blockText(c.after)} />
        </div>
      )}
    </>
  );
}
function Script({ data, v: v0 }: { data: Data; v: Video }) {
  const v = withConflicts(data, v0);
  const set = (block: string, value: any, base?: number) => data.saveBlock(v.id, block, value, base);
  const s = seriesOf(data.boot, v);
  const sp = sponsorOf(data.boot, v);
  const sc = v.script || {};
  const ver = (block: string) => v.script_versions?.[block] ?? 0;
  const cf = (block: string) => <><LiveNote data={data} v={v} block={block} /><ConflictNote data={data} v={v} block={block} /></>;
  // classes for a block's box while the agent edits it / after it changed it
  const lc = (...blocks: string[]) => {
    const keys = blocks.map((b) => `${v.id}:${b}`);
    return (keys.some((k) => (data.editing[k] ?? 0) > Date.now()) ? " agent-editing" : "") + (keys.some((k) => data.changes[k]) ? " agent-changed" : "");
  };
  // Field props for one block: where it lives (to know if the owner is typing in it) and who changed it remotely
  const fp = (block: string) => ({ vb: `${v.id}:${block}`, remote: data.blockActor[`${v.id}:${block}`] === "agente" ? "Claude" : t("Alguém") });
  const phrase = (tpl: string | null) => (tpl || "").replaceAll("{ep}", String(v.episode ?? "?"));

  if (v.format === "vertical") {
    return (
      <>
        <div className="row" style={{ gap: 28, alignItems: "flex-start" }}>
          <Reel v={v} s={s} chan={ch(data)} onCapa={(url) => set("capa", url)} />
          <div className={"block" + lc("gancho", "capa")} style={{ flex: 1 }}>
            <h3>{t("1 · Gancho")}</h3>{cf("gancho")}{cf("capa")}
            <Field value={sc.gancho} version={ver("gancho")} {...fp("gancho")} onSave={(x, b) => set("gancho", x, b)} style={{ fontSize: 17, lineHeight: "26px" }} />
            {s?.phrase_open && <div className="sand"><span className="eyebrow">{t("Frase da série")} · {s.name}</span>{phrase(s.phrase_open)}</div>}
          </div>
        </div>
        <div className={"block" + lc("conteudo")}><h3>{t("2 · Conteúdo")}</h3>{cf("conteudo")}<Field value={sc.conteudo} version={ver("conteudo")} {...fp("conteudo")} onSave={(x, b) => set("conteudo", x, b)} /></div>
        <div className={"block" + lc("conclusao")}>
          <h3>{t("3 · Conclusão")}</h3>{cf("conclusao")}
          <Field value={sc.conclusao} version={ver("conclusao")} {...fp("conclusao")} onSave={(x, b) => set("conclusao", x, b)} placeholder={t("Sua reflexão final…")} />
          {s?.phrase_close && <div className="sand"><span className="eyebrow">{t("Fechamento")}</span>{phrase(s.phrase_close)}</div>}
        </div>
      </>
    );
  }

  const hook = sc.hook || {};
  return (
    <>
      <YTPreview data={data} v={v} cls={lc("pairs", "thumb_desc")} />
      <div className={"block" + lc("hook")}>
        <h3>{t("1 · Hook")}</h3>{cf("hook")}
        {(["confirmacao", "promessa", "curiosidade", "pessoalidade"] as const).map((k) => (
          <div className="row" key={k}>
            <label className="eyebrow">{t(({ confirmacao: "Confirmação", promessa: "Promessa", curiosidade: "Curiosidade", pessoalidade: "Pessoalidade" } as any)[k])}</label>
            <Field value={hook[k]} version={ver("hook")} {...fp("hook")} onSave={(x, b) => set("hook", { ...hook, [k]: x }, b)} />
          </div>
        ))}
        {(() => { const se = seriesOf(data.boot, v); return se || hook.serie ? (
          <div className="serie-box" style={{ borderColor: se?.color, background: se?.bg }}>
            <label className="eyebrow" style={{ color: se?.color }}>{se?.logo && <img src={se.logo} alt="" />}{t("Fala da série")}</label>
            <Field value={hook.serie} version={ver("hook")} {...fp("hook")} onSave={(x, b) => set("hook", { ...hook, serie: x }, b)} />
          </div>) : null; })()}
      </div>
      <Content sc={sc} sp={sp} set={set} ver={ver} cf={cf} lc={lc} fp={fp} />
      <div className={"block" + lc("conclusao")}><h3>{t("3 · Conclusão")}</h3>{cf("conclusao")}<Field value={sc.conclusao} version={ver("conclusao")} {...fp("conclusao")} onSave={(x, b) => set("conclusao", x, b)} /></div>
    </>
  );
}

// downscale the image in the browser (max 480px, JPEG) before saving to the DB
function fileToThumb(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(480, img.width), h = Math.round((img.height * w) / img.width);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      res(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = rej; img.src = URL.createObjectURL(f);
  });
}

function ThumbBox({ thumb, note, save, version }: { thumb?: string; note?: string; save: (p: { thumb?: string; thumb_note?: string }, base?: number) => void; version?: number }) {
  const [edit, setEdit] = useState(false);
  const isImg = !!thumb && /^(https?:|\/|data:image)/.test(thumb);
  const text = isImg ? note : (note || thumb);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="thumb-wrap">
      <div className={"thumb" + (isImg ? " img" : "")} title={note || ""}>{isImg ? <img src={thumb} alt="" /> : (text || "")}</div>
      <button className="thumb-edit" onClick={() => setEdit(!edit)} title={t("Editar thumbnail")}><I.IPen /></button>
      {edit && (
        <div className="thumb-pop">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { save({ thumb: await fileToThumb(f) }); setEdit(false); } }} />
          <button className="btn-dark" onClick={() => fileRef.current?.click()}>{t("Enviar imagem")}</button>
          {isImg && <button className="btn-ghost" onClick={() => { save({ thumb: "" }); setEdit(false); }}>{t("Remover imagem")}</button>}
          <SyncTextarea className="ta" placeholder={t("Descrição da thumb (texto, ideia ou URL)")} value={text || ""} version={version} onSave={(raw, base) => {
            const val = raw.trim();
            if (/^https?:\/\/\S+$/.test(val)) save({ thumb: val }, base); else if (val !== (text || "")) save(isImg ? { thumb_note: val } : { thumb: "", thumb_note: val }, base);
          }} />
        </div>
      )}
    </div>
  );
}

// Plain textarea that saves on blur. When the value changes elsewhere (e.g. "Use the newer version" after a conflict)
// and the field is not being edited, it shows the new value, so a later blur can't save text that was rejected.
// `version` is the block version of `value`; onSave gets the version the shown text was based on. Like Field, the base only
// moves forward while the textarea shows that version's text, so a live change arriving mid-typing makes the save conflict.
function SyncTextarea({ value, version, onSave, ...rest }: { value: string; version?: number; onSave: (s: string, base?: number) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onBlur">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = useRef(value), base = useRef(version);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === shown.current) { base.current = version; return; }
    if (document.activeElement === el) return; // owner is typing: keep their text and the base it started from
    el.value = value; shown.current = value; base.current = version;
  }, [value, version]);
  return <textarea ref={ref} {...rest} defaultValue={value} onBlur={(e) => {
    const x = e.target.value;
    if (x !== shown.current) { onSave(x, base.current); shown.current = x; }
    else if (x !== value) { e.target.value = value; shown.current = value; base.current = version; } // untouched: take the newer value
  }} />;
}

function YTPreview({ data, v, cls = "" }: { data: Data; v: Video; cls?: string }) {
  // global preference (applies to every video), off by default
  const [cut, setCutRaw] = useState(() => { try { return localStorage.getItem("vp-cut-title") === "1"; } catch { return false; } });
  const setCut = (v: boolean) => { setCutRaw(v); try { localStorage.setItem("vp-cut-title", v ? "1" : "0"); } catch {} };
  const pairs: { title?: string; thumb?: string }[] = v.script.pairs || [{}, {}, {}];
  const save = (i: number, p: { title?: string; thumb?: string; thumb_note?: string }, base = v.script_versions?.pairs ?? 0) => {
    const next = [0, 1, 2].map((j) => (j === i ? { ...pairs[j], ...p } : pairs[j] || {}));
    // based on the version whose text the inputs show (the owner's base while in conflict)
    data.saveBlock(v.id, "pairs", next, base);
  };
  return (
    <div className={"block" + cls}>
      {["pairs", "thumb_desc"].map((b) => <span key={b} style={{ display: "contents" }}><LiveNote data={data} v={v} block={b} /><ConflictNote data={data} v={v} block={b} /></span>)}
      <div className="yt-h">
        <span className="meta"><I.YT w={16} /><span className="eyebrow" style={{ color: "var(--ink-strong)" }}>{t("Título + thumbnail · teste A/B")}</span></span>
        <button className="toggle" onClick={() => setCut(!cut)}>{t("Cortar título como no YouTube")}<span className={"sw" + (cut ? " on" : "")}><i /></span></button>
      </div>
      <div className="yt">
        {[0, 1, 2].map((i) => {
          const p = pairs[i] || {};
          const isUrl = p.thumb && /^(https?:|\/)/.test(p.thumb);
          return (
            <div className="yt-item" key={i}>
              <div className="yt-n">{i + 1}{i === 0 && <span className="p">{t("PRINCIPAL")}</span>}</div>
              <ThumbBox thumb={p.thumb} note={(p as any).thumb_note} version={v.script_versions?.pairs ?? 0} save={(q, b) => save(i, q, b)} />
              <div className="yt-info">
                <img className="avatar" src={ch(data).avatar} alt="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {cut && p.title && p.title.length > 60
                    ? <span className="yt-title" title={p.title} onClick={() => setCut(false)}>{p.title.slice(0, 58)}…</span>
                    : <SyncTextarea className="yt-title" rows={1} placeholder={t("Título…")} value={p.title || ""} version={v.script_versions?.pairs ?? 0} onSave={(x, b) => save(i, { title: x }, b)} />}
                  <div className="yt-ch">{ch(data).name} · {p.title ? `${p.title.length} ${t("caracteres")}` : "—"}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="yt-desc">
          <span className="eyebrow">{t("Descrição das thumbnails")}</span>
          <Field value={v.script.thumb_desc || ""} version={v.script_versions?.thumb_desc ?? 0} vb={`${v.id}:thumb_desc`} remote={data.blockActor[`${v.id}:thumb_desc`] === "agente" ? "Claude" : t("Alguém")} placeholder={t("O que vai na tela, textos, prints, ideias…")} onSave={(t, b) => data.saveBlock(v.id, "thumb_desc", t, b)} />
        </div>
      </div>
    </div>
  );
}

function Reel({ v, s, onCapa, chan }: { v: Video; s: Series | null; onCapa: (url: string) => void; chan: { name: string; handle: string; avatar: string } }) {
  const capa = v.script.capa as string | undefined;
  return (
    <div className="reel" title={t("Clique pra colar a URL da capa")} onClick={() => { const u = prompt(t("URL da capa (frame real do vlog)"), capa || ""); if (u != null) onCapa(u); }}>
      {capa ? <img src={capa} alt="" /> : <div style={{ color: "#677A8E", fontSize: 12, padding: 50, textAlign: "center" }}>{t("Sem capa")}</div>}
      {s && <span className="sel" style={{ color: s.color }}>EP {v.episode ?? "?"} · {s.name.split(" ")[0].toUpperCase()}</span>}
      <span className="who"><img className="avatar" style={{ width: 22, height: 22 }} src={chan.avatar} alt="" />{chan.handle}</span>
    </div>
  );
}

// ---------- full screen ----------
const DERIV_LONGO = [["cortes_ig", "2 cortes IG", <I.IG s={16} />], ["shorts", "Shorts", <I.IShorts />], ["tiktok", "TikTok", <I.ITikTok />], ["linkedin", "2 posts LinkedIn", <I.ILinkedIn />], ["journal", "Journal", <I.IJournal />]] as const;
const DERIV_VERT = [["reels", "Reels", <I.IG s={16} />], ["tiktok", "TikTok", <I.ITikTok />], ["shorts", "Shorts", <I.IShorts />]] as const;

function FullScreen({ data, id }: { data: Data; id: string }) {
  const [hist, setHist] = useState<Video["history"]>([]);
  data.useOpenVideo(id);
  const v = data.videos.find((x) => x.id === id);
  const exists = !!v;
  useEffect(() => { if (exists) api.get(id).then((x) => setHist(x.history)).catch(() => {}); }, [id, exists, v?.script, v?.status]);
  if (!data.boot || !v) return <div className="empty">{t("Carregando…")}</div>;
  const series = data.boot.series.filter((s) => s.format === v.format);
  const deriv = v.format === "longo" ? DERIV_LONGO : DERIV_VERT;
  return (
    <div className="app">
      <div className="full-top"><a href="#">← Kanban</a><span style={{ color: "var(--line-strong)" }}>/</span><span style={{ color: "var(--ink-muted)" }}>{t(v.status)}</span><span style={{ marginLeft: "auto" }}><Options data={data} v={v} after={() => { location.hash = ""; }} /></span></div>
      <div className="full">
        <div className="full-body">
          <div className="doc big">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><Meta data={data} v={v} /><TitleInput data={data} v={v} /></div>
            <Script data={data} v={v} />
          </div>
          <div className="side">
            <div className="box">
              <label className="field"><span>{t("Status")}</span>
                <select value={v.status} onChange={(e) => data.patch(v.id, { status: e.target.value })}>{data.boot.statuses.map((s) => <option key={s} value={s}>{t(s)}</option>)}</select></label>
              <label className="field"><span>{t("Publicação")}</span>
                <input type="date" value={v.publish_date || ""} onChange={(e) => data.patch(v.id, { publish_date: e.target.value || null })} /></label>
              <label className="field"><span>{t("Série")}</span>
                <select value={v.series_id || ""} onChange={(e) => data.patch(v.id, { series_id: e.target.value || null })}><option value="">—</option>{series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              {v.format === "vertical" && <label className="field"><span>{t("Episódio")}</span>
                <input type="number" value={v.episode ?? ""} onChange={(e) => data.patch(v.id, { episode: e.target.value ? Number(e.target.value) : null })} style={{ border: "1px solid var(--line)", borderRadius: 4, padding: "5px 8px" }} /></label>}
              <label className="field"><span>{t("Patrocinador")}</span>
                <select value={v.sponsor_id || ""} onChange={(e) => data.patch(v.id, { sponsor_id: e.target.value || null })}><option value="">{t("Sem publi")}</option>{data.boot.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="field"><span>{t("Formato")}</span>
                <select value={v.format} onChange={(e) => data.patch(v.id, { format: e.target.value as Format })}><option value="longo">{t("Longo · YouTube")}</option><option value="vertical">{t("Vertical")}</option></select></label>
            </div>
            <div className="block" style={{ gap: 10 }}>
              <span className="eyebrow">{t(v.format === "longo" ? "Derivados" : "Onde postar")}</span>
              {deriv.map(([k, label, icon]) => (
                <div className="check" key={k}>{icon}<span>{t(label)}</span>
                  <button className={"cb" + (v.derivatives[k] ? " on" : "")} onClick={() => data.patch(v.id, { derivatives: { [k]: !v.derivatives[k] } })}>{v.derivatives[k] && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M5 12l5 5 9-10" /></svg>}</button>
                </div>
              ))}
            </div>
            <div className="block" style={{ gap: 0 }}>
              <span className="eyebrow" style={{ marginBottom: 10 }}>{t("Histórico")}</span>
              {(hist || []).slice(0, 8).map((h, i) => (
                <div className="hist" key={i}><span className="who" style={{ color: h.actor === "agente" ? "#5A4BD1" : "#3767A8" }}>{h.actor === "agente" ? t("Agente") : t("Você")}</span><span>{tAction(h.action)}</span><span className="when">{fmtWhen(h.at)}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtWhen(at: string) {
  const d = new Date(at.replace(" ", "T") + "Z");
  const diff = (Date.now() - d.getTime()) / 864e5;
  if (diff < 1) return d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  if (diff < 2) return "ontem";
  return d.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }).replace(".", "");
}

// ---------- calendar ----------
function Calendar({ data, videos, open }: { data: Data; videos: Video[]; open: (id: string) => void }) {
  const now = new Date();
  const [range, setRange] = useState({ from: -3, to: 6 }); // months relative to the current one
  const [over, setOver] = useState<string | null>(null);
  const [active, setActive] = useState(`${now.getFullYear()}-${now.getMonth()}`);
  const box = useRef<HTMLDivElement>(null), top = useRef<HTMLDivElement>(null), bot = useRef<HTMLDivElement>(null);
  const prevH = useRef<number | null>(null);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(now);
  const months = useMemo(() => Array.from({ length: range.to - range.from + 1 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + range.from + i, 1)), [range.from, range.to]);
  const byDate = useMemo(() => { const m: Record<string, Video[]> = {}; videos.forEach((v) => { if (v.publish_date && v.status !== "Cancelados") (m[v.publish_date] ||= []).push(v); }); return m; }, [videos]);
  // scroll to the current month on first load
  useEffect(() => { box.current?.querySelector(".mon.cur")?.scrollIntoView({ block: "start" }); }, []);
  // keep scroll position when loading months above
  useLayoutEffect(() => { if (prevH.current != null && box.current) { box.current.scrollTop += box.current.scrollHeight - prevH.current; prevH.current = null; } }, [range.from]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      if (e.target === top.current) { prevH.current = box.current!.scrollHeight; setRange((r) => ({ ...r, from: r.from - 3 })); }
      if (e.target === bot.current) setRange((r) => ({ ...r, to: r.to + 3 }));
    }), { root: box.current, rootMargin: "400px" });
    const t = setTimeout(() => { top.current && io.observe(top.current); bot.current && io.observe(bot.current); }, 300);
    return () => { clearTimeout(t); io.disconnect(); };
  }, []);
  const drop = async (date: string, e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    await data.patch(e.dataTransfer.getData("text/plain"), { publish_date: date });
  };
  const label = (d: Date) => d.toLocaleDateString(dateLocale(), { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase()).replace(" de ", " ");
  return (
    <div className="cal" ref={box} onScroll={() => {
      // active month = the one in the middle of the screen
      const r = box.current!.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest<HTMLElement>("[data-m]");
      if (el && el.dataset.m !== active) setActive(el.dataset.m!);
    }}>
      <div className="cal-top">
        <div className="grid dows">{weekdays().map((d) => <div className="dow" key={d}>{d}</div>)}</div>
        <div className="filters"><button onClick={() => box.current?.querySelector(".mon.cur")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{t("Hoje")}</button></div>
      </div>
      <div ref={top} style={{ height: 1 }} />
      <div className="grid">
        {(() => {
          const first = months[0], last = months[months.length - 1];
          const start = new Date(first); start.setDate(1 - first.getDay());
          const end = new Date(last.getFullYear(), last.getMonth() + 1, 0); end.setDate(end.getDate() + (6 - end.getDay()));
          const cells: JSX.Element[] = [];
          for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const k = iso(d), day = d.getDate();
            const cur = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && day === 1;
            cells.push(
              <div key={k} data-m={`${d.getFullYear()}-${d.getMonth()}`} className={`day ${d.getDay() % 6 === 0 ? "wk" : ""} ${`${d.getFullYear()}-${d.getMonth()}` !== active ? "dim" : ""} ${k === today ? "today" : ""} ${over === k ? "drop" : ""} ${day === 1 ? "first" + (cur ? " mon cur" : "") : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(k, e)}>
                <span className="n">{day === 1 ? <b className="mlabel">{label(d)}</b> : null}{k === today ? `${day} · ${t("hoje")}` : day}</span>
                {(byDate[k] || []).map((v) => (
                  <div key={v.id} className={"chip" + (v.format === "vertical" ? " ig" : "")} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", v.id)} onClick={() => open(v.id)}>
                    <span className="chip-t">{v.title}</span>
                    <CardMeta data={data} v={v} small />
                  </div>
                ))}
              </div>
            );
          }
          return cells;
        })()}
      </div>
      <div ref={bot} style={{ height: 1 }} />
    </div>
  );
}

// ---------- ideas ----------
function Ideias({ data, filter, open }: { data: Data; filter: Filter; open: (id: string) => void }) {
  if (!data.boot) return null;
  const series = data.boot.series.filter((s) => filter === "todos" || s.format === filter).sort((a, b) => (a.format === "longo" ? 0 : 1) - (b.format === "longo" ? 0 : 1) || a.position - b.position);
  const add = async (s: Series) => { const v = await api.create({ title: "Nova ideia", format: s.format, series_id: s.id }); await data.reload(); open(v.id); };
  return (
    <div className="ideias">
      {series.map((s) => {
        const items = data.videos.filter((v) => v.series_id === s.id && v.status === "Ideias").sort((a, b) => (a.episode ?? 999) - (b.episode ?? 999));
        return (
          <div className="serie-col" key={s.id} style={{ background: s.bg, borderColor: s.bg }}>
            <div className="serie-h">
              {s.logo ? (
                <div className="serie-cover"><img src={s.logo} alt={s.name} title={s.description ?? s.name} /><span style={{ color: s.color }}>{items.length}</span></div>
              ) : (<>
                <div className="top">{s.format === "longo" ? <I.YT /> : <I.IG />}<b style={{ color: s.color }}>{s.name}</b><span style={{ color: s.color }}>{items.length}</span></div>
                <p>{s.description}</p>
              </>)}
            </div>
            <div className="serie-cards">
              {items.map((v) => <Card key={v.id} data={data} v={v} sel={false} onClick={() => open(v.id)} />)}
              <button className="newidea" onClick={() => add(s)}>{t("+ Nova ideia")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- derivatives ----------
function Derivados({ data, open }: { data: Data; open: (id: string) => void }) {
  const rows = data.videos.filter((v) => v.format === "longo" && v.status === "Finalizado").sort((a, b) => (b.publish_date || "").localeCompare(a.publish_date || ""));
  const cols = DERIV_LONGO;
  if (!rows.length) return <div className="empty">{t("Nenhum vídeo longo finalizado ainda.")}</div>;
  return (
    <div className="deriv">
      <div className="drow h"><span className="name eyebrow">{t("Vídeo longo publicado")}</span><span className="d eyebrow">{t("Publicado")}</span>
        {cols.map(([k, label, icon]) => <span className="c" key={k}>{icon}{t(label).replace("2 posts ", "").replace("2 ", "")}</span>)}<span className="f eyebrow">{t("Falta")}</span></div>
      {rows.map((v) => {
        const s = seriesOf(data.boot, v);
        const tecnico = true; // Journal (article) applies to any video
        const keys = cols.map(([k]) => k).filter((k) => k !== "journal" || tecnico);
        const falta = keys.filter((k) => !v.derivatives[k]).length;
        return (
          <div className="drow" key={v.id}>
            <span className="name link" title={t("Abrir detalhes")} onClick={() => open(v.id)}><I.YT /><span className="tt">{v.title}</span>{s && <span className="tag" style={{ background: s.bg, color: s.color }}>{s.name}</span>}</span>
            <span className="d mono">{v.publish_date ? new Date(v.publish_date + "T12:00").toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }).replace(".", "") : "—"}</span>
            {cols.map(([k]) => (
              <span className="c" key={k}>{k === "journal" && !tecnico ? <span className="mono" style={{ color: "var(--line-strong)" }}>—</span> :
                <button className={"cb" + (v.derivatives[k] ? " on" : "")} style={{ margin: 0 }} onClick={() => data.patch(v.id, { derivatives: { [k]: !v.derivatives[k] } })}>{v.derivatives[k] && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M5 12l5 5 9-10" /></svg>}</button>}</span>
            ))}
            <span className="f" style={{ color: falta >= 3 ? "#B83A31" : falta ? "#9A6510" : "#2F8A5B" }}>{falta ? `${falta} ${t("pend.")}` : t("ok")}</span>
          </div>
        );
      })}
    </div>
  );
}
