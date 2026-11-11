export type Format = "longo" | "vertical";
export interface Series { id: string; name: string; format: Format; color: string; bg: string; description: string | null; phrase_open: string | null; phrase_close: string | null; position: number; logo?: string | null }
export interface Sponsor { id: string; name: string; logo: string | null }
export interface Video {
  id: string; title: string; format: Format; status: string;
  series_id: string | null; episode: number | null; sponsor_id: string | null;
  publish_date: string | null; position: number;
  script: Record<string, any>; script_versions?: Record<string, number>; derivatives: Record<string, boolean>;
  history?: { actor: string; action: string; at: string }[];
}
export interface Channel { name: string; handle: string; avatar: string }
export interface Boot { series: Series[]; sponsors: Sponsor[]; statuses: string[]; channel?: Channel; locale?: string }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}
export type BlockSaved = { block: string; value: any; version: number };
export type BlockConflict = { error: string; code: "conflict"; block: string; current: { value: any; version: number } };
export const api = {
  // 409 resolves to the conflict (current value + version) instead of throwing
  putBlock: async (id: string, block: string, value: any, base_version: number): Promise<BlockSaved | BlockConflict> => {
    const r = await fetch(`/api/videos/${id}/script/${encodeURIComponent(block)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value, base_version }) });
    if (r.status === 409) return r.json();
    if (!r.ok) throw new Error(`${r.status} script/${block}`);
    return r.json();
  },
  boot: () => req<Boot>("/api/bootstrap"),
  list: () => req<Video[]>("/api/videos"),
  get: (id: string) => req<Video>(`/api/videos/${id}`),
  create: (v: Partial<Video>) => req<Video>("/api/videos", { method: "POST", body: JSON.stringify(v) }),
  update: (id: string, p: Partial<Video>) => req<Video>(`/api/videos/${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/videos/${id}`, { method: "DELETE" }),
  move: (id: string, status: string, position?: number) => req<Video>(`/api/videos/${id}/move`, { method: "POST", body: JSON.stringify({ status, position }) }),
};
