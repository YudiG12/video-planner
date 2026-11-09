"""Writes the README images' sources: banner.html, hld.html and by.html, each with a light and a dark theme
(?theme=dark). Render each to PNG at 2x (any headless browser); the README uses the light ones.
Style: the author's brand book (navy + sand, 1px borders, 4px corners, Onest / Oxanium)."""
import json, os
D = os.path.dirname(os.path.abspath(__file__))
B = json.load(open(os.path.join(D, "..", "architecture", "brands.json")))
L = {
 "phone": '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
 "branch": '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
 "sparkles": '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
 "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 "terminal": '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
 "chat": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
 "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 "lock": '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
 "play": '<path d="M6 4l14 8-14 8z"/>',
 "file": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8M16 17H8M16 13h-2"/>',
}
def ic(n, c, z):
    if n in B: return f'<svg viewBox="0 0 24 24" width="{z}" height="{z}"><path d="{B[n]}" fill="{c}"/></svg>'
    return f'<svg viewBox="0 0 24 24" width="{z}" height="{z}" fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{L[n]}</svg>'
HEAD = '''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=Oxanium:wght@600&display=swap" rel="stylesheet">
<script>if (location.search.includes("theme=dark")) document.documentElement.dataset.theme = "dark";</script>
<style>
:root{--bg:#FFFFFF;--line:#E3E8ED;--line2:#CBD3DB;--ink:#1B2632;--muted:#4A5D72;--subtle:#677A8E;--arrow:#677A8E;
 --sand-bg:#FCFAF7;--sand-line:#E6D5C1;--sand-ink:#5B4630;--sand:#8A6A3F;--git:#B8A58E;
 --tag-bg:#FEF3EA;--tag-line:#F8CFAE;--tag:#B4530C;--bezel:#1B2632;--screen:#E8EEF4;--bar:#CBD3DB;--base:#C3CBD3}
[data-theme=dark]{--bg:#0D1117;--line:#30363D;--line2:#3D4752;--ink:#F0F3F6;--muted:#B6C1CC;--subtle:#8E9DAD;--arrow:#8E9DAD;
 --sand-bg:#1A1712;--sand-line:#5B4630;--sand-ink:#E6D5C1;--sand:#C9A77F;--git:#8A6A3F;
 --tag-bg:#2A170A;--tag-line:#7A3D10;--tag:#F6A25E;--bezel:#4A5866;--screen:#E8EEF4;--bar:#CBD3DB;--base:#8E9DAD}
*{box-sizing:border-box;margin:0}body{background:var(--bg);font-family:Onest,sans-serif;color:var(--ink)}
.eb{font-family:Oxanium;font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--subtle)}
.tile{display:flex;align-items:center;justify-content:center;border-radius:4px;flex:none}
.nm{position:absolute;width:200px;text-align:center;font-weight:700;font-size:17px;color:var(--ink);letter-spacing:-.01em}
</style></head><body>'''
def tile(n, c, s, i): return f'<div class="tile" style="width:{s}px;height:{s}px;background:color-mix(in srgb,{c} 14%,var(--bg))">{ic(n, c, i)}</div>'

SUBS = "120K"  # YouTube subscribers, update when it grows
# ---------- banner 1280 x 300 ----------
tags = "".join(f'<span style="font-size:13px;font-weight:600;padding:4px 9px;border-radius:4px;background:var(--tag-bg);color:var(--tag);border:1px solid var(--tag-line)">{t}</span>' for t in ["Workers", "D1", "Access", "MCP", "React"])
def col(title, bg, cards):
    cs = "".join(f'<div style="background:var(--bg);border:1px solid var(--line2);border-radius:4px;padding:8px 9px;font-size:12.5px;font-weight:600;line-height:1.25">{c}<i style="display:block;margin-top:7px;width:38px;height:6px;border-radius:2px;background:{t}"></i></div>' for c, t in cards)
    return f'<div style="width:150px;padding:9px;border-radius:4px;background:{bg};display:flex;flex-direction:column;gap:7px;border:1px solid var(--line)"><span class="eb" style="font-size:10.5px">{title}</span>{cs}</div>'
