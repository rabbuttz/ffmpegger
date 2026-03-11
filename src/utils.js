export const $ = (selector) => document.querySelector(selector);

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const sec = Math.max(1, Math.round(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
  const totalMilliseconds = Math.round(seconds * 1000);
  const h = Math.floor(totalMilliseconds / 3600000);
  const m = Math.floor((totalMilliseconds % 3600000) / 60000);
  const s = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const base = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (milliseconds === 0) return base;
  return `${base}.${String(milliseconds).padStart(3, "0").replace(/0+$/, "")}`;
}

export function parseTimecodeInput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) return Number.NaN;
  const head = parts.slice(0, -1);
  const tail = parts[parts.length - 1];
  if (head.some((part) => !/^\d+$/.test(part))) return Number.NaN;
  if (!/^\d+(\.\d+)?$/.test(tail)) return Number.NaN;

  const numbers = [...head.map(Number), Number(tail)];
  const [hours, minutes, seconds] = parts.length === 3 ? numbers : [0, numbers[0], numbers[1]];

  if (minutes >= 60 || seconds >= 60) return Number.NaN;
  return (hours * 3600) + (minutes * 60) + seconds;
}

export function getExtension(name) {
  const parts = String(name).split(".");
  if (parts.length < 2) return "";
  return parts.pop().toLowerCase();
}

export function stripExtension(name) {
  return String(name).replace(/\.[^.]+$/, "");
}

export function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, (ch) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return map[ch] || ch;
  });
}

export function getMimeType(filename) {
  const ext = getExtension(filename);
  const map = {
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    gif: "image/gif",
    mp3: "audio/mpeg",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    opus: "audio/opus",
  };
  return map[ext] || "application/octet-stream";
}

export function statusLabel(status, progress) {
  if (status === "pending") return "待機中";
  if (status === "processing") return `変換中 ${progress}%`;
  if (status === "done") return "完了";
  if (status === "failed") return "失敗";
  if (status === "canceled") return "中断";
  return "-";
}
