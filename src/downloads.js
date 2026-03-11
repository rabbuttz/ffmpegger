function triggerDownload(url, fileName) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function uniqueZipNames(items) {
  const used = new Map();

  return items.map((item) => {
    const original = item.resultName || "output.bin";
    const dotIndex = original.lastIndexOf(".");
    const baseName = dotIndex > 0 ? original.slice(0, dotIndex) : original;
    const ext = dotIndex > 0 ? original.slice(dotIndex) : "";
    const key = original.toLowerCase();
    const nextCount = (used.get(key) || 0) + 1;

    used.set(key, nextCount);
    if (nextCount === 1) return original;
    return `${baseName} (${nextCount})${ext}`;
  });
}

function buildZipFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `ffmpegger-${stamp}.zip`;
}

export function downloadResultItem(item) {
  if (!item?.resultBlob || !item.resultName) return;
  const url = URL.createObjectURL(item.resultBlob);
  triggerDownload(url, item.resultName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadResultItems(items) {
  for (const item of items) {
    downloadResultItem(item);
  }
}

export async function createResultsZip(items, onProgress) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) {
    throw new Error("ZIP library unavailable");
  }

  const zip = new JSZip();
  const names = uniqueZipNames(items);

  items.forEach((item, index) => {
    if (!item?.resultBlob) return;
    zip.file(names[index], item.resultBlob);
  });

  const blob = await zip.generateAsync(
    {
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      type: "blob",
    },
    (metadata) => {
      if (typeof onProgress === "function") {
        onProgress(Math.round(metadata.percent));
      }
    },
  );

  return {
    blob,
    fileName: buildZipFileName(),
  };
}