board = col("Ideas", "#F9E9EE", [("Git rebase without fear", "#BFE3E6"), ("Use early returns", "#C9D8EE"), ("How an index works", "#BFE3E6")]) + col("This month", "#E6EEF7", [("Caching: when it helps", "#BFE3E6"), ("A day at a coffee shop", "#EDD9B4")]) + col("Published", "#E3F3EA", [("Docker from zero", "#BFE3E6"), ("Small commits", "#C9D8EE"), ("My study routine", "#EDD9B4")])
banner = HEAD + f"""<div style="width:1280px;height:364px;position:relative;border:1px solid var(--line);border-radius:4px;background:var(--bg);overflow:hidden">
<div style="position:absolute;left:64px;top:54px;width:640px">
 <div style="font-weight:800;font-size:62px;line-height:1.02;letter-spacing:-.03em">Video Planner</div>
 <div style="font-size:21px;color:var(--muted);margin-top:14px;line-height:1.35">Plan YouTube videos and reels, with scripts<br>your AI agent can read and write.</div>
 <div style="display:flex;gap:8px;margin-top:22px;align-items:center">{ic("cloudflare", "#F38020", 26)}{tags}</div>
</div>
<div style="position:absolute;left:720px;top:40px;display:flex;gap:10px;align-items:flex-start">{board}</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:64px;border-top:1px solid var(--line);background:var(--sand-bg);display:flex;align-items:center;gap:12px;padding:0 64px">
 <img src="avatar.jpg" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1px solid var(--sand-line)">
 <span style="font-size:15px;color:var(--muted)">A project by <b style="color:var(--ink);font-weight:700">Yudi Ganeko</b> · software engineer, code and dev careers</span>
 <span style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:15px;color:var(--muted)"><svg width="26" height="19" viewBox="0 0 18 13"><rect width="18" height="13" rx="3" fill="#E5322D"/><path d="M7 3.5v6l5-3z" fill="#fff"/></svg><b style="color:var(--ink);font-weight:700">{SUBS}</b> subscribers on YouTube</span>
</div>
</div></body></html>"""
open(os.path.join(D, "banner.html"), "w").write(banner)

# ---------- high-level design 1200 x 500 ----------
def sq(cx, cy, n, c, name, s=104):
    return (f'<div style="position:absolute;left:{cx-s/2}px;top:{cy-s/2}px;width:{s}px;height:{s}px;border:1px solid var(--line2);border-radius:4px;background:color-mix(in srgb,{c} 12%,var(--bg));display:flex;align-items:center;justify-content:center">{ic(n, c, 50)}</div>'
            f'<div class="nm" style="left:{cx-100}px;top:{cy+s/2+12}px">{name}</div>')
