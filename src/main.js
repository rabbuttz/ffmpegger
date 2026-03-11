import { ACCEPTED_EXTENSIONS } from "./constants.js";
import { buildEstimate } from "./estimation.js";
import { debugError, debugLog, installGlobalDebugHandlers } from "./debug.js";
import { createResultsZip, downloadResultItem, downloadResultItems } from "./downloads.js";
import { probeMediaFile } from "./media-probe.js";
import { createSettingsManager } from "./settings.js";
import { createUI } from "./ui.js";
import { formatDuration, formatSize, getExtension } from "./utils.js";
import { createWorkerPool } from "./worker-pool.js";
import { readFriendlyError } from "./ffmpeg-engine.js";

const state = {
  cancelRequested: false,
  currentBatch: {
    ids: [],
    parallelism: 1,
    total: 0,
  },
  isConverting: false,
  nextQueueId: 1,
  queue: [],
  renderPending: false,
  zip: {
    cacheKey: "",
    fileName: "",
    message: "",
    progress: 0,
    url: null,
    working: false,
  },
};

const ui = createUI({
  onAddFiles: addFiles,
  onCancel: requestCancel,
  onClearQueue: clearQueue,
  onDownloadAll: downloadAllCompleted,
  onDownloadZip: downloadZipArchive,
  onQueueAction: handleQueueAction,
  onRetryFailed: retryFailedItems,
  onStartConvert: startConversion,
});

const workerPool = createWorkerPool({
  onLog: handleWorkerLog,
  onProgress: handleWorkerProgress,
});

const settingsManager = createSettingsManager({
  onChange: (settings) => {
    updateEstimate();
    scheduleRender();
    if (!state.isConverting) {
      warmWorkers(settings.parallelism);
    }
  },
});

function syncTrimPreview() {
  settingsManager.syncPreviewItems(state.queue);
}

function isMediaFile(file) {
  if (!file) return false;
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) return true;
  return ACCEPTED_EXTENSIONS.has(getExtension(file.name));
}

function createQueueItem(file) {
  return {
    error: "",
    file,
    id: state.nextQueueId++,
    message: "待機中",
    metadata: null,
    progress: 0,
    resultBlob: null,
    resultName: "",
    resultSize: 0,
    resultUrl: null,
    status: "pending",
    thumbnail: null,
  };
}

function pendingCount() {
  return state.queue.filter((item) => item.status === "pending").length;
}

function hasRetryable() {
  return state.queue.some((item) => item.status === "failed" || item.status === "canceled");
}

function updateControls() {
  const settings = settingsManager.getSettings();
  ui.updateControls({
    hasQueue: state.queue.length > 0,
    hasInvalidSettings: Boolean(settings.trimError),
    hasRetryable: hasRetryable(),
    isConverting: state.isConverting,
    pendingCount: pendingCount(),
  });
}

function updateEstimate() {
  ui.renderEstimate(buildEstimate(state.queue, settingsManager.getSettings()));
}

function scheduleRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  requestAnimationFrame(() => {
    state.renderPending = false;
    ui.renderQueue(state.queue);
    renderDownloads();
    updateControls();
  });
}

function getCompletedItems() {
  return state.queue.filter((item) => item.status === "done" && item.resultBlob);
}

function zipCacheKey(items) {
  return items.map((item) => `${item.id}:${item.resultName}:${item.resultSize}`).join("|");
}

function invalidateZipCache({ keepMessage = false } = {}) {
  if (state.zip.url) {
    URL.revokeObjectURL(state.zip.url);
  }

  state.zip.cacheKey = "";
  state.zip.fileName = "";
  state.zip.progress = 0;
  state.zip.url = null;
  if (!keepMessage) {
    state.zip.message = "";
  }
}

function renderDownloads() {
  ui.renderDownloads({
    isZipBusy: state.zip.working,
    items: getCompletedItems(),
    message: state.zip.message,
    zipProgress: state.zip.progress,
  });
}

function warmWorkers(count) {
  const workerCount = Math.max(1, Number(count) || 1);
  workerPool.init(workerCount).catch((error) => {
    debugError("worker-pool", "Failed to warm workers", error, { workerCount });
    // Keep the current UI responsive even if extra workers fail to warm up.
  });
}

function revokeResultUrl(item) {
  if (!item?.resultUrl) return;
  URL.revokeObjectURL(item.resultUrl);
  item.resultUrl = null;
}

function clearResult(item) {
  revokeResultUrl(item);
  item.resultBlob = null;
  item.resultName = "";
  item.resultSize = 0;
  invalidateZipCache();
}

function getBatchItems() {
  const ids = new Set(state.currentBatch.ids);
  return state.queue.filter((item) => ids.has(item.id));
}

function getProgressItems() {
  return getBatchItems().filter((item) => item.status === "processing");
}

