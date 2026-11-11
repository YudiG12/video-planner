// Single data layer: the REST API and MCP share the same functions.
export type Format = "longo" | "vertical";
export const STATUSES = ["Ideias", "Esse mês", "Produzindo", "Editando", "Finalizado", "Cancelados"] as const;

export interface Video {
  id: string;
  title: string;
  format: Format;
  status: string;
  series_id: string | null;
  episode: number | null;
  sponsor_id: string | null;
  publish_date: string | null;
  position: number;
  script: Record<string, unknown>;
  derivatives: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

type Row = Omit<Video, "script" | "derivatives"> & { script: string; derivatives: string };
const parse = (r: Row): Video => ({ ...r, script: JSON.parse(r.script || "{}"), derivatives: JSON.parse(r.derivatives || "{}") });
const newId = () => crypto.randomUUID().slice(0, 8);

export const SERIES_FIELDS = ["logo", "color", "bg", "description"] as const;
export type SeriesPatch = Partial<Record<(typeof SERIES_FIELDS)[number], string | null>>;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ASSET_URL = /^\/api\/assets\/[0-9a-f]{16}$/;
export function validateSeriesPatch(p: unknown): string | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "body must be an object";
  const o = p as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !(SERIES_FIELDS as readonly string[]).includes(k));
  if (unknown.length) return `unknown field(s): ${unknown.join(", ")} (allowed: ${SERIES_FIELDS.join(", ")})`;
  for (const k of ["color", "bg"] as const) if (k in o && !(typeof o[k] === "string" && HEX.test(o[k] as string))) return `${k} must be a #RRGGBB hex color`;
  if ("logo" in o && o.logo !== null && !(typeof o.logo === "string" && ASSET_URL.test(o.logo))) return "logo must be an asset URL from upload_image (/api/assets/<id>) or null";
  if ("description" in o && o.description !== null && !(typeof o.description === "string" && o.description.length <= 500)) return "description must be a string (max 500 chars) or null";
  return null;
}

export class Store {
  constructor(private db: D1Database, private actor: string) {}
  get database() { return this.db; }

  async bootstrap() {
    const [series, sponsors] = await Promise.all([
      this.db.prepare("SELECT * FROM series ORDER BY position").all(),
      this.db.prepare("SELECT * FROM sponsors ORDER BY name").all(),
    ]);
    return { series: series.results, sponsors: sponsors.results, statuses: STATUSES };
  }

