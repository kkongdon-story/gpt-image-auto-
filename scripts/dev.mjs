import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devServerUrl = "http://127.0.0.1:5173";
const isWindows = process.platform === "win32";

function buildEnv() {
  const env = { ...process.env, VITE_DEV_SERVER_URL: devServerUrl };
  if (!isWindows) {
    return env;
  }

  const systemRoot = env.SystemRoot || env.windir || "C:\\Windows";
  const additions = [
    path.join(systemRoot, "System32"),
    systemRoot,
    path.join(systemRoot, "System32", "Wbem"),
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0")
  ];
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  const currentPath = env[pathKey] ?? "";
  const seen = new Set(currentPath.split(path.delimiter).filter(Boolean).map((entry) => entry.toLowerCase()));
  const normalizedPath = [
    currentPath,
    ...additions.filter((entry) => !seen.has(entry.toLowerCase()))
  ].filter(Boolean).join(path.delimiter);

  env.ComSpec = env.ComSpec || path.join(systemRoot, "System32", "cmd.exe");
  env.Path = normalizedPath;
  env.PATH = normalizedPath;
  return env;
}

function streamWithPrefix(child, label) {
  const pipe = (stream, target) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.length > 0) {
          target.write(`[${label}] ${line}\n`);
        }
      }
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
}

function spawnNode(label, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  streamWithPrefix(child, label);
  return child;
}

function waitForPort(port, host, timeoutMs) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });

      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 150);
      });
    };

    attempt();
  });
}

function terminate(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
}

const env = buildEnv();
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronEntry = path.join(root, "node_modules", "electron", "cli.js");
let shuttingDown = false;
let electronStarted = false;

const vite = spawnNode("vite", [viteEntry, "--host", "127.0.0.1"], env);

const shutdown = (code) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  terminate(vite);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500).unref();
};

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

vite.once("exit", (code) => {
  if (shuttingDown) {
    process.exit(process.exitCode ?? 0);
  }
  if (!shuttingDown && !electronStarted) {
    shutdown(code ?? 1);
  }
});

try {
  await waitForPort(5173, "127.0.0.1", 15_000);
  electronStarted = true;
  const electron = spawnNode("electron", [electronEntry, "."], env);
  electron.once("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
