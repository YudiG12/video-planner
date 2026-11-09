# Security

## Access model

- **People:** Cloudflare Access in front of the `video-planner` Worker. The Worker also verifies the `Cf-Access-Jwt-Assertion` JWT (RS256 signature against `https://<team>/cdn-cgi/access/certs`, audience, issuer, expiry).
- **Agents:** the `video-planner-agent` Worker requires `Authorization: Bearer <AGENT_TOKEN>` on every request, compared in constant time. Keep the token in `.agent-token` (git-ignored) and in your MCP client config.
- **Fail closed:** with no secrets configured, every request gets `401`. Local development opens only with `DEV_OPEN=1` in `.dev.vars` (git-ignored) and a `localhost` host.
- **Uploads:** only PNG, JPEG, WebP and GIF; served with `nosniff` and a sandboxing CSP. Writes require `Content-Type: application/json` (blocks cross-site form posts).
- **Links in scripts:** only `http(s)` and internal paths; `javascript:` and `data:` are rejected.
- **Secrets** live only in Worker secrets. Nothing secret is committed; `wrangler.jsonc` holds only the D1 id, which is not a credential.
- **Rotate the agent token:** generate a new one, `wrangler secret put AGENT_TOKEN` on both Workers, update your MCP client.


## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/YudiG12/video-planner/security/advisories/new) instead of a public issue.