  async list(f: { format?: string; status?: string; series_id?: string; from?: string; to?: string } = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.format) { where.push("format = ?"); args.push(f.format); }
    if (f.status) { where.push("status = ?"); args.push(f.status); }
    if (f.series_id) { where.push("series_id = ?"); args.push(f.series_id); }
    if (f.from) { where.push("publish_date >= ?"); args.push(f.from); }
    if (f.to) { where.push("publish_date <= ?"); args.push(f.to); }
    const sql = `SELECT * FROM videos ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY position, created_at`;
    const r = await this.db.prepare(sql).bind(...args).all<Row>();
    return r.results.map(parse);
  }

  async get(id: string) {
    const r = await this.db.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first<Row>();
    if (!r) return null;
    const h = await this.db.prepare("SELECT actor, action, at FROM history WHERE video_id = ? ORDER BY at DESC, id DESC LIMIT 20").bind(id).all();
    return { ...parse(r), history: h.results };
  }

  private async log(videoId: string, action: string, before?: unknown) {
    await this.db.prepare("INSERT INTO history (video_id, actor, action, before) VALUES (?, ?, ?, ?)")
      .bind(videoId, this.actor, action, before === undefined ? null : JSON.stringify(before)).run();
  }

  async create(v: Partial<Video> & { title: string; format: Format }) {
    const id = newId();
    const status = v.status ?? "Ideias";
    const max = await this.db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM videos WHERE status = ?").bind(status).first<{ m: number }>();
    let episode = v.episode ?? null;
    if (v.series_id && episode == null) episode = await this.nextEpisode(v.series_id);
    await this.db.prepare(`INSERT INTO videos (id, title, format, status, series_id, episode, sponsor_id, publish_date, position, script, derivatives)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, v.title, v.format, status, v.series_id ?? null, episode, v.sponsor_id ?? null, v.publish_date ?? null,
      (max?.m ?? 0) + 1, JSON.stringify(v.script ?? {}), JSON.stringify(v.derivatives ?? {})).run();
    await this.log(id, "Criou o vídeo");
    return this.get(id);
  }

  async update(id: string, patch: Partial<Video>) {
    const cur = await this.get(id);
    if (!cur) return null;
    const fields = ["title", "format", "status", "series_id", "episode", "sponsor_id", "publish_date", "position"] as const;
    const sets: string[] = [];
    const args: unknown[] = [];
    const before: Record<string, unknown> = {};
    for (const k of fields) {
      if (k in patch) { sets.push(`${k} = ?`); args.push((patch as any)[k]); before[k] = (cur as any)[k]; }
    }
    if (patch.derivatives) {
      sets.push("derivatives = ?");
      args.push(JSON.stringify({ ...cur.derivatives, ...patch.derivatives }));
      before.derivatives = cur.derivatives;
    }
    if (patch.script) {
      // shallow merge: the agent edits one block without wiping the others
      sets.push("script = ?");
      args.push(JSON.stringify({ ...cur.script, ...patch.script }));
      before.script = cur.script;
    }
    if (!sets.length) return cur;
    sets.push("updated_at = datetime('now')");
    await this.db.prepare(`UPDATE videos SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
    const changed = Object.keys(before);
    const label = changed.includes("status") ? `Mudou o status pra ${patch.status}`
      : changed.includes("script") ? `Editou ${Object.keys(patch.script!).join(", ")}`
      : `Editou ${changed.join(", ")}`;
    await this.log(id, label, before);
    return this.get(id);
  }

  async move(id: string, status: string, position?: number) {
    let pos = position;
    if (pos == null) {
      const max = await this.db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM videos WHERE status = ?").bind(status).first<{ m: number }>();
      pos = (max?.m ?? 0) + 1;
    }
    return this.update(id, { status, position: pos });
  }

  async nextEpisode(seriesId: string) {
    const r = await this.db.prepare("SELECT COALESCE(MAX(episode), 0) AS m FROM videos WHERE series_id = ?").bind(seriesId).first<{ m: number }>();
    return (r?.m ?? 0) + 1;
  }

  // Series appearance: logo (asset URL from upload_image, or null to clear), color/bg (#hex), description.
  async updateSeries(id: string, body: unknown): Promise<Record<string, unknown> | { error: string; status: number }> {
    const cur = await this.db.prepare("SELECT * FROM series WHERE id = ?").bind(id).first();
    if (!cur) return { error: "series not found", status: 404 };
    const err = validateSeriesPatch(body);
    if (err) return { error: err, status: 400 };
    const patch = body as SeriesPatch;
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const k of SERIES_FIELDS) if (k in patch) { sets.push(`${k} = ?`); args.push(patch[k] ?? null); }
    if (sets.length) await this.db.prepare(`UPDATE series SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
    return (await this.db.prepare("SELECT * FROM series WHERE id = ?").bind(id).first())!;
  }

  async remove(id: string) {
    await this.db.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
    return { ok: true };
  }
}

// Images (prints, logos): data URL of png/jpeg/webp/gif, max 1.5 MB decoded. Shared by REST and MCP.
export async function saveAsset(db: D1Database, data: unknown): Promise<{ id: string; url: string } | { error: string; status: number }> {
  if (typeof data !== "string" || data.length > 2_100_000) return { error: "image too large", status: 413 };
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) return { error: "invalid image", status: 400 };
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  if (bytes.length > 1_500_000) return { error: "image too large", status: 413 };
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await db.prepare("INSERT INTO assets (id, mime, data) VALUES (?, ?, ?)").bind(id, m[1], bytes).run();
  return { id, url: `/api/assets/${id}` };
}