mac = '''<svg width="170" height="112" viewBox="0 0 170 112"><rect x="22" y="4" width="126" height="84" rx="6" fill="var(--bezel)"/><rect x="28" y="10" width="114" height="72" rx="2" fill="var(--screen)"/>
<rect x="36" y="18" width="46" height="5" rx="1" fill="var(--bar)"/><rect x="36" y="28" width="70" height="4" rx="1" fill="var(--bar)"/><rect x="36" y="36" width="60" height="4" rx="1" fill="var(--bar)"/><rect x="36" y="44" width="66" height="4" rx="1" fill="var(--bar)"/>
<rect x="36" y="56" width="28" height="18" rx="2" fill="#D97757" opacity=".85"/><path d="M4 92 H166 L160 104 Q158 107 154 107 H16 Q12 107 10 104 Z" fill="var(--base)"/><rect x="72" y="92" width="26" height="4" rx="2" fill="var(--bezel)" opacity=".4"/></svg>'''
phone = '''<svg width="70" height="124" viewBox="0 0 70 124"><rect x="2" y="2" width="66" height="120" rx="12" fill="var(--bezel)"/><rect x="7" y="7" width="56" height="110" rx="8" fill="var(--screen)"/>
<rect x="26" y="11" width="18" height="5" rx="2.5" fill="var(--bezel)"/><rect x="14" y="26" width="34" height="5" rx="1" fill="var(--bar)"/><rect x="14" y="36" width="42" height="4" rx="1" fill="var(--bar)"/><rect x="14" y="44" width="38" height="4" rx="1" fill="var(--bar)"/>
<rect x="24" y="62" width="32" height="14" rx="3" fill="#5A4BD1" opacity=".85"/><rect x="14" y="82" width="30" height="12" rx="3" fill="var(--bar)"/><rect x="26" y="108" width="18" height="3" rx="1.5" fill="var(--bar)"/></svg>'''
laptop = mac
M = '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" style="fill:var(--arrow)"/></marker></defs>'
hld = HEAD + f"""<div style="width:1200px;height:520px;position:relative;background:var(--bg)">
<div style="position:absolute;left:330px;top:40px;width:840px;height:456px;border:1px dashed var(--line2);border-radius:4px"></div>
<div style="position:absolute;left:348px;top:54px;display:flex;align-items:center;gap:8px" class="eb">{ic("cloudflare", "#F38020", 18)}<span>Cloudflare</span></div>
<svg style="position:absolute;left:0;top:0" width="1200" height="500">{M}
<g fill="none" style="stroke:var(--arrow)" stroke-width="1.8" marker-end="url(#a)">
 <path d="M190 176 H408"/><path d="M522 176 H628"/><path d="M190 376 H628"/>
 <path d="M742 176 H820 V262 H892"/><path d="M742 376 H820 V290 H892"/></g></svg>
{sq(137, 176, "user", "#4A5866", "You")}
{sq(137, 376, "claude", "#D97757", "Your AI agent")}
{sq(465, 176, "lock", "#2F8A5B", "Access")}{sq(685, 176, "workers", "#F38020", "App Worker")}{sq(685, 376, "workers", "#F38020", "Agent Worker")}{sq(950, 276, "database", "#D1495B", "D1")}
<div style="position:absolute;left:585px;top:470px;width:200px;text-align:center;font-size:13px;color:var(--subtle)">MCP · Bearer token</div>
<div style="position:absolute;left:585px;top:270px;width:200px;text-align:center;font-size:13px;color:var(--subtle)">React app · REST API</div>
<div style="position:absolute;left:365px;top:270px;width:200px;text-align:center;font-size:13px;color:var(--subtle)">login · JWT</div>
<div style="position:absolute;left:850px;top:370px;width:200px;text-align:center;font-size:13px;color:var(--subtle)">videos · scripts · images</div>
</div></body></html>"""
open(os.path.join(D, "hld.html"), "w").write(hld)

# ---------- "a project by" card 520 x 112 ----------
by = HEAD + f"""<div style="width:520px;height:112px;display:flex;align-items:center;gap:18px;padding:0 22px;border:1px solid var(--line2);border-radius:4px;background:var(--sand-bg)">
 <img src="avatar.jpg" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:1px solid var(--sand-line)">
 <div style="flex:1">
  <div class="eb" style="font-size:11px;color:var(--sand)">A project by</div>
  <div style="font-weight:800;font-size:26px;letter-spacing:-.02em;line-height:1.1;margin-top:2px">Yudi Ganeko</div>
  <div style="font-size:14px;color:var(--muted);margin-top:4px">Software engineer · code and dev careers</div>
 </div>
 <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-left:18px;border-left:1px solid var(--sand-line)">
  <svg width="44" height="31" viewBox="0 0 18 13"><rect width="18" height="13" rx="3" fill="#E5322D"/><path d="M7 3.5v6l5-3z" fill="#fff"/></svg>
  <div style="font-weight:800;font-size:17px;line-height:1">{SUBS}</div><div style="font-size:11.5px;color:var(--subtle)">subscribers</div>
 </div>
</div></body></html>"""
open(os.path.join(D, "by.html"), "w").write(by)
print("ok")
