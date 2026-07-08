import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edition = process.argv[2] === "lite" ? "lite" : "pro";
const nodeBin = process.execPath;

function runNode(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit"
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${args.join(" ")} exited with ${code ?? "signal"}`));
    });
  });
}

async function buildRenderer(targetEdition) {
  const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
  await runNode([viteEntry, "build"], { VITE_EDITION: targetEdition });
}

async function buildLiteElectronBundle(preloadSource) {
  const preloadBytes = await fs.readFile(preloadSource);
  await fs.rm(path.join(root, "dist-electron"), { recursive: true, force: true });
  await fs.mkdir(path.join(root, "dist-electron", "electron"), { recursive: true });
  await fs.writeFile(path.join(root, "dist-electron", "electron", "preload.cjs"), preloadBytes);

  await viteBuild({
    configFile: false,
    root,
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: path.join(root, "dist-electron", "electron"),
      rollupOptions: {
        external: (id) => id === "electron" || id === "adm-zip" || id.startsWith("node:"),
        output: {
          chunkFileNames: "chunks/[name]-[hash].js",
          entryFileNames: "main.js",
          format: "es"
        }
      },
      ssr: path.join(root, "electron", "lite-main.ts"),
      target: "node22"
    }
  });
}

async function main() {
  const tscEntry = path.join(root, "node_modules", "typescript", "bin", "tsc");
  await runNode([tscEntry, "-b", "--pretty", "false"]);

  if (edition === "pro") {
    await buildRenderer("pro");
    return;
  }

  const litePreload = path.join(root, "dist-electron", "electron", "preload-lite.cjs");
  await fs.access(litePreload);
  await buildRenderer("lite");
  await buildLiteElectronBundle(litePreload);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
