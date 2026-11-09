import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
// WRANGLER_CONFIG lets you build against a private, git-ignored config (e.g. wrangler.local.jsonc).
export default defineConfig({ plugins: [react(), cloudflare({ configPath: process.env.WRANGLER_CONFIG || "wrangler.jsonc" })] });
