import path from "node:path";
import { DOCUMENT_EXTENSIONS, RESOURCE_EXTENSIONS, SUPPORTED_PROTOCOLS } from "./constants.js";
import { sha256 } from "./hash.js";

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizeFileName(value) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "index";
}

export function isSupportedProtocol(url) {
  return SUPPORTED_PROTOCOLS.has(url.protocol);
}

export function isInternalUrl(baseUrl, candidateUrl) {
  if (!isSupportedProtocol(candidateUrl)) {
    return false;
  }

  return candidateUrl.hostname === baseUrl.hostname;
}

export function normalizeUrl(rawUrl) {
  const normalized = new URL(rawUrl.toString());
  normalized.hash = "";

  if ((normalized.protocol === "http:" && normalized.port === "80") || (normalized.protocol === "https:" && normalized.port === "443")) {
    normalized.port = "";
  }

  return normalized;
}

export function getExtension(url) {
  const parsedPath = new URL(url.toString()).pathname;
  return path.posix.extname(parsedPath).toLowerCase();
}

export function classifyUrlKind(url) {
  const ext = getExtension(url);

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return "document";
  }

  if (RESOURCE_EXTENSIONS.has(ext)) {
    return "resource";
  }

  return "page";
}

export function archiveRelativePathForUrl(url, contentType = "") {
  const ext = getExtension(url);
  const pathName = decodeURIComponent(url.pathname || "/");
  const pathPart = pathName.replace(/^\/+/, "");

  const querySuffix = url.search
    ? `__q_${sha256(url.search).slice(0, 12)}`
    : "";

  if (contentType.includes("text/html") || (!ext && !contentType)) {
    if (!pathPart || pathName.endsWith("/")) {
      const dir = pathPart || "";
      return path.posix.join(dir, `index${querySuffix}.html`);
    }

    if (!ext) {
      return path.posix.join(pathPart, `index${querySuffix}.html`);
    }

    const stem = pathPart.slice(0, -ext.length);
    return `${stem}${querySuffix}${ext}`;
  }

  if (!pathPart) {
    return `index${querySuffix}.bin`;
  }

  if (querySuffix) {
    const baseName = path.posix.basename(pathPart);
    const dirname = path.posix.dirname(pathPart);
    const extname = path.posix.extname(baseName);
    const stem = extname ? baseName.slice(0, -extname.length) : baseName;
    const safeBaseName = `${sanitizeFileName(stem)}${querySuffix}${extname || ".bin"}`;
    return dirname === "." ? safeBaseName : path.posix.join(dirname, safeBaseName);
  }

  return pathPart
    .split("/")
    .map(sanitizeSegment)
    .join("/");
}

export function toRelativeHref(fromPath, toPath) {
  const fromDir = path.posix.dirname(fromPath);
  let rel = path.posix.relative(fromDir, toPath);

  if (!rel || !rel.startsWith(".")) {
    rel = `./${rel}`;
  }

  return rel;
}

export function toSnapshotId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}
