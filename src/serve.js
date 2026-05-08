import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

async function resolveSnapshot(rootDir, requestedSnapshotId) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const snapshots = entries
    .filter(entry => entry.isDirectory() && entry.name !== "reports")
    .map(entry => entry.name)
    .sort();

  if (snapshots.length === 0) {
    throw new Error("No snapshots were found. Run the archive command first.");
  }

  if (requestedSnapshotId) {
    if (!snapshots.includes(requestedSnapshotId)) {
      throw new Error(`Snapshot '${requestedSnapshotId}' was not found.`);
    }

    return requestedSnapshotId;
  }

  return snapshots[snapshots.length - 1];
}

export async function runServe(options) {
  const rootDir = path.resolve(options.outputDir || "archives");
  const snapshotId = await resolveSnapshot(rootDir, options.snapshotId);
  const filesDir = path.join(rootDir, snapshotId, "files");

  const app = express();
  app.use(express.static(filesDir));

  app.get("*", (req, res) => {
    res.sendFile(path.join(filesDir, "index.html"), error => {
      if (error) {
        res.status(404).send("Resource not found in archive.");
      }
    });
  });

  const port = Number(options.port || 8080);
  await new Promise(resolve => {
    app.listen(port, resolve);
  });

  return {
    snapshotId,
    filesDir,
    port
  };
}
