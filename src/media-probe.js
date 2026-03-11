import { debugError, debugLog } from "./debug.js";

function waitForEvent(target, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
      if (ok) resolve();
      else reject(err || new Error("timeout"));
    };

    const onEvent = () => finish(true);
    const onError = () => finish(false, new Error("event error"));
    const timer = setTimeout(() => finish(false, new Error("timeout")), timeoutMs);

    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function captureVideoThumbnail(videoEl) {
  try {
    if (videoEl.readyState < 2) {
      await waitForEvent(videoEl, "loadeddata", 3500);
    }

    if (Number.isFinite(videoEl.duration) && videoEl.duration > 1) {
      videoEl.currentTime = Math.min(1, videoEl.duration * 0.1);
      await waitForEvent(videoEl, "seeked", 3500);
    }

    if (!videoEl.videoWidth || !videoEl.videoHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return null;
  }
}

export async function probeMediaFile(file) {
  const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
  if (!kind) {
    debugLog("probe", "Skipped probe because MIME type is unsupported", {
      fileName: file.name,
      type: file.type,
    });
    return null;
  }

  const url = URL.createObjectURL(file);
  const media = document.createElement(kind);
  media.preload = "metadata";
  media.src = url;
  media.muted = true;
  media.playsInline = true;

  try {
    await waitForEvent(media, "loadedmetadata", 5000);
    const metadata = {
      kind,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      width: kind === "video" ? media.videoWidth || null : null,
      height: kind === "video" ? media.videoHeight || null : null,
    };

    const thumbnail = kind === "video" ? await captureVideoThumbnail(media) : null;
    return { metadata, thumbnail };
  } catch (error) {
    debugError("probe", "Failed to probe media file", error, {
      fileName: file.name,
      kind,
      type: file.type,
    });
    throw error;
  } finally {
    URL.revokeObjectURL(url);
    media.removeAttribute("src");
    media.load();
  }
}