function getFinishedItems() {
  return getBatchItems().filter((item) => ["done", "failed", "canceled"].includes(item.status));
}

function buildProgressCurrent(activeItems) {
  if (!activeItems.length) return "次のファイルを準備中...";
  return activeItems.map((item) => item.file.name).join(" / ");
}

function buildProgressSummary() {
  const total = state.currentBatch.total;
  if (!total) {
    return {
      activeItems: [],
      finishedCount: 0,
      percent: 0,
    };
  }

  const activeItems = getProgressItems();
  const finishedCount = getFinishedItems().length;
  const partialProgress = activeItems.reduce((sum, item) => sum + (item.progress / 100), 0);
  const percent = Math.round(((finishedCount + partialProgress) / total) * 100);

  return {
    activeItems,
    finishedCount,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

function updateOverallProgress(overrides = {}) {
  if (!state.currentBatch.total) return;

  const { activeItems, finishedCount, percent } = buildProgressSummary();
  ui.setProgress({
    current: overrides.current ?? buildProgressCurrent(activeItems),
    text: overrides.text ?? `全体 ${percent}% / 処理中 ${activeItems.length}件 / 同時変換 ${state.currentBatch.parallelism}本`,
    title: overrides.title ?? `変換中 (${finishedCount}/${state.currentBatch.total} 完了)`,
    width: overrides.width ?? percent,
  });
}

function handleWorkerLog(worker, message) {
  const prefix = worker.currentItem ? `[${worker.currentItem.file.name}] ` : `[worker ${worker.id}] `;
  ui.appendLog(`${prefix}${message}`);
  debugLog("ffmpeg", "Worker log", {
    item: worker.currentItem?.file?.name || null,
    message,
    workerId: worker.id,
  });
}

function etaText(worker, progress) {
  if (!worker.startedAt || !Number.isFinite(progress) || progress <= 0) return "";
  const elapsed = (Date.now() - worker.startedAt) / 1000;
  if (elapsed < 1) return "";
  const remain = Math.round((elapsed / progress) - elapsed);
  if (!Number.isFinite(remain) || remain < 0) return "";
  return formatDuration(remain);
}

function handleWorkerProgress(worker, progress) {
  if (!state.isConverting || !worker.currentItem) return;

  const item = worker.currentItem;
  if (item.status !== "processing") return;

  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const percent = Math.round(safeProgress * 100);
  const eta = etaText(worker, safeProgress);

  item.progress = percent;
  item.message = eta ? `変換中 ${percent}% / 残り約${eta}` : `変換中 ${percent}%`;

  updateOverallProgress();
  scheduleRender();
}

async function enrichQueueItem(item) {
  try {
    const info = await probeMediaFile(item.file);
    if (!info) return;
    item.metadata = info.metadata;
    item.thumbnail = info.thumbnail;
    syncTrimPreview();
    updateEstimate();
    scheduleRender();
  } catch (error) {
    debugError("probe", "Failed to enrich queue item", error, {
      fileName: item.file.name,
      size: item.file.size,
      type: item.file.type,
    });
  }
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;

  for (const file of files) {
    if (!isMediaFile(file)) {
      debugLog("queue", "Skipped unsupported file", { fileName: file.name, type: file.type });
      continue;
    }
    const item = createQueueItem(file);
    state.queue.push(item);
    added += 1;
    enrichQueueItem(item);
  }

  if (added === 0) return;

  syncTrimPreview();
  updateEstimate();
  scheduleRender();
}

function markItemPending(item) {
  item.error = "";
  item.message = "待機中";
  item.progress = 0;
  item.status = "pending";
  clearResult(item);
}

function markItemProcessing(item, message = "入力を読み込み中...") {
  item.error = "";
  item.message = message;
  item.progress = 0;
  item.status = "processing";
}

function uniqueResultName(baseName) {
  const taken = new Set(
    state.queue.filter((i) => i.status === "done" && i.resultName).map((i) => i.resultName),
  );
  if (!taken.has(baseName)) return baseName;
  const dot = baseName.lastIndexOf(".");
  const stem = dot >= 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot >= 0 ? baseName.slice(dot) : "";
  let n = 2;
  while (taken.has(`${stem}_${n}${ext}`)) n++;
  return `${stem}_${n}${ext}`;
}

function finalizeItemSuccess(item, result) {
  clearResult(item);
  item.resultBlob = result.blob;
  item.resultUrl = URL.createObjectURL(result.blob);
  item.resultName = uniqueResultName(result.resultName);
  item.resultSize = result.blob.size;
  item.status = "done";
  item.progress = 100;
  item.message = `完了 (${formatSize(result.blob.size)})`;
}

function finalizeItemError(item, error) {
  const raw = String(error?.message || error || "");
  if (state.cancelRequested || /abort|aborted|terminated/i.test(raw)) {
    item.status = "canceled";
    item.progress = 0;
    item.message = "キャンセルされました";
    return;
  }

  item.status = "failed";
  item.progress = 0;
  item.error = readFriendlyError(error);
  item.message = item.error;
  ui.appendLog(`[error][${item.file.name}] ${raw}`);
  debugError("convert", "Item failed", error, {
    fileName: item.file.name,
    friendly: item.error,
  });
}

function downloadCompletedItem(id) {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item?.resultBlob) return;
  downloadResultItem(item);
}

function downloadAllCompleted() {
  const items = getCompletedItems();
  if (!items.length) return;

  state.zip.message = "ブラウザ設定によっては複数ダウンロードの許可が必要です。";
  downloadResultItems(items);
  scheduleRender();
}

function triggerCachedDownload(url, fileName) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadZipArchive() {
  const items = getCompletedItems();
  if (!items.length || state.zip.working) return;

  const nextKey = zipCacheKey(items);
  if (state.zip.url && state.zip.cacheKey === nextKey) {
    triggerCachedDownload(state.zip.url, state.zip.fileName);
    return;
  }

  state.zip.working = true;
  state.zip.progress = 0;
  state.zip.message = "ZIPを作成しています...";
  scheduleRender();

  try {
    invalidateZipCache({ keepMessage: true });
    const zipResult = await createResultsZip(items, (progress) => {
      state.zip.progress = progress;
      scheduleRender();
    });

    state.zip.cacheKey = nextKey;
    state.zip.fileName = zipResult.fileName;
    state.zip.url = URL.createObjectURL(zipResult.blob);
    state.zip.message = `${items.length}件をZIPにまとめました。`;
    triggerCachedDownload(state.zip.url, state.zip.fileName);
  } catch (error) {
    state.zip.message = "ZIPの作成に失敗しました。個別保存を試してください。";
    ui.appendLog(`[error][zip] ${String(error?.message || error || "")}`);
    debugError("zip", "ZIP creation failed", error, {
      itemCount: items.length,
    });
  } finally {
    state.zip.working = false;
    state.zip.progress = 0;
    scheduleRender();
  }
}

function handleWorkerStage({ item, payload, stage }) {
  debugLog("worker-stage", "Stage update", {
    args: payload?.args,
    fileName: item.file.name,
    stage,
  });

  if (stage === "reading") {
    markItemProcessing(item);
    updateOverallProgress();
    scheduleRender();
    return;
  }

  if (stage === "converting") {
    markItemProcessing(item, "変換中...");
    if (payload?.args) {
      ui.appendLog(`== ${item.file.name} ==`);
      ui.appendLog(`ffmpeg ${payload.args.join(" ")}`);
    }
    updateOverallProgress();
    scheduleRender();
    return;
  }

  if (stage === "packaging") {
    item.progress = Math.max(item.progress, 100);
    item.message = "出力を作成中...";
    updateOverallProgress();
    scheduleRender();
    return;
  }

  if (stage === "done") {
    finalizeItemSuccess(item, payload.result);
    updateOverallProgress();
    scheduleRender();
    return;
  }

  if (stage === "error") {
    finalizeItemError(item, payload.error);
    updateOverallProgress();
    scheduleRender();
  }
}

function finishProgressSummary(wasCanceled) {
  const batchItems = getBatchItems();
  const doneCount = batchItems.filter((item) => item.status === "done").length;
  const failedCount = batchItems.filter((item) => item.status === "failed").length;
  const canceledCount = batchItems.filter((item) => item.status === "canceled").length;

  if (wasCanceled) {
    updateOverallProgress({
      current: "再開するには「変換開始」または「再試行」を押してください。",
      text: `${doneCount + failedCount + canceledCount} / ${state.currentBatch.total} 件を停止または完了しました。`,
      title: "変換を停止しました",
    });
    return;
  }

  const summary = failedCount > 0
    ? `完了 ${doneCount} 件 / 失敗 ${failedCount} 件`
    : `完了 ${doneCount} 件`;

  updateOverallProgress({
    current: `${summary} / 全 ${state.currentBatch.total} 件`,
    text: "キューの処理が完了しました。",
    title: "変換完了",
    width: 100,
  });
}

async function startConversion() {
  if (state.isConverting) return;

  let pendingItems = state.queue.filter((item) => item.status === "pending");
  if (!pendingItems.length) {
    const doneItems = state.queue.filter((item) => item.status === "done");
    for (const item of doneItems) {
      const newItem = createQueueItem(item.file);
      state.queue.push(newItem);
      enrichQueueItem(newItem);
    }
    pendingItems = state.queue.filter((item) => item.status === "pending");
  }
  if (!pendingItems.length) return;

  const settingsSnapshot = settingsManager.getSettings();
  if (settingsSnapshot.trimError) {
    debugLog("convert", "Blocked conversion because trim settings are invalid");
    updateEstimate();
    scheduleRender();
    return;
  }
  const requestedParallelism = Math.max(1, Number(settingsSnapshot.parallelism) || 1);
  const workerCount = Math.min(requestedParallelism, pendingItems.length);

  state.isConverting = true;
  state.cancelRequested = false;
  state.currentBatch = {
    ids: pendingItems.map((item) => item.id),
    parallelism: workerCount,
    total: pendingItems.length,
  };

  ui.showProgress(true);
  ui.clearLog();
  updateControls();
  updateOverallProgress({
    current: buildProgressCurrent(pendingItems.slice(0, workerCount)),
    text: `ワーカーを準備中... / 同時変換 ${workerCount}本`,
    title: "変換を開始しています",
    width: 0,
  });
  debugLog("convert", "Starting conversion batch", {
    fileCount: pendingItems.length,
    workerCount,
  });

  try {
    await workerPool.run(pendingItems, {
      isCanceled: () => state.cancelRequested,
      onStage: handleWorkerStage,
      parallelism: workerCount,
      settings: settingsSnapshot,
    });
  } catch (error) {
    debugError("convert", "Failed to initialize worker pool", error, {
      workerCount,
    });
    state.isConverting = false;
    state.cancelRequested = false;
    updateControls();
    ui.setProgress({
      current: "",
      text: "FFmpeg の初期化に失敗しました。ページ再読み込みで再試行してください。",
      title: "変換を開始できませんでした",
      width: 0,
    });
    return;
  }

  state.isConverting = false;
  const wasCanceled = state.cancelRequested;
  state.cancelRequested = false;

  updateControls();
  updateEstimate();
  finishProgressSummary(wasCanceled);
  scheduleRender();
}

function requestCancel() {
  if (!state.isConverting) return;
  state.cancelRequested = true;
  debugLog("convert", "Cancellation requested", {
    activeWorkers: workerPool.getActiveWorkers().length,
  });
  ui.setProgress({
    current: "現在の処理が停止するまでお待ちください。",
    text: `キャンセル中... ${workerPool.getActiveWorkers().length}件を停止しています`,
  });
  workerPool.terminateAll();
}

function removeQueueItem(id) {
  const idx = state.queue.findIndex((item) => item.id === id);
  if (idx < 0) return;
  if (state.queue[idx].status === "processing") return;

  const item = state.queue[idx];
  clearResult(item);
  state.queue.splice(idx, 1);

  if (!state.queue.length) {
    ui.showProgress(false);
    ui.resetProgress();
  }

  syncTrimPreview();
  updateEstimate();
  scheduleRender();
}

function retryQueueItem(id) {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item || item.status === "processing") return;

  markItemPending(item);
  updateEstimate();
  scheduleRender();
}

