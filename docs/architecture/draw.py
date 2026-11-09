#!/usr/bin/env python3
"""Draws the architecture map (docs/architecture/architecture.svg) in the Ganeko Notebook style:
solid colored boxes with white text, navy captions, dashed arrows, solid pill labels.
Run: python3 docs/architecture/draw.py, then render the SVG to PNG at 2x."""
import html, json, os

# Brand marks from Simple Icons (CC0, https://simpleicons.org), filled; the rest are Lucide-style
# line icons (ISC), like the Ganeko Notebook's icon set.
BRANDS = json.load(open(os.path.join(os.path.dirname(__file__), "brands.json")))
LUCIDE = {
    "cpu": '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    "lock": '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    "branch": '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    "queue": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    "workflow": '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    "key": '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    "sparkles": '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    "terminal": '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    "browser": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/>',
    "image": '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    "play": '<path d="M6 4l14 8-14 8z"/>',
    "chat": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
}

def glyph(name, x, y, size=26):
    """A white icon at (x, y): a brand mark (filled) or a Lucide icon (stroked)."""
    k = size / 24
    if name in BRANDS:
        return f'<path transform="translate({x},{y}) scale({k})" d="{BRANDS[name]}" fill="#fff"/>'
    return f'<g transform="translate({x},{y}) scale({k})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{LUCIDE[name]}</g>'

C = dict(indigo="#5B5BD6", purple="#8E6FCB", teal="#3FA796", green="#2F8A5B", red="#D1495B", orange="#E08A3C", slate="#4A5866")
NAVY, MUTED, BG, LINE = "#1B2632", "#4A5D72", "#FCFAF7", "#677A8E"
W, H = 220, 64

def box(x, y, title, sub, color, caption=None, w=W, icons=()):
    t = f'<rect x="{x}" y="{y}" width="{w}" height="{H}" rx="6" fill="{C[color]}"/>'
    # icons on the left; text centred in the space that's left
    for i, name in enumerate(icons):
        t += glyph(name, x + 14 + i * 32, y + 19)
    left = x + (14 + 32 * len(icons) if icons else 0)
    cx = left + (x + w - left) / 2
    t += f'<text x="{cx}" y="{y + 27}" text-anchor="middle" class="t">{html.escape(title)}</text>'
    t += f'<text x="{cx}" y="{y + 47}" text-anchor="middle" class="s">{html.escape(sub)}</text>'
    if caption:
        t += f'<text x="{x + w/2}" y="{y + H + 18}" text-anchor="middle" class="c">{html.escape(caption)}</text>'
    return t

def arrow(points, label=None, at=0.5, both=False):
    d = "M" + " L".join(f"{x},{y}" for x, y in points)
    t = f'<path d="{d}" class="a" marker-end="url(#m)"{" marker-start=\"url(#ms)\"" if both else ""}/>'
    if label:
        # label on the longest segment
        segs = list(zip(points, points[1:]))
        (x1, y1), (x2, y2) = max(segs, key=lambda s: abs(s[1][0]-s[0][0]) + abs(s[1][1]-s[0][1]))
        lx, ly = x1 + (x2 - x1) * at, y1 + (y2 - y1) * at
        w = 7.2 * len(label) + 16
        t += f'<rect x="{lx - w/2}" y="{ly - 11}" width="{w}" height="22" rx="11" fill="{NAVY}"/>'
        t += f'<text x="{lx}" y="{ly + 4}" text-anchor="middle" class="p">{html.escape(label)}</text>'
    return t

def svg(width, height, title, subtitle, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" font-family="Onest, Inter, system-ui, sans-serif">
<defs>
<marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{LINE}"/></marker>
<marker id="ms" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{LINE}"/></marker>
<style>.t{{fill:#fff;font-size:15px;font-weight:700}}.s{{fill:#fff;font-size:12px;opacity:.92}}.c{{fill:{MUTED};font-size:12px}}
.a{{fill:none;stroke:{LINE};stroke-width:1.6;stroke-dasharray:6 5}}.p{{fill:#fff;font-size:11.5px;font-weight:600}}
.h{{fill:{NAVY};font-size:22px;font-weight:800}}.hs{{fill:{MUTED};font-size:13px}}.g{{fill:none;stroke:#E6D5C1;stroke-width:1.5;stroke-dasharray:2 4}}.gl{{fill:#8C6A43;font-size:12px;font-weight:600}}</style>
</defs>
<rect width="100%" height="100%" fill="{BG}"/>
<text x="32" y="44" class="h">{html.escape(title)}</text><text x="32" y="66" class="hs">{html.escape(subtitle)}</text>
{body}
</svg>'''

# ---------- architecture ----------
A, B, Cx, D = 40, 420, 800, 1180
g = []
g.append('<rect x="390" y="92" width="1040" height="560" rx="10" class="g"/>' + f'<path transform="translate(404,98) scale(0.75)" d="{BRANDS["cloudflare"]}" fill="#F38020"/>' + '<text x="428" y="112" class="gl">CLOUDFLARE</text>')
g.append(box(A, 150, "You", "browser", "slate", "kanban, calendar, script editor", icons=("browser",)))
g.append(box(A, 420, "AI agent", "Claude Code · any MCP client", "slate", "token in .agent-token", icons=("claude",)))
g.append(box(A, 290, "YouTube", "oEmbed", "slate", "titles for video references", icons=("play",)))
g.append(box(B, 150, "Access", "login · policy", "green", "your email only", icons=("lock",)))
g.append(box(Cx, 150, "App Worker", "SPA + REST API", "indigo", icons=("workers",)))
g.append(box(Cx, 420, "Agent Worker", "REST API + MCP", "indigo", "no UI, Bearer only", icons=("workers",)))
g.append(box(B, 290, "Access certs", "JWKS · cached 1h", "green", "JWT checked in the Worker", icons=("key",)))
g.append(box(D, 150, "Static assets", "React · TipTap", "orange", w=210, icons=("browser",)))
g.append(box(D, 290, "D1", "videos · series · sponsors", "red", "scripts as JSON blocks", w=210, icons=("database",)))
g.append(box(D, 420, "D1 · history", "who changed what", "red", "owner or agent", w=210, icons=("database",)))
g.append(box(D, 560, "D1 · assets", "screenshots · JPEG", "red", "max 1.5 MB, served with CSP", w=210, icons=("image",)))
g.append(arrow([(260, 182), (420, 182)], "HTTPS"))
g.append(arrow([(640, 182), (800, 182)], "JWT header"))
g.append(arrow([(860, 214), (860, 276), (690, 276), (690, 322), (640, 322)], "verify", at=0.5))
g.append(arrow([(1020, 170), (1180, 170)], "serve"))
g.append(arrow([(1020, 196), (1100, 196), (1100, 322), (1180, 322)], "SQL", at=0.5))
g.append(arrow([(260, 452), (800, 452)], "MCP · Bearer", at=0.5))
g.append(arrow([(1020, 452), (1180, 452)], "log"))
g.append(arrow([(1020, 436), (1130, 436), (1130, 336), (1180, 336)]))
g.append(arrow([(1020, 470), (1100, 470), (1100, 592), (1180, 592)], "images", at=0.6))
g.append(arrow([(800, 200), (760, 200), (760, 252), (320, 252), (320, 322), (260, 322)], "video titles", at=0.35))
open(os.path.join(os.path.dirname(__file__), "architecture.svg"), "w").write(svg(1460, 700, "Video Planner", "Two Workers over one D1 database: the app behind Cloudflare Access, the agent on its own Bearer-protected Worker.", "".join(g)))
print("ok")
