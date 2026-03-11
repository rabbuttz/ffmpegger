let handlersInstalled = false;

function prefix(scope, message) {
  return scope ? `[ffmpegger][${scope}] ${message}` : `[ffmpegger] ${message}`;
}

function normalizeError(error) {
  if (error instanceof Error) return error;
  return new Error(String(error ?? "Unknown error"));
}

export function isDebugEnabled() {
  return Boolean(globalThis.__FFMPEGGER_DEBUG__);
}

export function debugLog(scope, message, details) {
  if (!isDebugEnabled()) return;
  if (details === undefined) {
    console.log(prefix(scope, message));
    return;
  }
  console.log(prefix(scope, message), details);
}

export function debugError(scope, message, error, details) {
  if (!isDebugEnabled()) return;
  const label = prefix(scope, message);
  if (details === undefined) {
    console.error(label, normalizeError(error));
    return;
  }
  console.groupCollapsed(label);
  console.error(normalizeError(error));
  console.log("context", details);
  console.groupEnd();
}

export function installGlobalDebugHandlers() {
  if (!isDebugEnabled() || handlersInstalled) return;
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    debugError("window", "Unhandled error", event.error ?? event.message, {
      colno: event.colno,
      filename: event.filename,
      lineno: event.lineno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    debugError("window", "Unhandled promise rejection", event.reason);
  });

  debugLog("boot", "Global debug handlers installed");
}
