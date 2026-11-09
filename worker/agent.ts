// Agent entry point: separate Worker (outside Access), API + MCP only, always requires Bearer.
import app, { safeEqual } from "./index";
export default {
  fetch(req: Request, env: { AGENT_TOKEN?: string }, ctx: ExecutionContext) {
    const got = req.headers.get("authorization") || "";
    const ok = !!env.AGENT_TOKEN && safeEqual(got, `Bearer ${env.AGENT_TOKEN}`);
    if (!ok) return new Response("unauthorized", { status: 401 });
    return app.fetch(req, env, ctx);
  },
};
