// MCP mínimo (Streamable HTTP, respostas JSON) em cima da mesma Store da API.
import { Store, STATUSES } from "./store";

const str = (description: string) => ({ type: "string", description });
const TOOLS = [
  { name: "list_videos", description: "Lista vídeos. Filtros opcionais: format (longo|vertical), status, series_id, from/to (datas YYYY-MM-DD de publicação).",
    inputSchema: { type: "object", properties: { format: str("longo ou vertical"), status: str(`Um de: ${STATUSES.join(", ")}`), series_id: str("id da série"), from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") } } },
  { name: "get_video", description: "Lê um vídeo com roteiro completo e histórico.", inputSchema: { type: "object", properties: { id: str("id do vídeo") }, required: ["id"] } },
  { name: "create_video", description: "Cria um vídeo. Se tiver série e não passar episode, usa o próximo número da série.",
    inputSchema: { type: "object", properties: { title: str("título/gancho"), format: str("longo ou vertical"), status: str("default Ideias"), series_id: str("id da série"), episode: { type: "number" }, sponsor_id: str("id do patrocinador"), publish_date: str("YYYY-MM-DD"), script: { type: "object", description: "blocos do roteiro" } }, required: ["title", "format"] } },
  { name: "update_video", description: "Atualiza campos de um vídeo (título, série, episódio, patrocinador, data, derivados).",
    inputSchema: { type: "object", properties: { id: str("id"), title: { type: "string" }, series_id: { type: "string" }, episode: { type: "number" }, sponsor_id: { type: "string" }, publish_date: { type: "string" }, derivatives: { type: "object" } }, required: ["id"] } },
  { name: "move_video", description: "Move o vídeo de status no kanban (opcionalmente numa posição).", inputSchema: { type: "object", properties: { id: str("id"), status: str(STATUSES.join(", ")), position: { type: "number" } }, required: ["id", "status"] } },
  { name: "update_script_block", description: "Edita UM bloco do roteiro sem mexer nos outros. Longo: pairs, hook, conteudo, insercao, conclusao. Vertical: gancho, conteudo, conclusao, capa.",
    inputSchema: { type: "object", properties: { id: str("id"), block: str("nome do bloco"), value: { description: "conteúdo do bloco (string ou objeto)" } }, required: ["id", "block", "value"] } },
  { name: "list_series", description: "Lista séries, patrocinadores e status válidos.", inputSchema: { type: "object", properties: {} } },
  { name: "next_episode", description: "Próximo número de episódio de uma série.", inputSchema: { type: "object", properties: { series_id: str("id da série") }, required: ["series_id"] } },
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
    default: throw new Error(`tool desconhecida: ${name}`);
  }
}

export async function handleMcp(req: Request, store: Store): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const msg = (await req.json().catch(() => null)) as any;
  if (!msg || typeof msg !== "object") return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notificação
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "video-planner", version: "0.1.0" } });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call":
      try {
        if (typeof msg.params?.name !== "string") throw new Error("params.name obrigatório");
        const out = await call(store, msg.params.name, msg.params.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e: any) {
        return reply({ content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      }
    default:
      return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
}
