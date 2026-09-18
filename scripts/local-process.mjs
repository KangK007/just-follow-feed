import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const runtimeRoot = path.join(projectRoot, ".local", "runtime");
const launchLockName = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
const launchLockEndpoint = `\\\\.\\pipe\\just-follow-feed-${launchLockName}`;

function pidPath(name) {
  return path.join(runtimeRoot, `${name}.pid.json`);
}

function tryAcquireLaunchLock() {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(launchLockEndpoint, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

export async function acquireLaunchLock(timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let announcedWait = false;

  while (true) {
    try {
      const server = await tryAcquireLaunchLock();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      };
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "EADDRINUSE") throw error;
      if (!announcedWait) {
        console.log("检测到另一个启动流程，正在等待它完成...");
        announcedWait = true;
      }
      if (Date.now() >= deadline) {
        throw new Error("等待另一个启动流程超时，请确认没有遗留的启动命令后重试。");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function processCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0);
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    } catch {
      return "";
    }
  }

  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $item = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if ($item) { $item.CommandLine }`,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
  } catch {
    return "";
  }
}

function normalizedCommand(value) {
  return value.replaceAll("/", "\\").toLowerCase();
}

export function expectedProcess(pid, markerPath) {
  const commandLine = processCommandLine(pid);
  if (!commandLine) return false;
  return normalizedCommand(commandLine).includes(normalizedCommand(path.resolve(markerPath)));
}

export function readManagedPid(name, markerPath) {
  const filePath = pidPath(name);
  if (!existsSync(filePath)) return null;
  try {
    const record = JSON.parse(readFileSync(filePath, "utf8"));
    if (expectedProcess(record.pid, markerPath)) return record.pid;
  } catch {
    // Invalid and stale PID records are replaced on the next start.
  }
  rmSync(filePath, { force: true });
  return null;
}

export function writeManagedPid(name, pid) {
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    pidPath(name),
    `${JSON.stringify({ pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

export async function stopManagedProcess(name, markerPath) {
  const pid = readManagedPid(name, markerPath);
  if (!pid) return false;

  process.kill(pid);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && expectedProcess(pid, markerPath)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (expectedProcess(pid, markerPath)) {
    throw new Error(`无法停止由本项目启动的进程 ${pid}`);
  }
  rmSync(pidPath(name), { force: true });
  return true;
}
