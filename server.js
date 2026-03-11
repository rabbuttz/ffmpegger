import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const DEBUG = process.argv.includes("--debug") || process.env.DEBUG === "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

function logDebug(message, details) {
  if (!DEBUG) return;
  if (details === undefined) {
    console.debug(`[server][debug] ${message}`);
    return;
  }
  console.debug(`[server][debug] ${message}`, details);
}

function logError(message, error, details) {
  console.error(`[server][error] ${message}`);
  if (details !== undefined) {
    console.error(details);
  }
  if (error) {
    console.error(error);
  }
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function requestPathFromUrl(url) {
  const rawPath = (url || "/").split("?")[0] || "/";
  try {
    return decodeURIComponent(rawPath === "/" ? "/index.html" : rawPath);
  } catch {
    return null;
  }
}

function resolveFilePath(requestPath) {
  if (!requestPath?.startsWith("/")) return null;
  const filePath = resolve(ROOT_DIR, `.${requestPath}`);
  return filePath.startsWith(ROOT_DIR) ? filePath : null;
}

function injectDebugFlag(html) {
  const script = `<script>window.__FFMPEGGER_DEBUG__ = ${DEBUG ? "true" : "false"};</script>`;
  const appScript = '<script src="app.js" type="module"></script>';
  if (html.includes(appScript)) {
    return html.replace(appScript, `${script}\n  ${appScript}`);
  }
  return html.includes("</body>")
    ? html.replace("</body>", `  ${script}\n</body>`)
    : `${html}\n${script}`;
}

const server = createServer(async (req, res) => {
  const requestPath = requestPathFromUrl(req.url);
  const filePath = resolveFilePath(requestPath);

  if (!requestPath || !filePath) {
    sendText(res, 400, "Bad Request");
    logDebug("Rejected invalid request path", { method: req.method, url: req.url });
    return;
  }

  const ext = extname(filePath);

  // COOP/COEP headers required for SharedArrayBuffer (ffmpeg.wasm)
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  try {
    const data = await readFile(filePath);
    if (ext === ".html") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(injectDebugFlag(data.toString("utf8")));
      logDebug("Served HTML", { method: req.method, path: requestPath });
      return;
    }

    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
    logDebug("Served asset", { method: req.method, path: requestPath });
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendText(res, 404, "Not Found");
      logDebug("Asset not found", { method: req.method, path: requestPath });
      return;
    }

    sendText(res, 500, "Internal Server Error");
    logError("Failed to serve request", error, { method: req.method, path: requestPath });
  }
});

server.on("error", (error) => {
  logError("Server failed to start", error, { port: PORT });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}${DEBUG ? " (debug)" : ""}`);
  logDebug("Verbose logging enabled");
});
