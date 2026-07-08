import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const edition = process.env["VITE_EDITION"] === "lite" ? "lite" : "pro";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@edition": path.join(rootDir, "src", "edition", edition)
    }
  },
  root: ".",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
