// Minimal MCP (Streamable HTTP, JSON responses) on top of the same Store as the REST API.
import { Store, STATUSES } from "./store";

const str = (description: string) => ({ type: "string", description });
const TOOLS = [
  { name: "list_videos", description: "List videos. Optional filters: format (longo = long YouTube video | vertical = reel/short), status, series_id, from/to (publish dates, YYYY-MM-DD).",
    inputSchema: { type: "object", properties: { format: str("longo or vertical"), status: str(`One of: ${STATUSES.join(", ")}`), series_id: str("series id"), from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") } } },
  { name: "get_video", description: "Read one video with its full script and history.", inputSchema: { type: "object", properties: { id: str("video id") }, required: ["id"] } },
  { name: "create_video", description: "Create a video. With a series and no episode, it takes the series' next episode number.",
    inputSchema: { type: "object", properties: { title: str("title or hook"), format: str("longo or vertical"), status: str("default: Ideias"), series_id: str("series id"), episode: { type: "number" }, sponsor_id: str("id do patrocinador"), publish_date: str("YYYY-MM-DD"), script: { type: "object", description: "blocos do roteiro" } }, required: ["title", "format"] } },
  { name: "update_video", description: "Update a video's fields (title, series, episode, sponsor, publish date, derivatives).",
    inputSchema: { type: "object", properties: { id: str("id"), title: { type: "string" }, series_id: { type: "string" }, episode: { type: "number" }, sponsor_id: { type: "string" }, publish_date: { type: "string" }, derivatives: { type: "object" } }, required: ["id"] } },
  { name: "move_video", description: "Move the video to another kanban status (optionally at a position).", inputSchema: { type: "object", properties: { id: str("id"), status: str(STATUSES.join(", ")), position: { type: "number" } }, required: ["id", "status"] } },
  { name: "update_script_block", description: "Edit ONE script block without touching the others. Text is markdown. Long: pairs, thumb_desc, hook {confirmacao, promessa, curiosidade, pessoalidade}, conteudo (content), insercao (sponsor segment), conclusao. Vertical: capa (cover URL), gancho (hook), conteudo, conclusao.",
    inputSchema: { type: "object", properties: { id: str("id"), block: str("block name"), value: { description: "block content (string or object)" } }, required: ["id", "block", "value"] } },
  { name: "list_series", description: "List series, sponsors and valid statuses.", inputSchema: { type: "object", properties: {} } },
  { name: "next_episode", description: "Next episode number for a series.", inputSchema: { type: "object", properties: { series_id: str("series id") }, required: ["series_id"] } },
];

async function call(store: Store, name: string, a: any) {
  switch (name) {
    case "list_videos": return store.list(a);
    case "get_video": return store.get(a.id);
    case "create_video": return store.create(a);
    case "update_video": { const { id, ...rest } = a; return store.update(id, rest); }
    case "move_video": return store.move(a.id, a.status, a.position);
    case "update_script_block": return store.update(a.id, { script: { [a.block]: a.value } });
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
