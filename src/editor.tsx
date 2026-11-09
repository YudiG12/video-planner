// Editor de texto estilo Notion (TipTap). Guarda markdown: o agente lê e escreve texto puro.
import { useEffect, useRef, useState } from "react";
import { BubbleMenu, EditorContent, FloatingMenu, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import * as I from "./icons";

// só http(s) e caminhos internos; bloqueia javascript:, data: etc.
const SAFE_URL = /^(https?:\/\/|\/(?!\/))/i;
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
const YT_LINE = /^\s*(?:\[[^\]]*\]\()?(https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S+?)\)?\s*$/;

// ---------- referência de vídeo (cartão pequeno) ----------
const ytCache: Record<string, Promise<{ title: string | null; author?: string }>> = {};
export function YTRef({ id, label }: { id: string; label?: string }) {
  const [info, setInfo] = useState<{ title: string | null; author?: string } | null>(null);
  useEffect(() => {
    (ytCache[id] ||= fetch(`/api/yt-title?id=${id}`).then((r) => r.json() as Promise<{ title: string | null; author?: string }>).catch(() => ({ title: null }))).then(setInfo);
  }, [id]);
  return (
    <a className="r-yt" href={`https://youtu.be/${id}`} target="_blank" rel="noreferrer" contentEditable={false}>
      <span className="r-yt-th"><img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" /><I.YT w={14} /></span>
      <span className="r-yt-tx"><b>{label || info?.title || "Vídeo do YouTube"}</b><small>{info?.author || "youtube.com"}</small></span>
    </a>
  );
}

