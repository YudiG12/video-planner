// Live updates: one Durable Object ("hub") holds the open app tabs' WebSockets (Hibernation API, so idle tabs cost nothing).
// Both Workers (app + agent) send it small events after a write; it fans them out to every connected tab.
// Events carry no script text, only what changed: the app re-reads the data through the normal (authenticated) API.
import { DurableObject } from "cloudflare:workers";

export type LiveEvent =
  | { t: "video"; id: string; fields?: string[] }        // created / fields changed / moved
  | { t: "block"; id: string; block: string; version: number } // one script block saved
  | { t: "editing"; id: string; block: string }          // the agent read a block to edit it
  | { t: "removed"; id: string }
  | { t: "series"; id: string };
export type LiveMessage = LiveEvent & { actor: string; origin: string; at: number };

export class LiveHub extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    // keep-alive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // Internal only: reachable through the binding, never routed from the internet (see /api/live in index.ts).
  async broadcast(msg: string) {
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} }
  }

  async fetch(req: Request) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage() {} // clients only send "ping" (auto-answered)
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code === 1005 ? 1000 : code, "closed"); } catch {} }
  async webSocketError(ws: WebSocket) { try { ws.close(1011, "error"); } catch {} }
}

type LiveEnv = { LIVE?: DurableObjectNamespace<LiveHub> };
// Returns the Store's notify callback: fire-and-forget (waitUntil), never blocks or fails a write.
export function liveNotifier(env: LiveEnv, ctx: { waitUntil(p: Promise<unknown>): void }, actor: string, origin: string) {
  const ns = env.LIVE;
  if (!ns) return undefined;
  return (ev: LiveEvent) => {
    const msg: LiveMessage = { ...ev, actor, origin, at: Date.now() };
    ctx.waitUntil(ns.get(ns.idFromName("hub")).broadcast(JSON.stringify(msg)).catch(() => {}));
  };
}
export const liveStub = (env: LiveEnv) => env.LIVE?.get(env.LIVE.idFromName("hub"));
