import {
  $,
  escapeHtml,
  formatDuration,
  formatSize,
  getExtension,
  statusLabel,
} from "./utils.js";

function thumbLabel(item) {
  if (item.metadata?.kind === "video") return "VIDEO";
  if (item.metadata?.kind === "audio") return "AUDIO";
  return "FILE";
}

function buildMetaText(item) {
  const parts = [formatSize(item.file.size)];
  if (item.metadata?.duration) parts.push(`長さ ${formatDuration(item.metadata.duration)}`);
  if (item.metadata?.width && item.metadata?.height) {
    parts.push(`${item.metadata.width}x${item.metadata.height}`);
  }
  parts.push(getExtension(item.file.name).toUpperCase() || "MEDIA");
  return parts.join(" / ");
}

export function createUI({
  onAddFiles,
  onCancel,
  onClearQueue,
  onDownloadAll,
  onDownloadZip,
  onQueueAction,
  onRetryFailed,
  onStartConvert,
} = {}) {
  const loadingScreen = $("#loading-screen");
  const loadingText = $("#loading-screen p");
  const app = $("#app");
  const dropZone = $("#drop-zone");
  const fileInput = $("#file-input");
  const queueSection = $("#queue-section");
  const queueList = $("#queue-list");
  const settings = $("#settings");
  const convertBtn = $("#convert-btn");
  const cancelBtn = $("#cancel-btn");
  const retryFailedBtn = $("#retry-failed-btn");
  const clearQueueBtn = $("#clear-queue-btn");
  const estimateBox = $("#estimate-box");
  const progressSection = $("#progress-section");
  const progressTitle = $("#progress-title");
  const progressFill = $("#progress-fill");
  const progressText = $("#progress-text");
  const progressCurrent = $("#progress-current");
  const logOutput = $("#log-output");
  const downloadsSection = $("#downloads-section");
  const downloadsSummary = $("#downloads-summary");
  const downloadsMessage = $("#downloads-message");
  const downloadsList = $("#downloads-list");
  const downloadAllBtn = $("#download-all-btn");
  const downloadZipBtn = $("#download-zip-btn");

  function showAppReady() {
    loadingScreen.classList.add("hidden");
    app.classList.remove("hidden");
  }

  function showLoadError(message) {
    loadingText.textContent = message;
  }

  function appendLog(message) {
    logOutput.textContent += `${message}\n`;
    const lines = logOutput.textContent.split("\n");
    if (lines.length > 500) {
      logOutput.textContent = lines.slice(-500).join("\n");
    }
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function clearLog() {
    logOutput.textContent = "";
  }

  function renderQueue(queue) {
    if (!queue.length) {
      queueList.innerHTML = '<li class="queue-empty">ファイルを追加するとここに表示されます。</li>';
      return;
    }

    queueList.innerHTML = queue.map((item) => {
      const statusText = statusLabel(item.status, item.progress);
      const thumbHtml = item.thumbnail
        ? `<img class="thumb" src="${item.thumbnail}" alt="サムネイル">`
        : `<div class="thumb thumb-fallback">${thumbLabel(item)}</div>`;

      const actions = [];
      if (item.status === "done" && item.resultUrl) {
        actions.push(
          `<button class="inline-btn success" type="button" data-action="download" data-id="${item.id}">ダウンロード</button>`,
          `<button class="inline-btn" type="button" data-action="requeue" data-id="${item.id}">再変換</button>`,
        );
      }
      if (item.status === "failed" || item.status === "canceled") {
        actions.push(`<button class="inline-btn" type="button" data-action="retry" data-id="${item.id}">再試行</button>`);
      }
      if (item.status !== "processing") {
        actions.push(
          `<button class="inline-btn danger" type="button" data-action="remove" data-id="${item.id}">削除</button>`,
        );
      }

      const progressHtml = item.status === "processing" || item.status === "done"
        ? `<div class="queue-progress"><span style="width:${item.progress}%"></span></div>`
        : "";
      const messageText = item.message || "";
      const messageHtml = messageText && messageText !== statusText
        ? `<div class="queue-message">${escapeHtml(messageText)}</div>`
        : "";

      return `
        <li class="queue-item status-${item.status}">
          ${thumbHtml}
          <div class="queue-main">
            <div class="queue-line">
              <span class="queue-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
              <span class="queue-state">${statusText}</span>
            </div>
            <div class="queue-meta">${escapeHtml(buildMetaText(item))}</div>
            ${progressHtml}
            ${messageHtml}
          </div>
          <div class="queue-actions">${actions.join("")}</div>
        </li>
      `;
    }).join("");
  }

  function renderDownloads({ items, isZipBusy, message, zipProgress }) {
    const hasItems = items.length > 0;
    downloadsSection.classList.toggle("hidden", !hasItems);
    if (!hasItems) {
      downloadsList.innerHTML = "";
      downloadsSummary.textContent = "";
      downloadsMessage.textContent = "";
      downloadsMessage.classList.add("hidden");
      downloadAllBtn.disabled = true;
      downloadZipBtn.disabled = true;
      downloadZipBtn.textContent = "ZIPでまとめて保存";
      return;
    }

    const totalSize = items.reduce((sum, item) => sum + (item.resultSize || 0), 0);
    downloadsSummary.textContent = `${items.length}件完了 / 合計 ${formatSize(totalSize)}`;
    downloadsMessage.textContent = message || "";
    downloadsMessage.classList.toggle("hidden", !message);
    downloadAllBtn.disabled = false;
    downloadZipBtn.disabled = isZipBusy;
    downloadZipBtn.textContent = isZipBusy
      ? `ZIPを作成中... ${Math.max(0, Math.min(100, zipProgress || 0))}%`
      : "ZIPでまとめて保存";

    downloadsList.innerHTML = items.map((item) => `
      <li class="download-item">
        <div class="download-item-main">
          <input class="download-item-name" type="text" value="${escapeHtml(item.resultName)}" data-action="rename" data-id="${item.id}" aria-label="ファイル名">
          <span class="download-item-meta">${formatSize(item.resultSize)}</span>
        </div>
        <button class="inline-btn success" type="button" data-action="download" data-id="${item.id}">ダウンロード</button>
      </li>
    `).join("");
  }

  function updateControls({ hasQueue, hasInvalidSettings, hasRetryable, isConverting, pendingCount }) {
    queueSection.classList.toggle("hidden", !hasQueue);
    settings.classList.toggle("hidden", !hasQueue);

    convertBtn.disabled = isConverting || pendingCount === 0 || hasInvalidSettings;
    cancelBtn.disabled = !isConverting;
    retryFailedBtn.classList.toggle("hidden", !hasRetryable);
    clearQueueBtn.disabled = isConverting;
  }

  function renderEstimate({ lines, warning }) {
    estimateBox.classList.toggle("hidden", !lines.length);
    if (!lines.length) {
      estimateBox.textContent = "";
      estimateBox.classList.remove("warning");
      return;
    }
    estimateBox.innerHTML = lines.map(escapeHtml).join("<br>");
    estimateBox.classList.toggle("warning", warning);
  }

  function showProgress(show) {
    progressSection.classList.toggle("hidden", !show);
  }

  function setProgress({ title, text, current, width } = {}) {
    if (typeof title === "string") progressTitle.textContent = title;
    if (typeof text === "string") progressText.textContent = text;
    if (typeof current === "string") progressCurrent.textContent = current;
    if (typeof width === "number") progressFill.style.width = `${Math.max(0, Math.min(100, width))}%`;
  }

  function resetProgress() {
    setProgress({
      title: "変換中...",
      text: "準備中...",
      current: "",
      width: 0,
    });
  }

  function bindEvents() {
    dropZone.addEventListener("click", (e) => {
      if (e.target.closest(".file-btn")) return;
      fileInput.click();
    });

    dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer?.files?.length && typeof onAddFiles === "function") {
        onAddFiles(e.dataTransfer.files);
      }
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files?.length && typeof onAddFiles === "function") {
        onAddFiles(e.target.files);
      }
      e.target.value = "";
    });

    queueList.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target || typeof onQueueAction !== "function") return;
      const id = Number(target.dataset.id);
      if (!Number.isFinite(id)) return;
      onQueueAction(target.dataset.action, id);
    });

    downloadsList.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target || target.tagName === "INPUT" || typeof onQueueAction !== "function") return;
      const id = Number(target.dataset.id);
      if (!Number.isFinite(id)) return;
      onQueueAction(target.dataset.action, id);
    });

    downloadsList.addEventListener("change", (e) => {
      const target = e.target.closest("[data-action='rename']");
      if (!target || typeof onQueueAction !== "function") return;
      const id = Number(target.dataset.id);
      if (!Number.isFinite(id)) return;
      onQueueAction("rename", id, target.value.trim() || target.defaultValue);
    });

    convertBtn.addEventListener("click", () => {
      if (typeof onStartConvert === "function") onStartConvert();
    });

    cancelBtn.addEventListener("click", () => {
      if (typeof onCancel === "function") onCancel();
    });

    retryFailedBtn.addEventListener("click", () => {
      if (typeof onRetryFailed === "function") onRetryFailed();
    });

    clearQueueBtn.addEventListener("click", () => {
      if (typeof onClearQueue === "function") onClearQueue();
    });

    downloadAllBtn.addEventListener("click", () => {
      if (typeof onDownloadAll === "function") onDownloadAll();
    });

    downloadZipBtn.addEventListener("click", () => {
      if (typeof onDownloadZip === "function") onDownloadZip();
    });
  }

  return {
    appendLog,
    bindEvents,
    clearLog,
    renderDownloads,
    renderEstimate,
    renderQueue,
    resetProgress,
    setProgress,
    showAppReady,
    showLoadError,
    showProgress,
    updateControls,
  };
}
