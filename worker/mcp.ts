// Minimal MCP (Streamable HTTP, JSON responses) on top of the same Store as the REST API.
import { Store, STATUSES, SCRIPT_BLOCKS, saveAsset, isBlockError } from "./store";

const str = (description: string) => ({ type: "string", description });
const TOOLS = [
  { name: "list_videos", description: "List videos. Optional filters: format (longo = long YouTube video | vertical = reel/short), status, series_id, from/to (publish dates, YYYY-MM-DD).",
    inputSchema: { type: "object", properties: { format: str("longo or vertical"), status: str(`One of: ${STATUSES.join(", ")}`), series_id: str("series id"), from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") } } },
  { name: "get_video", description: "Read one video with its full script, script_versions ({ block: version }, missing = 0) and history.", inputSchema: { type: "object", properties: { id: str("video id") }, required: ["id"] } },
  { name: "create_video", description: "Create a video. With a series and no episode, it takes the series' next episode number.",
    inputSchema: { type: "object", properties: { title: str("title or hook"), format: str("longo or vertical"), status: str("default: Ideias"), series_id: str("series id"), episode: { type: "number" }, sponsor_id: str("id do patrocinador"), publish_date: str("YYYY-MM-DD"), script: { type: "object", description: "blocos do roteiro" } }, required: ["title", "format"] } },
  { name: "update_video", description: "Update a video's fields (title, series, episode, sponsor, publish date, derivatives).",
    inputSchema: { type: "object", properties: { id: str("id"), title: { type: "string" }, series_id: { type: "string" }, episode: { type: "number" }, sponsor_id: { type: "string" }, publish_date: { type: "string" }, derivatives: { type: "object" } }, required: ["id"] } },
  { name: "move_video", description: "Move the video to another kanban status (optionally at a position).", inputSchema: { type: "object", properties: { id: str("id"), status: str(STATUSES.join(", ")), position: { type: "number" } }, required: ["id", "status"] } },
  { name: "get_script_block", description: "Read ONE script block with its current version and its previous value ({ value, version, previous: { value, version } | null, updated_by }). Use the version as base_version for update_script_block. Reading a block also highlights it as \"being edited\" in the owner's open app until you write it (or ~30s).",
    inputSchema: { type: "object", properties: { id: str("video id"), block: str("block name (see update_script_block)") }, required: ["id", "block"] } },
  { name: "update_script_block", description: `Edit ONE script block without touching the others. Text is markdown. Long (format longo) blocks: ${SCRIPT_BLOCKS.longo.join(", ")} — pairs (array of { title, thumb }), thumb_desc, hook {confirmacao, promessa, curiosidade, pessoalidade, serie (the spoken series line, shown in its own box)}, conteudo (content), insercao (sponsor segment text; place it inside conteudo with a line [INSERÇÃO] where it fits, before ~45% of the video), conclusao. Vertical blocks: ${SCRIPT_BLOCKS.vertical.join(", ")} — capa (cover URL), gancho (hook), conteudo, conclusao. Any other block name is rejected. Every block has a version (get_video -> script_versions, or get_script_block). Pass base_version = the version you read: if someone (e.g. the owner) changed the block since, the write is rejected with a conflict that includes the current value and version — re-read, merge, retry with the new version. Without base_version the write always wins (avoid). Returns { block, value, version }.`,
    inputSchema: { type: "object", properties: { id: str("id"), block: str("block name (exact, see description)"), value: { description: "block content (string, or object for hook, array for pairs)" }, base_version: { type: "number", description: "version of the block you based this edit on; mismatch = conflict error" } }, required: ["id", "block", "value"] } },
  { name: "upload_image", description: "Upload a print/screenshot (data URL: data:image/png|jpeg|webp|gif;base64,..., max 1.5 MB). Returns { url }. Embed it in a script block as markdown ![print](url) right under the line where it is mentioned.",
    inputSchema: { type: "object", properties: { data: str("data URL of the image") }, required: ["data"] } },
  { name: "update_series", description: "Update a series' look: logo (url returned by upload_image, e.g. /api/assets/<id>; null clears it and shows the name instead), color (text/accent, #RRGGBB), bg (column background, #RRGGBB), description. Only the fields you pass change. The logo shows in the Ideas column header and on the cards.",
    inputSchema: { type: "object", properties: { id: str("series id (see list_series)"), logo: { type: ["string", "null"], description: "asset URL from upload_image, or null" }, color: str("#RRGGBB"), bg: str("#RRGGBB"), description: { type: ["string", "null"] } }, required: ["id"] } },
  { name: "list_series", description: "List series, sponsors and valid statuses.", inputSchema: { type: "object", properties: {} } },
  { name: "next_episode", description: "Next episode number for a series.", inputSchema: { type: "object", properties: { series_id: str("series id") }, required: ["series_id"] } },
];

// Store errors become MCP tool errors; a conflict carries the current value and version as JSON so the agent can merge.
const orThrow = <T,>(r: T) => {
  if (isBlockError(r)) throw new Error(r.code === "conflict" ? JSON.stringify(r) : r.error);
  return r;
};

async function call(store: Store, name: string, a: any) {
  switch (name) {
    case "list_videos": return store.list(a);
    case "get_video": return store.get(a.id);
    case "create_video": return orThrow(await store.create(a));
    case "update_video": { const { id, ...rest } = a; return orThrow(await store.update(id, rest)); }
    case "move_video": return store.move(a.id, a.status, a.position);
    case "get_script_block": return orThrow(await store.getBlock(a.id, a.block));
    case "update_script_block": return orThrow(await store.setBlock(a.id, a.block, a.value, a.base_version));
    case "upload_image": { const r = await saveAsset(store.database, a.data); if ("error" in r) throw new Error(r.error); return r; }
    case "update_series": { const { id, ...rest } = a; const r = await store.updateSeries(id, rest); if ("error" in r) throw new Error(String(r.error)); return r; }
    case "list_series": return store.bootstrap();
    case "next_episode": return { episode: await store.nextEpisode(a.series_id) };
    default: throw new Error(`unknown tool: ${name}`);
  }
}

export async function handleMcp(req: Request, store: Store): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const msg = (await req.json().catch(() => null)) as any;
  if (!msg || typeof msg !== "object") return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notification
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "video-planner", version: "0.1.0" } });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call":
      try {
        if (typeof msg.params?.name !== "string") throw new Error("params.name is required");
        const out = await call(store, msg.params.name, msg.params.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e: any) {
        return reply({ content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      }
    default:
      return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
}
