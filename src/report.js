import fs from "node:fs/promises";
import path from "node:path";
import { readJsonIfExists, writeFileSafe } from "./lib/file.js";

async function getSnapshotIds(rootDir) {
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return entries
    .filter(entry => entry.isDirectory() && entry.name !== "reports")
    .map(entry => entry.name)
    .sort();
}

async function loadManifest(rootDir, snapshotId) {
  const manifestPath = path.join(rootDir, snapshotId, "manifest.json");
  const manifest = await readJsonIfExists(manifestPath);

  if (!manifest) {
    throw new Error(`Could not find manifest for snapshot '${snapshotId}'.`);
  }

  return manifest;
}

function toMap(files) {
  const map = new Map();
  for (const file of files) {
    map.set(file.path, file);
  }

  return map;
}

function buildDiff(fromManifest, toManifest) {
  const fromMap = toMap(fromManifest.files || []);
  const toMapData = toMap(toManifest.files || []);

  const added = [];
  const removed = [];
  const modified = [];

  for (const [filePath, nextFile] of toMapData.entries()) {
    const previous = fromMap.get(filePath);

    if (!previous) {
      added.push(nextFile);
      continue;
    }

    if (previous.sha256 !== nextFile.sha256) {
      modified.push({ before: previous, after: nextFile });
    }
  }

  for (const [filePath, previous] of fromMap.entries()) {
    if (!toMapData.has(filePath)) {
      removed.push(previous);
    }
  }

  return { added, removed, modified };
}

function asMarkdown(diff, fromManifest, toManifest) {
  const lines = [];

  lines.push(`# Change Report`);
  lines.push("");
  lines.push(`Comparing **${fromManifest.snapshotId}** -> **${toManifest.snapshotId}**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Added: ${diff.added.length}`);
  lines.push(`- Removed: ${diff.removed.length}`);
  lines.push(`- Modified: ${diff.modified.length}`);
  lines.push("");

  lines.push("## Added Files");
  lines.push("");
  if (diff.added.length === 0) {
    lines.push("- None");
  } else {
    for (const item of diff.added) {
      lines.push(`- ${item.path}`);
    }
  }

  lines.push("");
  lines.push("## Removed Files");
  lines.push("");
  if (diff.removed.length === 0) {
    lines.push("- None");
  } else {
    for (const item of diff.removed) {
      lines.push(`- ${item.path}`);
    }
  }

  lines.push("");
  lines.push("## Modified Files");
  lines.push("");
  if (diff.modified.length === 0) {
    lines.push("- None");
  } else {
    for (const item of diff.modified) {
      lines.push(`- ${item.after.path}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function runReport(options) {
  const rootDir = path.resolve(options.outputDir || "archives");
  const snapshots = await getSnapshotIds(rootDir);

  if (snapshots.length < 2 && (!options.from || !options.to)) {
    throw new Error("At least two snapshots are required to generate a report.");
  }

  const toSnapshot = options.to || snapshots[snapshots.length - 1];
  const fromSnapshot = options.from || snapshots[snapshots.length - 2];

  const fromManifest = await loadManifest(rootDir, fromSnapshot);
  const toManifest = await loadManifest(rootDir, toSnapshot);

  const diff = buildDiff(fromManifest, toManifest);
  const markdown = asMarkdown(diff, fromManifest, toManifest);

  const reportsDir = path.join(rootDir, "reports");
  const reportPath = path.join(reportsDir, `change-report-${fromSnapshot}-to-${toSnapshot}.md`);
  await writeFileSafe(reportPath, markdown);

  return {
    fromSnapshot,
    toSnapshot,
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    reportPath
  };
}
