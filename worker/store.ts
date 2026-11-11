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
  script_versions: Record<string, number>; // block -> version (missing = 0)
  derivatives: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

type Row = Omit<Video, "script" | "derivatives" | "script_versions"> & { script: string; derivatives: string; script_versions?: string | null };
const parse = (r: Row): Video => ({ ...r, script: JSON.parse(r.script || "{}"), script_versions: JSON.parse(r.script_versions || "{}"), derivatives: JSON.parse(r.derivatives || "{}") });
// videos.* plus a { block: version } object from script_blocks
const SELECT_VIDEO = "SELECT v.*, (SELECT json_group_object(b.block, b.version) FROM script_blocks b WHERE b.video_id = v.id) AS script_versions FROM videos v";

// Known script blocks per format. Anything else (typos like "hook ", "intro") is rejected.
export const SCRIPT_BLOCKS: Record<Format, readonly string[]> = {
  longo: ["pairs", "thumb_desc", "hook", "conteudo", "insercao", "conclusao"],
  vertical: ["capa", "gancho", "conteudo", "conclusao"],
};
const OBJECT_BLOCKS: Record<string, "object" | "array"> = { hook: "object", pairs: "array" };
export function validateBlock(format: Format, block: unknown, value: unknown): string | null {
  const allowed = SCRIPT_BLOCKS[format] ?? [];
  if (typeof block !== "string" || !allowed.includes(block)) return `unknown script block ${JSON.stringify(block)} for format ${format} (allowed: ${allowed.join(", ")})`;
  const kind = OBJECT_BLOCKS[block];
  if (value === null) return null; // clears the block
  if (kind === "array" ? !Array.isArray(value) : kind === "object" ? !(value && typeof value === "object" && !Array.isArray(value)) : typeof value !== "string")
    return `block ${block} must be ${kind === "array" ? "an array" : kind === "object" ? "an object" : "a string"}`;
  return null;
}
export type BlockError = { error: string; status: number; code?: "conflict"; block?: string; current?: { value: unknown; version: number } };
const isBlockError = (x: unknown): x is BlockError => !!x && typeof x === "object" && "error" in x;
export { isBlockError };
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
    if (f.format) { where.push("v.format = ?"); args.push(f.format); }
    if (f.status) { where.push("v.status = ?"); args.push(f.status); }
    if (f.series_id) { where.push("v.series_id = ?"); args.push(f.series_id); }
    if (f.from) { where.push("v.publish_date >= ?"); args.push(f.from); }
    if (f.to) { where.push("v.publish_date <= ?"); args.push(f.to); }
    const sql = `${SELECT_VIDEO} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY v.position, v.created_at`;
    const r = await this.db.prepare(sql).bind(...args).all<Row>();
    return r.results.map(parse);
  }

  async get(id: string) {
    const r = await this.db.prepare(`${SELECT_VIDEO} WHERE v.id = ?`).bind(id).first<Row>();
    if (!r) return null;
    const h = await this.db.prepare("SELECT actor, action, at FROM history WHERE video_id = ? ORDER BY at DESC, id DESC LIMIT 20").bind(id).all();
    return { ...parse(r), history: h.results };
  }

  private async log(videoId: string, action: string, before?: unknown) {
    await this.db.prepare("INSERT INTO history (video_id, actor, action, before) VALUES (?, ?, ?, ?)")
      .bind(videoId, this.actor, action, before === undefined ? null : JSON.stringify(before)).run();
  }

  async create(v: Partial<Video> & { title: string; format: Format }): Promise<Video | BlockError | null> {
    for (const [k, val] of Object.entries(v.script ?? {})) { const e = validateBlock(v.format, k, val); if (e) return { error: e, status: 400 }; }
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

  // `script` here goes block by block through setBlock (validated + versioned).
  // Optional `base_versions: { block: n }` makes each block write fail with a conflict if it changed since version n.
  async update(id: string, patch: Partial<Video> & { base_versions?: Record<string, number> }): Promise<Video | BlockError | null> {
    const cur = await this.get(id);
    if (!cur) return null;
    const { script, base_versions, ...rest } = patch;
    if (script !== undefined) {
      if (!script || typeof script !== "object" || Array.isArray(script)) return { error: "script must be an object of blocks", status: 400 };
      const format = (rest.format ?? cur.format) as Format;
      for (const [k, val] of Object.entries(script)) { const e = validateBlock(format, k, val); if (e) return { error: e, status: 400 }; }
      // check every base version first so a conflicting request changes nothing
      for (const k of Object.keys(script)) {
        const base = base_versions?.[k];
        if (base !== undefined && base !== (cur.script_versions[k] ?? 0)) return this.conflict(cur, k);
      }
    }
    if (Object.keys(rest).length) {
      const r = await this.updateFields(cur, rest);
      if (!script) return r;
    }
    for (const [k, val] of Object.entries(script ?? {})) {
      const r = await this.setBlock(id, k, val, base_versions?.[k]);
      if (isBlockError(r)) return r;
    }
    return this.get(id);
  }

  private conflict(cur: Video, block: string): BlockError {
    const version = cur.script_versions[block] ?? 0;
    return { error: `conflict: block ${block} changed since your base_version (current version is ${version}); re-read it, merge, and retry with base_version ${version}`,
      status: 409, code: "conflict", block, current: { value: cur.script[block] ?? null, version } };
  }

  // One script block: read with its version and previous value.
  async getBlock(id: string, block: string): Promise<Record<string, unknown> | BlockError> {
    // value, version and previous value come from ONE query, so they always belong together
    const r = await this.db.prepare(`SELECT v.format, v.script -> ?1 AS value,
        b.version, b.prev, b.actor, b.updated_at
      FROM videos v LEFT JOIN script_blocks b ON b.video_id = v.id AND b.block = ?2 WHERE v.id = ?3`)
      .bind(`$."${block.replace(/["\\]/g, "")}"`, block, id)
      .first<{ format: Format; value: string | null; version: number | null; prev: string | null; actor: string | null; updated_at: string | null }>();
    if (!r) return { error: "not found", status: 404 };
    const known = SCRIPT_BLOCKS[r.format] ?? [];
    if (!known.includes(block)) return { error: `unknown script block ${JSON.stringify(block)} for format ${r.format} (allowed: ${known.join(", ")})`, status: 400 };
    const version = r.version ?? 0;
    return { block, value: r.value == null ? null : JSON.parse(r.value), version,
      previous: version > 0 ? { value: r.prev == null ? null : JSON.parse(r.prev), version: version - 1 } : null,
      updated_by: r.actor ?? null, updated_at: r.updated_at ?? null };
  }

  // Write one script block. With baseVersion, the write only happens if the block is still at that version (else 409 conflict).
  // Atomic in one D1 batch: bump the version (conditionally), save the previous value, json_set the block.
  async setBlock(id: string, block: string, value: unknown, baseVersion?: number | null): Promise<{ block: string; value: unknown; version: number } | BlockError> {
    if (baseVersion != null && !(Number.isInteger(baseVersion) && baseVersion >= 0)) return { error: "base_version must be a non-negative integer", status: 400 };
    const cur = await this.get(id);
    if (!cur) return { error: "not found", status: 404 };
    const err = validateBlock(cur.format, block, value);
    if (err) return { error: err, status: 400 };
    const curVersion = cur.script_versions[block] ?? 0;
    if (JSON.stringify(cur.script[block] ?? null) === JSON.stringify(value ?? null)) {
      // same content: nothing to save, not a conflict
      return { block, value: value ?? null, version: curVersion };
    }
    const path = `$."${block}"`; // block is from the SCRIPT_BLOCKS allow-list
    const base = baseVersion ?? null;
    const res = await this.db.batch([
      this.db.prepare("INSERT INTO script_blocks (video_id, block, version) VALUES (?, ?, 0) ON CONFLICT DO NOTHING").bind(id, block),
      this.db.prepare(`UPDATE script_blocks SET version = version + 1, actor = ?1, updated_at = datetime('now'),
          prev = (SELECT script -> ?2 FROM videos WHERE id = ?3)
        WHERE video_id = ?3 AND block = ?4 AND (?5 IS NULL OR version = ?5)`).bind(this.actor, path, id, block, base),
      this.db.prepare("UPDATE videos SET script = json_set(script, ?, json(?)), updated_at = datetime('now') WHERE id = ? AND changes() > 0")
        .bind(path, JSON.stringify(value ?? null), id),
      // read inside the same transaction: the version this write produced, not a later writer's
      this.db.prepare("SELECT version FROM script_blocks WHERE video_id = ? AND block = ?").bind(id, block),
    ]);
    if (!res[1].meta.changes) return this.conflict((await this.get(id))!, block);
    const version = (res[3].results[0] as { version: number }).version;
    await this.log(id, `Editou ${block}`, { script: { [block]: cur.script[block] ?? null } });
    return { block, value: value ?? null, version };
  }

  private async updateFields(cur: Video, patch: Partial<Video>) {
    const id = cur.id;
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
    if (!sets.length) return cur;
    sets.push("updated_at = datetime('now')");
    await this.db.prepare(`UPDATE videos SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
    const changed = Object.keys(before);
    const label = changed.includes("status") ? `Mudou o status pra ${patch.status}`
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