const YouTubeRef = Node.create({
  name: "ytref", group: "block", atom: true, draggable: true,
  addAttributes: () => ({ url: { default: "" } }),
  parseHTML: () => [{
    tag: "p", priority: 60,
    getAttrs: (el) => { const t = (el as HTMLElement).textContent || ""; const m = YT_LINE.exec(t); return m && YT_RE.test(m[1]) ? { url: m[1] } : false; },
  }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-ytref": "" })],
  addNodeView: () => ReactNodeViewRenderer(({ node, deleteNode, selected }: any) => {
    const id = YT_RE.exec(node.attrs.url)?.[1];
    return (
      <NodeViewWrapper className={"yt-node" + (selected ? " sel" : "")} data-drag-handle>
        {id ? <YTRef id={id} /> : <span>{node.attrs.url}</span>}
        <button className="yt-x" contentEditable={false} onClick={deleteNode} title="Remover">×</button>
      </NodeViewWrapper>
    );
  }),
  addStorage: () => ({ markdown: { serialize(state: any, node: any) { state.write(node.attrs.url); state.closeBlock(node); } } }),
});

// ---------- upload de print ----------
export async function uploadImage(f: File | Blob, max = 1600): Promise<string> {
  const url = URL.createObjectURL(f);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const w = Math.min(max, img.width), h = Math.round((img.height * w) / img.width);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  const r = await fetch("/api/assets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: c.toDataURL("image/jpeg", 0.82) }) });
  return ((await r.json()) as { url: string }).url;
}

// ---------- menus ----------
const Svg = ({ d, s = 15 }: { d: string; s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const ic = {
  bold: <b style={{ fontSize: 14 }}>B</b>, italic: <i style={{ fontSize: 14, fontFamily: "Georgia" }}>i</i>,
  strike: <s style={{ fontSize: 14 }}>S</s>, code: <Svg d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  link: <Svg d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  h1: <b style={{ fontSize: 12 }}>H1</b>, h2: <b style={{ fontSize: 12 }}>H2</b>,
  ul: <Svg d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />, ol: <Svg d="M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M4 14h2l-2 3h2" />,
  todo: <Svg d="M4 4h16v16H4zM8 12l3 3 5-6" />, quote: <Svg d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6" />,
  img: <Svg d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01" />, hr: <Svg d="M4 12h16" />,
  yt: <I.YT w={16} />,
};

function blockItems(ed: Editor, pickImage: () => void) {
  return [
    { k: "h1", l: "Título", i: ic.h1, on: ed.isActive("heading", { level: 1 }), run: () => ed.chain().focus().toggleHeading({ level: 1 }).run() },
    { k: "h2", l: "Subtítulo", i: ic.h2, on: ed.isActive("heading", { level: 2 }), run: () => ed.chain().focus().toggleHeading({ level: 2 }).run() },
    { k: "ul", l: "Lista", i: ic.ul, on: ed.isActive("bulletList"), run: () => ed.chain().focus().toggleBulletList().run() },
    { k: "ol", l: "Lista numerada", i: ic.ol, on: ed.isActive("orderedList"), run: () => ed.chain().focus().toggleOrderedList().run() },
    { k: "todo", l: "Checklist", i: ic.todo, on: ed.isActive("taskList"), run: () => ed.chain().focus().toggleTaskList().run() },
    { k: "quote", l: "Citação", i: ic.quote, on: ed.isActive("blockquote"), run: () => ed.chain().focus().toggleBlockquote().run() },
    { k: "img", l: "Print / imagem", i: ic.img, on: false, run: pickImage },
    { k: "yt", l: "Vídeo do YouTube", i: ic.yt, on: false, run: () => { const u = prompt("Link do vídeo do YouTube"); if (u && YT_RE.test(u)) ed.chain().focus().insertContent({ type: "ytref", attrs: { url: u.trim() } }).run(); } },
    { k: "hr", l: "Divisor", i: ic.hr, on: false, run: () => ed.chain().focus().setHorizontalRule().run() },
  ];
}

// ---------- campo ----------
export function Field({ value, onSave, placeholder, style }: { value: string; onSave: (s: string) => void; placeholder?: string; style?: React.CSSProperties }) {
  const last = useRef(value || "");
  const file = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();
  const save = (ed: Editor) => {
    const md: string = (ed.storage as any).markdown.getMarkdown();
    if (md !== last.current) { last.current = md; onSave(md); }
  };
  const ed = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList, TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: true, autolink: true, protocols: ["http", "https"], isAllowedUri: (u: string) => SAFE_URL.test(u), HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } } as any),
      Image, YouTubeRef,
      Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? placeholder ?? "Escreva…" : "Digite ou use o + pra inserir blocos") }),
      Markdown.configure({ html: false, linkify: true, breaks: true, transformPastedText: true }),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: "rt", style: Object.entries(style || {}).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${typeof v === "number" ? v + "px" : v}`).join(";") },
      handlePaste: (_v, e) => { const fs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/")); if (!fs.length) return false; addImages(fs); return true; },
      handleDrop: (_v, e) => { const fs = Array.from((e as DragEvent).dataTransfer?.files || []).filter((f) => f.type.startsWith("image/")); if (!fs.length) return false; addImages(fs); return true; },
    },
    onUpdate: ({ editor }) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(editor), 1200); },
    onBlur: ({ editor }) => { window.clearTimeout(timer.current); save(editor); },
  });
  const addImages = async (fs: File[]) => { if (!ed) return; for (const f of fs) { const u = await uploadImage(f); ed.chain().focus().setImage({ src: u, alt: "print" }).run(); } save(ed); };
  // texto mudou fora (agente, outro painel) e o campo não está em uso: atualiza
  useEffect(() => {
    if (!ed || ed.isFocused) return;
    if ((value || "") !== last.current) { last.current = value || ""; ed.commands.setContent(value || "", false); }
  }, [value, ed]);
  if (!ed) return null;
  const link = () => { const prev = ed.getAttributes("link").href; const u = prompt("Link", prev || "https://"); if (u === null) return; if (!u) ed.chain().focus().unsetLink().run(); else if (SAFE_URL.test(u.trim())) ed.chain().focus().extendMarkRange("link").setLink({ href: u.trim() }).run(); else alert("Use um link http:// ou https://"); };
  return (
    <div className="rt-wrap">
      <BubbleMenu editor={ed} tippyOptions={{ duration: 120, placement: "top-start" }} shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive("ytref") && !editor.isActive("image")}>
        <div className="menu">
          {[
            { k: "b", i: ic.bold, on: ed.isActive("bold"), run: () => ed.chain().focus().toggleBold().run(), t: "Negrito ⌘B" },
            { k: "i", i: ic.italic, on: ed.isActive("italic"), run: () => ed.chain().focus().toggleItalic().run(), t: "Itálico ⌘I" },
            { k: "s", i: ic.strike, on: ed.isActive("strike"), run: () => ed.chain().focus().toggleStrike().run(), t: "Riscado" },
            { k: "c", i: ic.code, on: ed.isActive("code"), run: () => ed.chain().focus().toggleCode().run(), t: "Código" },
            { k: "l", i: ic.link, on: ed.isActive("link"), run: link, t: "Link ⌘K" },
          ].map((b) => <button key={b.k} className={b.on ? "on" : ""} title={b.t} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.i}</button>)}
          <span className="sep" />
          {blockItems(ed, () => file.current?.click()).slice(0, 6).map((b) => <button key={b.k} className={b.on ? "on" : ""} title={b.l} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.i}</button>)}
        </div>
      </BubbleMenu>
      <FloatingMenu editor={ed} tippyOptions={{ duration: 120, placement: "left" }} shouldShow={({ editor, state }) => { const { $from, empty } = state.selection; return editor.isFocused && empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && !editor.isEmpty; }}>
        <PlusMenu items={blockItems(ed, () => file.current?.click())} />
      </FloatingMenu>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ""; }} />
      <EditorContent editor={ed} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); link(); } }} />
    </div>
  );
}

function PlusMenu({ items }: { items: { k: string; l: string; i: any; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="plus">
      <button className="plus-b" title="Inserir bloco" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>+</button>
      {open && (
        <div className="plus-pop" onMouseDown={(e) => e.preventDefault()}>
          {items.map((b) => <button key={b.k} onClick={() => { setOpen(false); b.run(); }}><span className="si">{b.i}</span>{b.l}</button>)}
        </div>
      )}
    </div>
  );
}
