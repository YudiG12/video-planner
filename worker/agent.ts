// Agent entry point: separate Worker (outside Access), API + MCP only, always requires Bearer.
import app, { safeEqual } from "./index";
export default {
  async fetch(req: Request, env: { AGENT_TOKEN?: string; DB?: D1Database; LIVE?: unknown }, ctx: ExecutionContext) {
    // Public smoke test for deploy.yml (no data, no auth): the bindings production needs really work.
    if (new URL(req.url).pathname === "/health") {
      const db = await env.DB?.prepare("SELECT 1").first().then(() => true, () => false) ?? false;
      const checks = { db, live: !!env.LIVE, agent_token: !!env.AGENT_TOKEN };
      const ok = Object.values(checks).every(Boolean);
      return Response.json({ ok, ...checks }, { status: ok ? 200 : 503 });
    }
    const got = req.headers.get("authorization") || "";
    const ok = !!env.AGENT_TOKEN && safeEqual(got, `Bearer ${env.AGENT_TOKEN}`);
    if (!ok) return new Response("unauthorized", { status: 401 });
    return app.fetch(req, env, ctx);
  },
};
