import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { runArchive } from "./archive.js";

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function slugifyHost(hostname) {
  return hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "site";
}

function normalizeSiteUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  url.hash = "";
  return url;
}

async function ensureDashboardStorage(rootDir) {
  await fs.mkdir(path.join(rootDir, "sites"), { recursive: true });
}

async function loadSites(configPath) {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }

    return [];
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function saveSites(configPath, sites) {
  await fs.writeFile(configPath, JSON.stringify(sites, null, 2));
}

async function readManifest(manifestPath) {
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sortSnapshotsDesc(snapshotIds) {
  return [...snapshotIds].sort((a, b) => b.localeCompare(a));
}

function mapFilesByPath(files) {
  const map = new Map();
  for (const file of files || []) {
    map.set(file.path, file);
  }

  return map;
}

function buildSnapshotDiff(previousManifest, currentManifest) {
  if (!previousManifest || !currentManifest) {
    return {
      hasBaseline: false,
      added: [],
      removed: [],
      modified: []
    };
  }

  const previousMap = mapFilesByPath(previousManifest.files || []);
  const currentMap = mapFilesByPath(currentManifest.files || []);

  const added = [];
  const removed = [];
  const modified = [];

  for (const [filePath, currentFile] of currentMap.entries()) {
    const previousFile = previousMap.get(filePath);

    if (!previousFile) {
      added.push(currentFile);
      continue;
    }

    if (previousFile.sha256 !== currentFile.sha256) {
      modified.push({ before: previousFile, after: currentFile });
    }
  }

  for (const [filePath, previousFile] of previousMap.entries()) {
    if (!currentMap.has(filePath)) {
      removed.push(previousFile);
    }
  }

  added.sort((a, b) => a.path.localeCompare(b.path));
  removed.sort((a, b) => a.path.localeCompare(b.path));
  modified.sort((a, b) => a.after.path.localeCompare(b.after.path));

  return {
    hasBaseline: true,
    added,
    removed,
    modified
  };
}

async function listSnapshotsForSite(siteDir) {
  let entries = [];

  try {
    entries = await fs.readdir(siteDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "reports" || entry.name === "sites") {
      continue;
    }

    const manifestPath = path.join(siteDir, entry.name, "manifest.json");
    const manifest = await readManifest(manifestPath);

    if (!manifest) {
      continue;
    }

    snapshots.push({
      snapshotId: entry.name,
      archivedAt: manifest.archivedAt || null,
      filesCount: Array.isArray(manifest.files) ? manifest.files.length : null,
      failuresCount: Array.isArray(manifest.failures) ? manifest.failures.length : null
    });
  }

  snapshots.sort((a, b) => a.snapshotId.localeCompare(b.snapshotId));
  snapshots.reverse();

  return snapshots;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function renderMessage(query) {
  if (!query.message) {
    return "";
  }

  const kind = query.kind === "error" ? "error" : "ok";
  return `<div class="banner ${kind}">${escapeHtml(query.message)}</div>`;
}

function renderRuntimeStatus(runtime) {
  if (!runtime) {
    return "Idle";
  }

  if (runtime.state === "running") {
    return `Archiving in progress | pages: ${runtime.visitedPageCount}, files: ${runtime.savedFileCount}, failures: ${runtime.failureCount}`;
  }

  if (runtime.state === "failed") {
    return `Last archive failed: ${runtime.error || "Unknown error"}`;
  }

  if (runtime.state === "completed") {
    return `Last archive completed | snapshot: ${runtime.snapshotId || "unknown"}`;
  }

  return "Idle";
}

function runtimeClassName(runtime) {
  if (!runtime) {
    return "idle";
  }

  if (runtime.state === "running") {
    return "running";
  }

  if (runtime.state === "failed") {
    return "failed";
  }

  if (runtime.state === "completed") {
    return "completed";
  }

  return "idle";
}

function renderPage({ sites, query, port }) {
  const cards = sites
    .map(site => {
      const snapshots = site.snapshots
        .map(snapshot => {
          const snapshotLabel = `${escapeHtml(snapshot.snapshotId)} (${formatDate(snapshot.archivedAt)})`;
          const stats = snapshot.filesCount == null
            ? ""
            : `files: ${snapshot.filesCount}, failures: ${snapshot.failuresCount ?? 0}`;

          return `<li>
  <a href="/view/${encodeURIComponent(site.id)}/${encodeURIComponent(snapshot.snapshotId)}/" target="_blank">${snapshotLabel}</a>
          <a class="details-link" href="/details/${encodeURIComponent(site.id)}/${encodeURIComponent(snapshot.snapshotId)}">Details</a>
  <span class="meta">${escapeHtml(stats)}</span>
</li>`;
        })
        .join("\n");

      return `<section class="site-card">
  <header>
    <h2>${escapeHtml(site.id)}</h2>
    <p><a href="${escapeHtml(site.url)}" target="_blank">${escapeHtml(site.url)}</a></p>
    <p class="meta">Created: ${formatDate(site.createdAt)} | Last archive: ${formatDate(site.lastArchivedAt)}</p>
    <p class="runtime ${runtimeClassName(site.runtime)}" data-runtime-status="${escapeHtml(site.id)}">${escapeHtml(renderRuntimeStatus(site.runtime))}</p>
  </header>
  <div class="actions">
    <form method="post" action="/api/sites/${encodeURIComponent(site.id)}/archive">
      <button type="submit" ${site.runtime?.state === "running" ? "disabled" : ""}>Archive Now</button>
    </form>
    <form method="post" action="/api/sites/${encodeURIComponent(site.id)}/delete" onsubmit="return confirm('Delete this site and all snapshots?');">
      <button type="submit" class="danger" ${site.runtime?.state === "running" ? "disabled" : ""}>Delete Site</button>
    </form>
  </div>
  <h3>Saved Versions (${site.snapshots.length})</h3>
  <ul class="snapshots">
    ${snapshots || "<li>No snapshots yet.</li>"}
  </ul>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Archiver Dashboard</title>
  <style>
    :root {
      --bg-a: #f4efe3;
      --bg-b: #dcebe4;
      --surface: #fffef9;
      --ink: #20222b;
      --ink-muted: #5b6170;
      --accent: #177f6e;
      --accent-2: #0e5f95;
      --danger: #b54231;
      --line: #d8d8cf;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 20% 20%, var(--bg-a), transparent 45%),
                  radial-gradient(circle at 85% 10%, var(--bg-b), transparent 40%),
                  #f7f7f2;
      min-height: 100vh;
    }

    .container {
      width: min(1100px, 92vw);
      margin: 2rem auto 3rem;
    }

    .hero {
      background: linear-gradient(145deg, #1d2b36, #264f52);
      color: #f7fffd;
      border-radius: 20px;
      padding: 1.6rem;
      box-shadow: 0 12px 28px rgba(20, 25, 36, 0.18);
    }

    .hero h1 {
      margin: 0;
      font-size: clamp(1.4rem, 4vw, 2rem);
      letter-spacing: 0.03em;
    }

    .hero p {
      margin: 0.4rem 0 0;
      color: #d5ebe7;
    }

    .hero .meta {
      margin-top: 0.4rem;
      font-size: 0.9rem;
      color: #b7d9d3;
    }

    .panel {
      margin-top: 1rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 1rem;
      box-shadow: 0 10px 20px rgba(30, 34, 42, 0.06);
    }

    form.add-site {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.6rem;
    }

    input[type="url"] {
      width: 100%;
      border: 1px solid #c6c9c4;
      border-radius: 10px;
      padding: 0.65rem 0.75rem;
      font-size: 1rem;
    }

    button {
      border: 0;
      border-radius: 10px;
      padding: 0.65rem 0.95rem;
      font-weight: 600;
      background: var(--accent);
      color: white;
      cursor: pointer;
      transition: transform 120ms ease, filter 120ms ease;
    }

    button:hover {
      filter: brightness(1.06);
      transform: translateY(-1px);
    }

    button.danger {
      background: var(--danger);
    }

    .banner {
      margin-top: 1rem;
      border-radius: 10px;
      padding: 0.75rem 0.8rem;
      font-weight: 600;
    }

    .banner.ok {
      background: #dff5e9;
      color: #155b34;
      border: 1px solid #afdcbf;
    }

    .banner.error {
      background: #fde9e6;
      color: #7d2519;
      border: 1px solid #efb5ab;
    }

    .sites {
      display: grid;
      gap: 1rem;
      margin-top: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
    }

    .site-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 1rem;
      box-shadow: 0 8px 20px rgba(32, 34, 42, 0.07);
    }

    .site-card h2 {
      margin: 0;
      font-size: 1.1rem;
    }

    .site-card p {
      margin: 0.3rem 0;
      word-break: break-word;
    }

    .meta {
      color: var(--ink-muted);
      font-size: 0.88rem;
    }

    .runtime {
      margin-top: 0.45rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0.4rem 0.55rem;
      font-size: 0.86rem;
      font-weight: 600;
      background: #f6f7f4;
    }

    .runtime.running {
      border-color: #7ec8b3;
      background: #e8faf4;
      color: #126050;
    }

    .runtime.completed {
      border-color: #aad0ee;
      background: #edf7ff;
      color: #0f4f7b;
    }

    .runtime.failed {
      border-color: #e5a7a0;
      background: #fff0ee;
      color: #852c20;
    }

    .actions {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin: 0.6rem 0 0.9rem;
    }

    .actions form {
      margin: 0;
    }

    .snapshots {
      margin: 0.5rem 0 0;
      padding-left: 1.1rem;
    }

    .snapshots li {
      margin-bottom: 0.4rem;
    }

    .snapshots a {
      color: var(--accent-2);
      text-decoration-thickness: 2px;
    }

    .snapshots .details-link {
      margin-left: 0.45rem;
      font-size: 0.85rem;
    }

    @media (max-width: 650px) {
      form.add-site {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="container">
    <section class="hero">
      <h1>Website Archiver Dashboard</h1>
      <p>Track archived sites, open saved versions, and manage snapshots.</p>
      <div class="meta">Running on port ${port}</div>
    </section>

    <section class="panel">
      <h2>Add Site And Archive</h2>
      <form class="add-site" method="post" action="/api/sites/add">
        <input type="url" name="url" placeholder="https://example.com" required>
        <button type="submit">Add Site</button>
      </form>
      ${renderMessage(query)}
    </section>

    <section class="sites">
      ${cards || "<section class=\"site-card\"><h2>No archived sites yet</h2><p>Add your first site above.</p></section>"}
    </section>
  </main>
  <script>
    (function () {
      let hadRunning = false;

      function statusText(runtime) {
        if (!runtime) {
          return "Idle";
        }

        if (runtime.state === "running") {
          return "Archiving in progress | pages: " + runtime.visitedPageCount + ", files: " + runtime.savedFileCount + ", failures: " + runtime.failureCount;
        }

        if (runtime.state === "failed") {
          return "Last archive failed: " + (runtime.error || "Unknown error");
        }

        if (runtime.state === "completed") {
          return "Last archive completed | snapshot: " + (runtime.snapshotId || "unknown");
        }

        return "Idle";
      }

      function statusClass(runtime) {
        if (!runtime) {
          return "runtime idle";
        }

        if (runtime.state === "running") {
          return "runtime running";
        }

        if (runtime.state === "failed") {
          return "runtime failed";
        }

        if (runtime.state === "completed") {
          return "runtime completed";
        }

        return "runtime idle";
      }

      async function refreshStatus() {
        try {
          const response = await fetch("/api/sites/status", { cache: "no-store" });
          const payload = await response.json();

          for (const site of payload.sites) {
            const node = document.querySelector('[data-runtime-status="' + site.id + '"]');
            if (!node) {
              continue;
            }

            node.textContent = statusText(site.runtime);
            node.className = statusClass(site.runtime);
          }

          if (hadRunning && !payload.hasRunning) {
            window.location.reload();
            return;
          }

          hadRunning = payload.hasRunning;
        } catch {
          // Ignore transient polling failures while the page is open.
        }
      }

      window.setInterval(refreshStatus, 2000);
      refreshStatus();
    }());
  </script>
</body>
</html>`;
}

function safeSnapshotFilePath(baseDir, requestedPath) {
  const normalized = path.normalize(requestedPath || "index.html");
  const resolved = path.resolve(baseDir, normalized);
  const root = path.resolve(baseDir);

  if (!resolved.startsWith(root)) {
    return null;
  }

  return resolved;
}

function renderSnapshotDetailsPage({ site, snapshotId, manifest, previousSnapshotId, diff }) {
  const failures = Array.isArray(manifest.failures) ? manifest.failures : [];
  const files = Array.isArray(manifest.files) ? manifest.files : [];

  const failureItems = failures.length === 0
    ? "<li>None</li>"
    : failures.map(item => `<li><strong>${escapeHtml(item.url || "unknown url")}</strong><br>${escapeHtml(item.message || "Unknown error")}</li>`).join("\n");

  const addedItems = diff.added.length === 0
    ? "<li>None</li>"
    : diff.added.map(item => `<li>${escapeHtml(item.path)}</li>`).join("\n");

  const removedItems = diff.removed.length === 0
    ? "<li>None</li>"
    : diff.removed.map(item => `<li>${escapeHtml(item.path)}</li>`).join("\n");

  const modifiedItems = diff.modified.length === 0
    ? "<li>None</li>"
    : diff.modified.map(item => `<li>${escapeHtml(item.after.path)}</li>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snapshot Details</title>
  <style>
    :root {
      --ink: #1f2530;
      --muted: #5b6270;
      --line: #d6dce2;
      --surface: #ffffff;
      --bg: #f3f7f9;
      --accent: #1565c0;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      background: linear-gradient(180deg, #e6f0f4 0%, var(--bg) 100%);
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }

    .container {
      width: min(1000px, 92vw);
      margin: 1.6rem auto 2rem;
    }

    .topbar {
      display: flex;
      gap: 0.8rem;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 1rem;
    }

    .topbar a {
      color: var(--accent);
      text-decoration-thickness: 2px;
      font-weight: 600;
    }

    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 1rem;
      margin-bottom: 1rem;
      box-shadow: 0 8px 18px rgba(15, 28, 40, 0.06);
    }

    h1, h2, h3 { margin-top: 0; }

    .grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }

    .meta {
      color: var(--muted);
      font-size: 0.95rem;
    }

    ul {
      margin: 0;
      padding-left: 1.1rem;
    }

    li { margin-bottom: 0.42rem; }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.6rem;
      margin-top: 0.5rem;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 0.6rem;
      background: #f8fbfd;
    }

    .metric .label {
      font-size: 0.82rem;
      color: var(--muted);
    }

    .metric .value {
      font-size: 1.15rem;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main class="container">
    <div class="topbar">
      <a href="/">Dashboard</a>
      <a href="/view/${encodeURIComponent(site.id)}/${encodeURIComponent(snapshotId)}/" target="_blank">Open Snapshot</a>
    </div>

    <section class="panel">
      <h1>Snapshot Details</h1>
      <p class="meta">Site: ${escapeHtml(site.id)} (${escapeHtml(site.url)})</p>
      <p class="meta">Snapshot: ${escapeHtml(snapshotId)} | Archived: ${escapeHtml(formatDate(manifest.archivedAt))}</p>
      <div class="summary-grid">
        <div class="metric"><div class="label">Files</div><div class="value">${files.length}</div></div>
        <div class="metric"><div class="label">Failures</div><div class="value">${failures.length}</div></div>
        <div class="metric"><div class="label">Added</div><div class="value">${diff.added.length}</div></div>
        <div class="metric"><div class="label">Removed</div><div class="value">${diff.removed.length}</div></div>
        <div class="metric"><div class="label">Modified</div><div class="value">${diff.modified.length}</div></div>
      </div>
    </section>

    <div class="grid">
      <section class="panel">
        <h2>Failures</h2>
        <ul>${failureItems}</ul>
      </section>

      <section class="panel">
        <h2>Changes From Previous</h2>
        <p class="meta">Previous snapshot: ${escapeHtml(previousSnapshotId || "none")}</p>
        ${diff.hasBaseline ? "" : "<p class=\"meta\">No previous snapshot available for diff.</p>"}
        <h3>Added Files</h3>
        <ul>${addedItems}</ul>
        <h3>Removed Files</h3>
        <ul>${removedItems}</ul>
        <h3>Modified Files</h3>
        <ul>${modifiedItems}</ul>
      </section>
    </div>
  </main>
</body>
</html>`;
}

export async function runDashboard(options) {
  const outputDir = path.resolve(options.outputDir || "archives");
  const sitesDir = path.join(outputDir, "sites");
  const configPath = path.join(outputDir, "sites.json");
  const port = Number(options.port || 8090);
  const timeoutMs = Number(options.timeoutMs || 20000);
  const archiveRuntime = new Map();

  await ensureDashboardStorage(outputDir);

  const app = express();
  app.use(express.urlencoded({ extended: true }));

  async function setSiteLastArchived(siteId, archivedAt) {
    const sites = await loadSites(configPath);
    const site = sites.find(item => item.id === siteId);
    if (!site) {
      return;
    }

    site.lastArchivedAt = archivedAt;
    await saveSites(configPath, sites);
  }

  function startArchiveJob(site) {
    const existing = archiveRuntime.get(site.id);
    if (existing && existing.state === "running") {
      return { started: false, reason: "already-running" };
    }

    archiveRuntime.set(site.id, {
      state: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      snapshotId: null,
      currentUrl: site.url,
      savedFileCount: 0,
      failureCount: 0,
      queuedPageCount: 0,
      visitedPageCount: 0,
      pendingAssetCount: 0,
      downloadedAssetCount: 0,
      error: null
    });

    runArchive({
      url: site.url,
      outputDir: path.join(sitesDir, site.id),
      timeoutMs,
      onProgress: progress => {
        const current = archiveRuntime.get(site.id);
        if (!current || current.state !== "running") {
          return;
        }

        archiveRuntime.set(site.id, {
          ...current,
          ...progress,
          state: progress.phase === "completed" ? "completed" : "running"
        });
      }
    }).then(async result => {
      archiveRuntime.set(site.id, {
        state: "completed",
        startedAt: archiveRuntime.get(site.id)?.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        snapshotId: result.snapshotId,
        currentUrl: site.url,
        savedFileCount: result.savedFileCount,
        failureCount: result.failedCount,
        queuedPageCount: 0,
        visitedPageCount: archiveRuntime.get(site.id)?.visitedPageCount || 0,
        pendingAssetCount: 0,
        downloadedAssetCount: archiveRuntime.get(site.id)?.downloadedAssetCount || 0,
        error: null
      });

      await setSiteLastArchived(site.id, new Date().toISOString());
    }).catch(error => {
      archiveRuntime.set(site.id, {
        ...(archiveRuntime.get(site.id) || {}),
        state: "failed",
        finishedAt: new Date().toISOString(),
        error: error.message || "Archive failed"
      });
    });

    return { started: true };
  }

  async function loadSitesWithSnapshots() {
    const sites = await loadSites(configPath);

    const withSnapshots = [];
    for (const site of sites) {
      const sitePath = path.join(sitesDir, site.id);
      const snapshots = await listSnapshotsForSite(sitePath);
      withSnapshots.push({ ...site, snapshots, runtime: archiveRuntime.get(site.id) || null });
    }

    withSnapshots.sort((a, b) => a.id.localeCompare(b.id));
    return withSnapshots;
  }

  app.get("/", async (req, res) => {
    const sites = await loadSitesWithSnapshots();
    res.send(renderPage({ sites, query: req.query, port }));
  });

  app.get("/api/sites/status", async (req, res) => {
    const sites = await loadSitesWithSnapshots();
    const payload = {
      hasRunning: sites.some(site => site.runtime?.state === "running"),
      sites: sites.map(site => ({
        id: site.id,
        runtime: site.runtime
      }))
    };

    res.json(payload);
  });

  app.post("/api/sites/add", async (req, res) => {
    try {
      const rawUrl = String(req.body.url || "").trim();
      if (!rawUrl) {
        res.redirect("/?kind=error&message=Site+URL+is+required");
        return;
      }

      const normalized = normalizeSiteUrl(rawUrl);
      const baseId = slugifyHost(normalized.hostname);
      const sites = await loadSites(configPath);

      let site = sites.find(item => item.url === normalized.toString());

      if (!site) {
        const ids = new Set(sites.map(item => item.id));
        let candidate = baseId;
        let index = 2;
        while (ids.has(candidate)) {
          candidate = `${baseId}-${index}`;
          index += 1;
        }

        site = {
          id: candidate,
          url: normalized.toString(),
          createdAt: new Date().toISOString(),
          lastArchivedAt: null
        };

        sites.push(site);
        await saveSites(configPath, sites);
      }

      const startResult = startArchiveJob(site);

      if (!startResult.started) {
        res.redirect(`/?kind=error&message=Archive+already+running+for+${encodeURIComponent(site.id)}`);
        return;
      }

      res.redirect(`/?message=Archive+started+for+${encodeURIComponent(site.url)}`);
    } catch (error) {
      res.redirect(`/?kind=error&message=${encodeURIComponent(error.message)}`);
    }
  });

  app.post("/api/sites/:siteId/archive", async (req, res) => {
    try {
      const siteId = String(req.params.siteId || "");
      if (!SITE_ID_PATTERN.test(siteId)) {
        res.redirect("/?kind=error&message=Invalid+site+identifier");
        return;
      }

      const sites = await loadSites(configPath);
      const site = sites.find(item => item.id === siteId);
      if (!site) {
        res.redirect("/?kind=error&message=Site+not+found");
        return;
      }

      const startResult = startArchiveJob(site);
      if (!startResult.started) {
        res.redirect(`/?kind=error&message=Archive+already+running+for+${encodeURIComponent(site.id)}`);
        return;
      }

      res.redirect(`/?message=Archive+started+for+${encodeURIComponent(site.id)}`);
    } catch (error) {
      res.redirect(`/?kind=error&message=${encodeURIComponent(error.message)}`);
    }
  });

  app.post("/api/sites/:siteId/delete", async (req, res) => {
    try {
      const siteId = String(req.params.siteId || "");
      if (!SITE_ID_PATTERN.test(siteId)) {
        res.redirect("/?kind=error&message=Invalid+site+identifier");
        return;
      }

      const sites = await loadSites(configPath);
      const nextSites = sites.filter(item => item.id !== siteId);

      if (nextSites.length === sites.length) {
        res.redirect("/?kind=error&message=Site+not+found");
        return;
      }

      const runtime = archiveRuntime.get(siteId);
      if (runtime && runtime.state === "running") {
        res.redirect("/?kind=error&message=Cannot+delete+site+while+archive+is+running");
        return;
      }

      const sitePath = path.join(sitesDir, siteId);
      await fs.rm(sitePath, { recursive: true, force: true });
      await saveSites(configPath, nextSites);
      archiveRuntime.delete(siteId);

      res.redirect(`/?message=Deleted+archived+site+${encodeURIComponent(siteId)}`);
    } catch (error) {
      res.redirect(`/?kind=error&message=${encodeURIComponent(error.message)}`);
    }
  });

  app.get("/view/:siteId/:snapshotId/*", async (req, res) => {
    const siteId = String(req.params.siteId || "");
    const snapshotId = String(req.params.snapshotId || "");

    if (!SITE_ID_PATTERN.test(siteId) || !snapshotId) {
      res.status(400).send("Invalid path.");
      return;
    }

    const baseDir = path.join(sitesDir, siteId, snapshotId, "files");
    const tail = req.params[0] || "index.html";
    const targetFile = safeSnapshotFilePath(baseDir, tail);

    if (!targetFile) {
      res.status(400).send("Invalid file path.");
      return;
    }

    res.sendFile(targetFile, error => {
      if (error) {
        res.status(404).send("File not found in snapshot.");
      }
    });
  });

  app.get("/view/:siteId/:snapshotId", async (req, res) => {
    res.redirect(`/view/${encodeURIComponent(req.params.siteId)}/${encodeURIComponent(req.params.snapshotId)}/`);
  });

  app.get("/details/:siteId/:snapshotId", async (req, res) => {
    const siteId = String(req.params.siteId || "");
    const snapshotId = String(req.params.snapshotId || "");

    if (!SITE_ID_PATTERN.test(siteId) || !snapshotId) {
      res.status(400).send("Invalid path.");
      return;
    }

    const sites = await loadSites(configPath);
    const site = sites.find(item => item.id === siteId);
    if (!site) {
      res.status(404).send("Site not found.");
      return;
    }

    const siteDir = path.join(sitesDir, siteId);
    const snapshots = await listSnapshotsForSite(siteDir);
    const snapshotIds = sortSnapshotsDesc(snapshots.map(item => item.snapshotId));

    if (!snapshotIds.includes(snapshotId)) {
      res.status(404).send("Snapshot not found.");
      return;
    }

    const currentManifestPath = path.join(siteDir, snapshotId, "manifest.json");
    const currentManifest = await readManifest(currentManifestPath);
    if (!currentManifest) {
      res.status(404).send("Snapshot manifest is missing.");
      return;
    }

    const currentIndex = snapshotIds.indexOf(snapshotId);
    const previousSnapshotId = currentIndex >= 0 && currentIndex < snapshotIds.length - 1
      ? snapshotIds[currentIndex + 1]
      : null;

    let previousManifest = null;
    if (previousSnapshotId) {
      const previousManifestPath = path.join(siteDir, previousSnapshotId, "manifest.json");
      previousManifest = await readManifest(previousManifestPath);
    }

    const diff = buildSnapshotDiff(previousManifest, currentManifest);
    res.send(renderSnapshotDetailsPage({
      site,
      snapshotId,
      manifest: currentManifest,
      previousSnapshotId,
      diff
    }));
  });

  app.get("/view/:siteId/:snapshotId/", async (req, res) => {
    const siteId = String(req.params.siteId || "");
    const snapshotId = String(req.params.snapshotId || "");

    if (!SITE_ID_PATTERN.test(siteId) || !snapshotId) {
      res.status(400).send("Invalid path.");
      return;
    }

    const baseDir = path.join(sitesDir, siteId, snapshotId, "files");
    const targetFile = safeSnapshotFilePath(baseDir, "index.html");

    if (!targetFile) {
      res.status(400).send("Invalid file path.");
      return;
    }

    res.sendFile(targetFile, error => {
      if (error) {
        res.status(404).send("Snapshot entry page was not found.");
      }
    });
  });

  await new Promise(resolve => {
    app.listen(port, resolve);
  });

  return {
    outputDir,
    sitesDir,
    port
  };
}
