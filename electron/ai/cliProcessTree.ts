import { spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { buildProviderProbeEnv } from "./cliEnvironment.js";

export function terminateProviderProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (!pid) {
    child.kill();
    return;
  }

  if (process.platform === "win32") {
    terminateWindowsProcessTree(child, pid);
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function terminateWindowsProcessTree(child: ChildProcessWithoutNullStreams, pid: number): void {
  const windowsRoot = process.env["WINDIR"]?.trim() || process.env["SystemRoot"]?.trim() || "C:\\Windows";
  const pids = [pid, ...findWindowsDescendantPids(windowsRoot, pid)].filter((value, index, values) => {
    return Number.isInteger(value) && value > 0 && values.indexOf(value) === index;
  });
  let killedAny = false;
  for (const processId of pids.reverse()) {
    const result = spawnSync(path.join(windowsRoot, "System32", "taskkill.exe"), ["/pid", String(processId), "/T", "/F"], {
      env: buildProviderProbeEnv(),
      shell: false,
      timeout: 5_000,
      windowsHide: true
    });
    killedAny = killedAny || result.status === 0;
  }
  if (!killedAny) {
    child.kill();
  }
}

function findWindowsDescendantPids(windowsRoot: string, pid: number): readonly number[] {
  const script = [
    `$root=${pid};`,
    "$items=Get-Process | Select-Object Id,Parent;",
    "$children=@{};",
    "foreach($item in $items){",
    "  if($null -eq $item.Parent){ continue }",
    "  $parent=[int]$item.Parent.Id;",
    "  if(-not $children.ContainsKey($parent)){ $children[$parent]=@() }",
    "  $children[$parent]+=[int]$item.Id;",
    "}",
    "$queue=@($root);",
    "$found=@();",
    "while($queue.Count -gt 0){",
    "  $current=[int]$queue[0];",
    "  if($queue.Count -eq 1){ $queue=@() } else { $queue=$queue[1..($queue.Count-1)] }",
    "  if($children.ContainsKey($current)){",
    "    foreach($child in $children[$current]){ $found+=$child; $queue+=$child }",
    "  }",
    "}",
    "$found -join ','"
  ].join(" ");
  const programFiles = process.env["ProgramFiles"]?.trim() || "C:\\Program Files";
  const candidates = [
    path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    "pwsh.exe",
    path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  ];
  for (const powershell of candidates) {
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: buildProviderProbeEnv(),
      shell: false,
      timeout: 5_000,
      windowsHide: true
    });
    if (result.status !== 0) {
      continue;
    }
    const pids = parsePidList(result.stdout ?? "");
    if (pids.length > 0) {
      return pids;
    }
  }
  return [];
}

function parsePidList(output: string): readonly number[] {
  return output
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}
