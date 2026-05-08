#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Command } from "commander";
import { runDashboard } from "./dashboard.js";

const program = new Command();

function resolveOutputDir(value) {
  return path.resolve(value || "archives");
}

function getPidFilePath(outputDir) {
  return path.join(outputDir, ".dashboard-server.json");
}

function getLogFilePath(outputDir) {
  return path.join(outputDir, "dashboard-server.log");
}

async function readPidInfo(pidFilePath) {
  try {
    const raw = await fs.readFile(pidFilePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function clearStalePidFile(pidFilePath) {
  await fs.rm(pidFilePath, { force: true });
}

function openBrowser(url) {
  const child = spawn("cmd.exe", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();
}

function resolveNodeExecutable() {
  const fromEnv = process.env.WA_NODE_EXE;
  if (fromEnv && fsSync.existsSync(fromEnv)) {
    return fromEnv;
  }

  const whereResult = spawnSync("where", ["node"], {
    windowsHide: true,
    encoding: "utf-8"
  });

  if (whereResult.status === 0 && whereResult.stdout) {
    const first = String(whereResult.stdout)
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);

    if (first && fsSync.existsSync(first)) {
      return first;
    }
  }

  const commonPaths = [
    path.join(process.env.ProgramFiles || "", "nodejs", "node.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "nodejs", "node.exe"),
    path.join(process.env.LocalAppData || "", "Programs", "nodejs", "node.exe")
  ].filter(Boolean);

  for (const candidate of commonPaths) {
    if (candidate && fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Node.js executable was not found. Install Node.js 18+ and retry.");
}

function resolveDashboardEntry(cwd) {
  const entry = path.join(cwd, "src", "index.js");
  if (!fsSync.existsSync(entry)) {
    throw new Error(`Dashboard entry file was not found at ${entry}`);
  }

  return entry;
}

async function startDashboardServer(options) {
  const outputDir = resolveOutputDir(options.outputDir);
  const port = Number(options.port || 8090);
  const timeoutMs = Number(options.timeoutMs || 20000);
  const pidFilePath = getPidFilePath(outputDir);
  const logFilePath = getLogFilePath(outputDir);

  await fs.mkdir(outputDir, { recursive: true });

  const existing = await readPidInfo(pidFilePath);
  if (existing && isPidRunning(existing.pid)) {
    console.log(`Dashboard already running (PID ${existing.pid}) at http://localhost:${existing.port || port}`);
    return;
  }

  if (existing && !isPidRunning(existing.pid)) {
    await clearStalePidFile(pidFilePath);
  }

  const logFd = fsSync.openSync(logFilePath, "a");
  const workingDir = process.cwd();
  const nodeExecutable = resolveNodeExecutable();
  const dashboardEntry = resolveDashboardEntry(workingDir);

  const child = spawn(
    nodeExecutable,
    [
      dashboardEntry,
      "dashboard",
      "--output-dir",
      outputDir,
      "--port",
      String(port),
      "--timeout-ms",
      String(timeoutMs)
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      cwd: workingDir
    }
  );

  fsSync.closeSync(logFd);

  child.unref();

  const pidInfo = {
    pid: child.pid,
    port,
    outputDir,
    logFilePath,
    startedAt: new Date().toISOString()
  };

  await fs.writeFile(pidFilePath, `${JSON.stringify(pidInfo, null, 2)}\n`, "utf-8");

  await new Promise(resolve => {
    setTimeout(resolve, 1200);
  });

  if (!isPidRunning(child.pid)) {
    await clearStalePidFile(pidFilePath);
    throw new Error(`Dashboard process exited early. Check log: ${logFilePath}`);
  }

  if (options.open !== false) {
    openBrowser(`http://localhost:${port}`);
  }

  console.log(`Dashboard start requested (PID ${child.pid}).`);
  console.log(`URL: http://localhost:${port}`);
  console.log(`PID file: ${pidFilePath}`);
}

async function stopDashboardServer(options) {
  const outputDir = resolveOutputDir(options.outputDir);
  const pidFilePath = getPidFilePath(outputDir);
  const pidInfo = await readPidInfo(pidFilePath);

  if (!pidInfo) {
    console.log("No running dashboard instance was found.");
    return;
  }

  if (!isPidRunning(pidInfo.pid)) {
    await clearStalePidFile(pidFilePath);
    console.log("Dashboard was not running. Removed stale PID file.");
    return;
  }

  const killer = spawn("taskkill.exe", ["/PID", String(pidInfo.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true
  });

  await new Promise((resolve, reject) => {
    killer.on("error", reject);
    killer.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`taskkill exited with code ${code}`));
      }
    });
  });

  await clearStalePidFile(pidFilePath);
  console.log(`Dashboard stopped (PID ${pidInfo.pid}).`);
}

async function showDashboardStatus(options) {
  const outputDir = resolveOutputDir(options.outputDir);
  const pidFilePath = getPidFilePath(outputDir);
  const pidInfo = await readPidInfo(pidFilePath);

  if (!pidInfo) {
    console.log("Dashboard status: stopped (no PID file).");
    return;
  }

  if (isPidRunning(pidInfo.pid)) {
    console.log(`Dashboard status: running (PID ${pidInfo.pid})`);
    console.log(`URL: http://localhost:${pidInfo.port || 8090}`);
    console.log(`Started: ${pidInfo.startedAt || "unknown"}`);
    return;
  }

  await clearStalePidFile(pidFilePath);
  console.log("Dashboard status: stopped (removed stale PID file).");
}

program
  .name("website-archiver-control")
  .description("Windows dashboard start/stop controller for Website-Archiver")
  .version("1.0.0");

program
  .command("start")
  .description("Start the dashboard server in the background")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .option("-p, --port <port>", "Dashboard port", value => Number(value), 8090)
  .option("-t, --timeout-ms <ms>", "Per-request timeout for archive actions", value => Number(value), 20000)
  .option("--no-open", "Do not open browser after start")
  .action(async options => {
    try {
      await startDashboardServer(options);
    } catch (error) {
      console.error(`Start failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("stop")
  .description("Stop the background dashboard server")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .action(async options => {
    try {
      await stopDashboardServer(options);
    } catch (error) {
      console.error(`Stop failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show dashboard server status")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .action(async options => {
    try {
      await showDashboardStatus(options);
    } catch (error) {
      console.error(`Status failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("run-dashboard")
  .description("Internal: run the dashboard server process")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .option("-p, --port <port>", "Dashboard port", value => Number(value), 8090)
  .option("-t, --timeout-ms <ms>", "Per-request timeout for archive actions", value => Number(value), 20000)
  .action(async options => {
    try {
      const result = await runDashboard(options);
      console.log(`Dashboard output root: ${result.outputDir}`);
      console.log(`Managed sites root: ${result.sitesDir}`);
      console.log(`Dashboard URL: http://localhost:${result.port}`);
    } catch (error) {
      console.error(`Dashboard failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);