function reQueueItem(id) {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return;

  const newItem = createQueueItem(item.file);
  state.queue.push(newItem);
  enrichQueueItem(newItem);

  syncTrimPreview();
  updateEstimate();
  scheduleRender();
}

function retryFailedItems() {
  let changed = false;

  for (const item of state.queue) {
    if (item.status !== "failed" && item.status !== "canceled") continue;
    markItemPending(item);
    changed = true;
  }

  if (!changed) return;

  updateEstimate();
  scheduleRender();
}

function clearQueue() {
  if (state.isConverting) return;

  for (const item of state.queue) {
    clearResult(item);
  }

  state.queue = [];
  syncTrimPreview();
  ui.showProgress(false);
  ui.resetProgress();
  updateEstimate();
  scheduleRender();
}

function renameResultItem(id, newName) {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item || item.status !== "done") return;
  item.resultName = newName;
  invalidateZipCache();
}

function handleQueueAction(action, id, payload) {
  if (action === "download") downloadCompletedItem(id);
  if (action === "remove") removeQueueItem(id);
  if (action === "retry") retryQueueItem(id);
  if (action === "requeue") reQueueItem(id);
  if (action === "rename") renameResultItem(id, payload);
}

async function bootstrap() {
  installGlobalDebugHandlers();
  debugLog("boot", "Starting application bootstrap");
  ui.bindEvents();
  settingsManager.init();
  syncTrimPreview();
  updateEstimate();
  scheduleRender();

  try {
    await workerPool.init(1);
    ui.showAppReady();
    warmWorkers(settingsManager.getSettings().parallelism);
  } catch (error) {
    debugError("boot", "FFmpeg bootstrap failed", error);
    ui.showLoadError("FFmpeg の読み込みに失敗しました。ページ再読み込みで再試行してください。");
  }
}

bootstrap();
