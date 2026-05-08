import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeFileSafe(filePath, data) {
  await ensureDirForFile(filePath);
  await fs.writeFile(filePath, data);
}

export async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep);
}
