import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import * as cheerio from "cheerio";
import mime from "mime-types";
import { sha256 } from "./lib/hash.js";
import { toPosixPath, writeFileSafe } from "./lib/file.js";
import {
  archiveRelativePathForUrl,
  classifyUrlKind,
  isInternalUrl,
  isSupportedProtocol,
  normalizeUrl,
  toRelativeHref,
  toSnapshotId
} from "./lib/url.js";

function buildHttpClient(timeoutMs) {
  return axios.create({
    timeout: timeoutMs,
    maxRedirects: 5,
    responseType: "arraybuffer",
    validateStatus: status => status >= 200 && status < 400
  });
}

function shouldSkipHref(rawHref) {
  if (!rawHref) {
    return true;
  }

  return rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:");
}

function getContentType(response) {
  return String(response.headers["content-type"] || "").toLowerCase();
}

function isHtmlContent(contentType, url) {
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return true;
  }

  return classifyUrlKind(url) === "page" && !contentType;
}

function decodeText(buffer) {
  return Buffer.from(buffer).toString("utf-8");
}

function extractCssReferences(cssText) {
  const results = [];
  const urlRegex = /url\(([^)]+)\)/gi;
  const importRegex = /@import\s+(?:url\()?\s*['\"]?([^'\")\s]+)['\"]?\s*\)?/gi;

  let match;
  while ((match = urlRegex.exec(cssText)) !== null) {
    const raw = match[1].trim().replace(/^['\"]|['\"]$/g, "");
    results.push(raw);
  }

  while ((match = importRegex.exec(cssText)) !== null) {
    results.push(match[1]);
  }

  return [...new Set(results)];
}

function rewriteCssReferences(cssText, replacer) {
  return cssText
    .replace(/url\(([^)]+)\)/gi, (full, raw) => {
      const clean = raw.trim().replace(/^['\"]|['\"]$/g, "");
      const replacement = replacer(clean);

      if (!replacement) {
        return full;
      }

      return `url(${JSON.stringify(replacement)})`;
    })
    .replace(/@import\s+(?:url\()?\s*['\"]?([^'\")\s]+)['\"]?\s*\)?/gi, (full, raw) => {
      const replacement = replacer(raw);

      if (!replacement) {
        return full;
      }

      return `@import url(${JSON.stringify(replacement)})`;
    });
}

function rewriteHtmlAttributes($, candidates, rewriteFn) {
  for (const [selector, attribute] of candidates) {
    $(selector).each((_, element) => {
      const rawValue = $(element).attr(attribute);
      const replacement = rewriteFn(rawValue);
      if (replacement) {
        $(element).attr(attribute, replacement);
      }
    });
  }
}

function inferExtension(contentType) {
  const guessed = mime.extension(contentType.split(";")[0].trim());
  return guessed ? `.${guessed}` : "";
}

export async function runArchive(options) {
  const target = normalizeUrl(new URL(options.url));
  const snapshotId = options.snapshotId || toSnapshotId();
  const rootDir = path.resolve(options.outputDir || "archives");
  const snapshotDir = path.join(rootDir, snapshotId);
  const filesDir = path.join(snapshotDir, "files");

  await fs.mkdir(filesDir, { recursive: true });

  const client = buildHttpClient(options.timeoutMs || 20000);

  const toVisitPages = [target.toString()];
  const queuedPages = new Set(toVisitPages);
  const visitedPages = new Set();

  const toDownloadAssets = new Set();
  const downloadedAssets = new Set();

  const manifest = {
    snapshotId,
    archivedAt: new Date().toISOString(),
    rootUrl: target.toString(),
    files: [],
    failures: []
  };

  const onProgress = typeof options.onProgress === "function"
    ? options.onProgress
    : null;

  function emitProgress(phase, extra = {}) {
    if (!onProgress) {
      return;
    }

    onProgress({
      phase,
      snapshotId,
      currentUrl: extra.currentUrl || null,
      savedFileCount: manifest.files.length,
      failureCount: manifest.failures.length,
      queuedPageCount: toVisitPages.length,
      visitedPageCount: visitedPages.size,
      pendingAssetCount: toDownloadAssets.size,
      downloadedAssetCount: downloadedAssets.size,
      ...extra
    });
  }

  emitProgress("started", { currentUrl: target.toString() });

  const urlToArchivePath = new Map();

  function registerPath(url, contentType = "") {
    const normalized = normalizeUrl(url).toString();
    if (!urlToArchivePath.has(normalized)) {
      urlToArchivePath.set(normalized, archiveRelativePathForUrl(url, contentType));
    }

    return urlToArchivePath.get(normalized);
  }

  function enqueueInternal(raw, baseUrl, destinationSet) {
    try {
      if (shouldSkipHref(raw)) {
        return null;
      }

      const resolved = normalizeUrl(new URL(raw, baseUrl));
      if (!isSupportedProtocol(resolved) || !isInternalUrl(target, resolved)) {
        return null;
      }

      destinationSet.add(resolved.toString());
      return resolved;
    } catch {
      return null;
    }
  }

  function resolveInternal(raw, baseUrl) {
    try {
      if (shouldSkipHref(raw)) {
        return null;
      }

      const resolved = normalizeUrl(new URL(raw, baseUrl));
      if (!isSupportedProtocol(resolved) || !isInternalUrl(target, resolved)) {
        return null;
      }

      return resolved;
    } catch {
      return null;
    }
  }

  async function saveContent(url, contentType, payload) {
    const archivePath = registerPath(url, contentType || "");

    let finalPath = archivePath;
    if (!path.posix.extname(finalPath) && !contentType.includes("text/html")) {
      const ext = inferExtension(contentType);
      if (ext) {
        finalPath = `${finalPath}${ext}`;
      }
    }

    const absolutePath = path.join(filesDir, finalPath);
    await writeFileSafe(absolutePath, payload);

    manifest.files.push({
      url: normalizeUrl(url).toString(),
      path: toPosixPath(finalPath),
      contentType,
      bytes: payload.length,
      sha256: sha256(payload)
    });

    return finalPath;
  }

  function processCssResource(resourceUrl, payload, localPath) {
    const cssText = decodeText(payload);
    const refs = extractCssReferences(cssText);

    for (const ref of refs) {
      enqueueInternal(ref, resourceUrl, toDownloadAssets);
    }

    const rewrittenCss = rewriteCssReferences(cssText, rawRef => {
      try {
        const resolved = normalizeUrl(new URL(rawRef, resourceUrl));
        if (!isInternalUrl(target, resolved)) {
          return null;
        }

        const targetPath = registerPath(resolved);
        return toRelativeHref(localPath, targetPath);
      } catch {
        return null;
      }
    });

    return Buffer.from(rewrittenCss, "utf-8");
  }

  async function processPage(pageUrl) {
    const normalizedPage = normalizeUrl(new URL(pageUrl));

    emitProgress("page:queued", { currentUrl: normalizedPage.toString() });

    if (visitedPages.has(normalizedPage.toString())) {
      return;
    }

    visitedPages.add(normalizedPage.toString());
    emitProgress("page:fetching", { currentUrl: normalizedPage.toString() });

    let response;
    try {
      response = await client.get(normalizedPage.toString());
    } catch (error) {
      manifest.failures.push({ url: normalizedPage.toString(), message: error.message });
      emitProgress("page:failed", { currentUrl: normalizedPage.toString(), error: error.message });
      return;
    }

    const contentType = getContentType(response);
    if (!isHtmlContent(contentType, normalizedPage)) {
      toDownloadAssets.add(normalizedPage.toString());
      return;
    }

    const htmlText = decodeText(response.data);
    const $ = cheerio.load(htmlText, { decodeEntities: false });

    const urlAttributes = [
      ["a[href]", "href"],
      ["link[href]", "href"],
      ["script[src]", "src"],
      ["img[src]", "src"],
      ["source[src]", "src"],
      ["video[src]", "src"],
      ["audio[src]", "src"],
      ["iframe[src]", "src"]
    ];

    for (const [selector, attribute] of urlAttributes) {
      $(selector).each((_, element) => {
        const raw = $(element).attr(attribute);
        if (shouldSkipHref(raw)) {
          return;
        }

        let resolved = null;

        if (selector === "a[href]") {
          resolved = resolveInternal(raw, normalizedPage);
        } else {
          resolved = enqueueInternal(raw, normalizedPage, toDownloadAssets);
        }

        if (!resolved) {
          return;
        }

        if (selector === "a[href]") {
          if (classifyUrlKind(resolved) === "page") {
            if (!queuedPages.has(resolved.toString())) {
              toVisitPages.push(resolved.toString());
              queuedPages.add(resolved.toString());
            }
          } else {
            toDownloadAssets.add(resolved.toString());
          }
        }
      });
    }

    const localPagePath = registerPath(normalizedPage, "text/html");

    rewriteHtmlAttributes($, urlAttributes, raw => {
      try {
        if (shouldSkipHref(raw)) {
          return null;
        }

        const resolved = normalizeUrl(new URL(raw, normalizedPage));
        if (!isInternalUrl(target, resolved)) {
          return null;
        }

        const targetPath = registerPath(resolved);
        return toRelativeHref(localPagePath, targetPath);
      } catch {
        return null;
      }
    });

    const serialized = $.html();
    await saveContent(normalizedPage, "text/html", Buffer.from(serialized, "utf-8"));
    emitProgress("page:saved", { currentUrl: normalizedPage.toString() });
  }

  async function processAsset(assetUrl) {
    const normalizedAsset = normalizeUrl(new URL(assetUrl));

    emitProgress("asset:queued", { currentUrl: normalizedAsset.toString() });

    if (downloadedAssets.has(normalizedAsset.toString())) {
      return;
    }

    downloadedAssets.add(normalizedAsset.toString());
    emitProgress("asset:fetching", { currentUrl: normalizedAsset.toString() });

    let response;
    try {
      response = await client.get(normalizedAsset.toString());
    } catch (error) {
      manifest.failures.push({ url: normalizedAsset.toString(), message: error.message });
      emitProgress("asset:failed", { currentUrl: normalizedAsset.toString(), error: error.message });
      return;
    }

    const contentType = getContentType(response);
    if (isHtmlContent(contentType, normalizedAsset)) {
      if (!visitedPages.has(normalizedAsset.toString()) && !queuedPages.has(normalizedAsset.toString())) {
        toVisitPages.push(normalizedAsset.toString());
        queuedPages.add(normalizedAsset.toString());
      }
      return;
    }

    let payload = Buffer.from(response.data);
    const localPathHint = registerPath(normalizedAsset, contentType);

    if (contentType.includes("text/css")) {
      payload = processCssResource(normalizedAsset, payload, localPathHint);
    }

    await saveContent(normalizedAsset, contentType, payload);
    emitProgress("asset:saved", { currentUrl: normalizedAsset.toString() });
  }

  while (toVisitPages.length > 0) {
    const nextPage = toVisitPages.shift();
    await processPage(nextPage);

    // Drain discovered assets after each page so CSS imports can recursively fan out.
    while (toDownloadAssets.size > 0) {
      const [nextAsset] = toDownloadAssets;
      toDownloadAssets.delete(nextAsset);
      await processAsset(nextAsset);
    }
  }

  const manifestPath = path.join(snapshotDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  emitProgress("completed", { currentUrl: target.toString() });

  return {
    snapshotId,
    snapshotDir,
    savedFileCount: manifest.files.length,
    failedCount: manifest.failures.length,
    manifestPath
  };
}
