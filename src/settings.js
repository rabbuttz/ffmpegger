import {
  AUDIO_FORMATS,
  CODEC_LABELS,
  DEFAULT_FRAME_NUDGE_SECONDS,
  DEFAULT_PARALLELISM,
  FORMAT_CODEC_COMPAT,
  FORMAT_DEFAULTS,
  OUTPUT_FORMAT_GROUPS,
  QUALITY_MAP,
  STORAGE_KEY,
} from "./constants.js";
import { debugError, debugLog } from "./debug.js";
import { $, formatClock, parseTimecodeInput } from "./utils.js";
import { createWaveformSampler } from "./waveform.js";

const TRIM_STEP = DEFAULT_FRAME_NUDGE_SECONDS;
const DEFAULT_PREVIEW_VOLUME = 1;

function codecLabel(value) {
  return CODEC_LABELS[value] || value;
}

function populateSelect(selectEl, values, preferredValue) {
  const html = values.map((value) => `<option value="${value}">${codecLabel(value)}</option>`).join("");
  selectEl.innerHTML = html;

  if (preferredValue && values.includes(preferredValue)) {
    selectEl.value = preferredValue;
    return;
  }

  if (values.includes("auto")) {
    selectEl.value = "auto";
  } else if (values.length > 0) {
    selectEl.value = values[0];
  }
}

function mediaKind(item) {
  if (item?.metadata?.kind) return item.metadata.kind;
  return item?.file?.type.startsWith("video/") ? "video" : "audio";
}

export function createSettingsManager({ onChange } = {}) {
  const formatEl = $("#output-format");
  const videoCodecEl = $("#video-codec");
  const audioCodecEl = $("#audio-codec");
  const qualityEl = $("#quality");
  const resolutionEl = $("#resolution");
  const parallelismEl = $("#parallelism");
  const parallelismGroupEl = parallelismEl?.closest(".setting-group");
  const trimStartEl = $("#trim-start");
  const trimEndEl = $("#trim-end");
  const trimGroupEl = trimStartEl?.closest(".trim-setting-group");
  const trimDisclosureEl = $("#trim-disclosure");
  const trimToggleChipEl = $("#trim-toggle-chip");
  const trimSetStartBtnEl = $("#trim-set-start-btn");
  const trimSeekStartBtnEl = $("#trim-seek-start-btn");
  const trimSetEndBtnEl = $("#trim-set-end-btn");
  const trimSeekEndBtnEl = $("#trim-seek-end-btn");
  const trimPlaySelectionBtnEl = $("#trim-play-selection-btn");
  const trimPlaySelectionIconEl = $("#trim-play-selection-icon");
  const trimResetBtnEl = $("#trim-reset-btn");
  const trimErrorEl = $("#trim-error");
  const trimPreviewEl = $("#trim-preview");
  const trimPreviewPickerEl = $("#trim-preview-picker");
  const trimPreviewFileEl = $("#trim-preview-file");
  const trimVideoEl = $("#trim-video");
  const trimAudioEl = $("#trim-audio");
  const trimPlayheadEl = $("#trim-playhead");
  const trimSelectionSliderEl = $("#trim-selection-slider");
  const trimSelectionFillEl = $("#trim-selection-fill");
  const trimWaveformEl = $("#trim-waveform");
  const trimCurrentMarkerEl = $("#trim-current-marker");
  const trimCurrentTimeEl = $("#trim-current-time");
  const trimDurationEl = $("#trim-duration");
  const trimHandleStartEl = $("#trim-handle-start");
  const trimHandleEndEl = $("#trim-handle-end");
  const trimStartDisplayEl = $("#trim-start-display");
  const trimEndDisplayEl = $("#trim-end-display");

  const trimJumpBackBtnEl = $("#trim-jump-back-btn");
  const trimJumpForwardBtnEl = $("#trim-jump-forward-btn");
  const formatCardsEl = $("#format-cards");
  const advancedToggleEl = $("#advanced-toggle");
  const advancedSettingsEl = $("#advanced-settings");

  let ignoreEvents = false;
  let isAdvancedMode = false;
  let isTrimEnabled = false;
  let previewDuration = 0;
  let previewItemId = null;
  let previewItems = [];
  let previewUrl = "";
  let waveformPeaks = [];
  let waveformRequestId = 0;
  let waveformResizeObserver = null;
  const waveformCache = new Map();
  const waveformSampler = createWaveformSampler();
  let selectionDrag = null;
  let handleDrag = null;
  let lastTrimActionState = "";
  let playbackWatchId = 0;
  let lastTimeUpdateBucket = null;

  function drawRoundedBar(ctx, x, y, width, height) {
    const radius = Math.min(width / 2, height / 2, 3);
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      ctx.fill();
      return;
    }

    ctx.fillRect(x, y, width, height);
  }

  function resizeWaveformCanvas() {
    const width = Math.round(trimWaveformEl.clientWidth);
    const height = Math.round(trimWaveformEl.clientHeight);
    if (!width || !height) return null;

    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);

    if (trimWaveformEl.width !== pixelWidth || trimWaveformEl.height !== pixelHeight) {
      trimWaveformEl.width = pixelWidth;
      trimWaveformEl.height = pixelHeight;
    }

    const ctx = trimWaveformEl.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    return { ctx, height, width };
  }

  function drawWaveform(peaks = []) {
    waveformPeaks = Array.isArray(peaks) ? peaks : [];
    const canvas = resizeWaveformCanvas();
    if (!canvas) return;

    trimWaveformEl.classList.toggle("is-empty", waveformPeaks.length === 0);
    if (!waveformPeaks.length) return;

    const { ctx, height, width } = canvas;
    const centerY = height / 2;
    const barCount = Math.min(waveformPeaks.length, Math.max(24, Math.floor(width / 3)));
    const barStep = width / barCount;
    const barWidth = Math.max(1.5, barStep - 1.2);
    const usableHeight = Math.max(8, height - 6);

    for (let index = 0; index < barCount; index += 1) {
      const sourceIndex = Math.min(
        waveformPeaks.length - 1,
        Math.floor((index / barCount) * waveformPeaks.length),
      );
      const amplitude = waveformPeaks[sourceIndex] || 0;
      const barHeight = Math.max(4, amplitude * usableHeight);
      const x = index * barStep + ((barStep - barWidth) / 2);
      const y = centerY - (barHeight / 2);
      ctx.fillStyle = amplitude > 0.6 ? "rgba(61, 117, 143, 0.52)" : "rgba(99, 148, 168, 0.34)";
      drawRoundedBar(ctx, x, y, barWidth, barHeight);
    }
  }

  function redrawWaveform() {
    drawWaveform(waveformPeaks);
  }

  async function loadWaveform(item) {
    waveformRequestId += 1;
    const currentRequestId = waveformRequestId;

    if (!item?.file) {
      trimWaveformEl.classList.remove("is-loading");
      drawWaveform();
      return;
    }

    if (waveformCache.has(item.id)) {
      trimWaveformEl.classList.remove("is-loading");
      drawWaveform(waveformCache.get(item.id));
      return;
    }

    trimWaveformEl.classList.add("is-loading");
    drawWaveform();

    try {
      const peaks = await waveformSampler.extractPeaks(item.file);
      if (currentRequestId !== waveformRequestId || previewItemId !== item.id) return;
      waveformCache.set(item.id, peaks);
      drawWaveform(peaks);
    } catch {
      if (currentRequestId !== waveformRequestId || previewItemId !== item.id) return;
      waveformCache.set(item.id, []);
      drawWaveform();
    } finally {
      if (currentRequestId === waveformRequestId) {
        trimWaveformEl.classList.remove("is-loading");
      }
    }
  }

  function populateOutputFormats() {
    formatEl.innerHTML = OUTPUT_FORMAT_GROUPS.map((group) => `
      <optgroup label="${group.label}">
        ${group.formats.map((format) => `<option value="${format.value}">${format.title} (.${format.value})</option>`).join("")}
      </optgroup>
    `).join("");

    formatCardsEl.innerHTML = OUTPUT_FORMAT_GROUPS.map((group) => `
      <div class="format-card-group">
        <p class="format-card-group-label">${group.label}</p>
        <div class="format-card-grid">
          ${group.formats.map((format) => `
            <button
              class="format-card"
              type="button"
              role="radio"
              aria-checked="false"
              data-format-value="${format.value}"
            >
              <span class="format-card-title">${format.title}</span>
              <span class="format-card-ext">.${format.value}</span>
              <span class="format-card-description">${format.description}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  function syncFormatCards() {
    const currentValue = formatEl.value;
    const cards = formatCardsEl.querySelectorAll("[data-format-value]");

    for (const card of cards) {
      const isSelected = card.dataset.formatValue === currentValue;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-checked", String(isSelected));
    }
  }

  function hasSavedTrimValues(saved) {
    return Boolean(String(saved?.trimStart ?? "").trim() || String(saved?.trimEnd ?? "").trim());
  }

  function resetTrimInputs() {
    trimStartEl.value = formatClock(0);
    trimEndEl.value = "";
  }

  function currentPreviewItem() {
    return previewItems.find((item) => item.id === previewItemId) || null;
  }

  function roundSeconds(value) {
    return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
  }

  function mediaErrorCode(error) {
    if (!error?.code) return null;
    return {
      1: "MEDIA_ERR_ABORTED",
      2: "MEDIA_ERR_NETWORK",
      3: "MEDIA_ERR_DECODE",
      4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
    }[error.code] || `MEDIA_ERR_${error.code}`;
  }

  function previewMediaFromEvent(event) {
    return event?.currentTarget instanceof HTMLMediaElement
      ? event.currentTarget
      : activePreviewMedia();
  }

  function previewDebugState(mediaEl = activePreviewMedia()) {
    const item = currentPreviewItem();
    const trimState = getTrimState();
    const mediaError = mediaEl?.error;
    const videoPlaybackQuality = typeof mediaEl?.getVideoPlaybackQuality === "function"
      ? mediaEl.getVideoPlaybackQuality()
      : null;

    return {
      canPlayType: item?.file?.type ? mediaEl?.canPlayType(item.file.type) || "" : "",
      currentTime: roundSeconds(mediaEl?.currentTime),
      decodedVideoFrames: videoPlaybackQuality?.totalVideoFrames ?? null,
      defaultPlaybackRate: mediaEl?.defaultPlaybackRate ?? null,
      documentHidden: document.hidden,
      documentVisibility: document.visibilityState,
      duration: roundSeconds(mediaEl?.duration),
      ended: Boolean(mediaEl?.ended),
      fileName: item?.file?.name || null,
      fileType: item?.file?.type || null,
      isActiveMedia: Boolean(mediaEl && mediaEl === activePreviewMedia()),
      mediaErrorCode: mediaErrorCode(mediaError),
      mediaErrorMessage: mediaError?.message || null,
      mediaKind: item ? mediaKind(item) : null,
      muted: mediaEl?.muted ?? null,
      networkState: mediaEl?.networkState ?? null,
      paused: mediaEl?.paused ?? null,
      playbackRate: mediaEl?.playbackRate ?? null,
      playButtonDisabled: trimPlaySelectionBtnEl.disabled,
      previewDuration: roundSeconds(previewDuration),
      previewItemCount: previewItems.length,
      previewItemId,
      readyState: mediaEl?.readyState ?? null,
      seeking: mediaEl?.seeking ?? null,
      selectionLength: roundSeconds(previewSelectionLength(trimState)),
      srcSet: Boolean(mediaEl?.currentSrc || mediaEl?.src),
      trimEndInput: trimState.endText,
      trimEndSeconds: roundSeconds(previewEndSeconds(trimState)),
      trimError: trimState.error,
      trimStartInput: trimState.startText,
      trimStartSeconds: roundSeconds(trimState.startSeconds ?? 0),
      videoHeight: mediaEl instanceof HTMLVideoElement ? mediaEl.videoHeight || null : null,
      videoWidth: mediaEl instanceof HTMLVideoElement ? mediaEl.videoWidth || null : null,
      volume: mediaEl?.volume ?? null,
    };
  }

  function logPreview(message, mediaEl = activePreviewMedia(), details) {
    const payload = details
      ? { ...previewDebugState(mediaEl), ...details }
      : previewDebugState(mediaEl);
    debugLog("preview", message, payload);
  }

  function isAudibleVideoPreview(mediaEl) {
    return mediaEl === trimVideoEl && !mediaEl.muted && mediaEl.volume > 0;
  }

  function restorePreviewAudioOutput(mediaEl, reason) {
    if (mediaEl !== trimVideoEl) return;
    mediaEl.muted = false;
    if (mediaEl.volume === 0) {
      mediaEl.volume = DEFAULT_PREVIEW_VOLUME;
    }
    logPreview("Restored video preview audio output", mediaEl, { reason });
  }

  function logVideoPreviewAudioPath(mediaEl, reason) {
    if (mediaEl !== trimVideoEl) return;
    logPreview("Video preview audio path", mediaEl, {
      audibleOutput: isAudibleVideoPreview(mediaEl),
      reason,
    });
  }

  function waitForMediaEvent(mediaEl, eventName, timeoutMs = 2000) {
    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        mediaEl.removeEventListener(eventName, handleEvent);
        window.clearTimeout(timeoutId);
      };

      const finish = (reason) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(reason);
      };

      const handleEvent = () => finish(eventName);
      const timeoutId = window.setTimeout(() => finish("timeout"), timeoutMs);

      mediaEl.addEventListener(eventName, handleEvent, { once: true });
    });
  }

  async function seekPreviewForPlayback(mediaEl, targetSeconds) {
    const currentSeconds = Number(mediaEl.currentTime) || 0;
    if (Math.abs(currentSeconds - targetSeconds) <= TRIM_STEP / 2) {
      const preSeekTarget = Math.max(0, targetSeconds - Math.max(TRIM_STEP, 0.05));
      if (Math.abs(preSeekTarget - targetSeconds) > 0.001) {
        logPreview("Forcing pre-seek before playback", mediaEl, {
          preSeekTarget: roundSeconds(preSeekTarget),
          targetSeconds: roundSeconds(targetSeconds),
        });
        mediaEl.currentTime = preSeekTarget;
        const preSeekResult = await waitForMediaEvent(mediaEl, "seeked");
        logPreview("Pre-seek finished before playback", mediaEl, {
          preSeekResult,
          preSeekTarget: roundSeconds(preSeekTarget),
        });
      }
    }

    logPreview("Waiting for seek before playback", mediaEl, {
      targetSeconds: roundSeconds(targetSeconds),
    });
    mediaEl.currentTime = targetSeconds;
    const seekResult = await waitForMediaEvent(mediaEl, "seeked");
    logPreview("Seek wait finished before playback", mediaEl, {
      seekResult,
      targetSeconds: roundSeconds(targetSeconds),
    });
  }

  function resetPlaybackWatch() {
    playbackWatchId += 1;
    lastTimeUpdateBucket = null;
  }

  function schedulePlaybackWatch(mediaEl, reason) {
    if (!mediaEl) return;

    playbackWatchId += 1;
    lastTimeUpdateBucket = null;
    const watchId = playbackWatchId;
    const startTime = Number(mediaEl.currentTime) || 0;

    const sample = (label) => {
      if (watchId !== playbackWatchId || mediaEl !== activePreviewMedia()) return;
      const elapsedSincePlay = (Number(mediaEl.currentTime) || 0) - startTime;
      logPreview(`Playback watch: ${label}`, mediaEl, {
        elapsedSincePlay: roundSeconds(elapsedSincePlay),
        reason,
      });
      if (
        label === "1000ms"
        && isAudibleVideoPreview(mediaEl)
        && !mediaEl.paused
        && elapsedSincePlay < 0.05
      ) {
        logPreview("Playback watch: audible output may be stalling media clock", mediaEl, {
          elapsedSincePlay: roundSeconds(elapsedSincePlay),
          reason,
          suggestedCheck: "Windows output device / Chrome app output",
        });
      }
    };

    window.setTimeout(() => sample("250ms"), 250);
    window.setTimeout(() => sample("1000ms"), 1000);

    if (mediaEl === trimVideoEl && typeof mediaEl.requestVideoFrameCallback === "function") {
      mediaEl.requestVideoFrameCallback((_, metadata) => {
        if (watchId !== playbackWatchId || mediaEl !== activePreviewMedia()) return;
        logPreview("Playback watch: video frame rendered", mediaEl, {
          mediaTime: roundSeconds(metadata?.mediaTime),
          presentedFrames: metadata?.presentedFrames ?? null,
          processingDuration: roundSeconds(metadata?.processingDuration),
          reason,
        });
      });
    }
  }

  function trimNudgeSeconds() {
    const metadata = currentPreviewItem()?.metadata;
    const fps = Number(metadata?.frameRate ?? metadata?.fps);
    if (Number.isFinite(fps) && fps > 0) {
      return Math.max(TRIM_STEP, 1 / fps);
    }

    return DEFAULT_FRAME_NUDGE_SECONDS;
  }

  function syncTrimNudgeButtons() {
    const stepText = formatClock(trimNudgeSeconds());
    trimJumpBackBtnEl.setAttribute("aria-label", "1フレーム戻る");
    trimJumpForwardBtnEl.setAttribute("aria-label", "1フレーム進む");
    trimJumpBackBtnEl.title = `${stepText} 戻る`;
    trimJumpForwardBtnEl.title = `${stepText} 進む`;
  }

  function getTrimState() {
    const startText = trimStartEl.value.trim();
    const endText = trimEndEl.value.trim();
    const parsedStart = parseTimecodeInput(startText);
    const parsedEnd = parseTimecodeInput(endText);

    if (Number.isNaN(parsedStart) || Number.isNaN(parsedEnd)) {
      return {
        endInvalid: Number.isNaN(parsedEnd),
        endSeconds: null,
        error: "開始と終了は 00:00:00 形式で入力してください。",
        hasTrim: Boolean(startText || endText),
        rangeInvalid: false,
        startInvalid: Number.isNaN(parsedStart),
        startSeconds: null,
        startText,
        endText,
      };
    }

    const maxSeconds = maxPreviewSeconds();
    const startSeconds = parsedStart === null || parsedStart <= TRIM_STEP ? 0 : parsedStart;
    let endSeconds = parsedEnd;

    if (Number.isFinite(endSeconds) && maxSeconds > 0) {
      endSeconds = clampPreviewSeconds(endSeconds, maxSeconds);
    }
    if (Number.isFinite(endSeconds) && maxSeconds > 0 && Math.abs(endSeconds - maxSeconds) <= TRIM_STEP) {
      endSeconds = null;
    }
    if (endSeconds !== null && endSeconds <= startSeconds) {
      return {
        endInvalid: false,
        endSeconds,
        error: "終了は開始より後の時間にしてください。",
        hasTrim: true,
        rangeInvalid: true,
        startInvalid: false,
        startSeconds,
        startText,
        endText,
      };
    }

    return {
      endInvalid: false,
      endSeconds,
      error: "",
      hasTrim: startSeconds > TRIM_STEP || endSeconds !== null,
      rangeInvalid: false,
      startInvalid: false,
      startSeconds,
      startText,
      endText,
    };
  }

  function getSettings() {
    const trimState = getTrimState();
    return {
      format: formatEl.value,
      videoCodec: videoCodecEl.value,
      audioCodec: audioCodecEl.value,
      quality: qualityEl.value,
      resolution: resolutionEl.value,
      parallelism: DEFAULT_PARALLELISM,
      trimStart: trimState.startText,
      trimEnd: trimState.endText,
      trimStartSeconds: trimState.startSeconds ?? 0,
      trimEndSeconds: trimState.endSeconds,
      trimError: trimState.error,
      hasTrim: trimState.hasTrim,
    };
  }

  function saveSettings() {
    const settings = getSettings();
    const payload = {
      outputFormat: settings.format,
      videoCodec: settings.videoCodec,
      audioCodec: settings.audioCodec,
      quality: settings.quality,
      resolution: settings.resolution,
      trimEnabled: isTrimEnabled,
      trimStart: settings.hasTrim ? settings.trimStart : "",
      trimEnd: settings.hasTrim ? settings.trimEnd : "",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function maxPreviewSeconds() {
    return Math.max(0, Number((previewDuration || 0).toFixed(3)));
  }

  function clampPreviewSeconds(value, fallback = 0) {
    const safeValue = Number.isFinite(value) ? value : fallback;
    const roundedValue = Math.round(safeValue / TRIM_STEP) * TRIM_STEP;
    return Math.max(0, Math.min(maxPreviewSeconds(), Number(roundedValue.toFixed(3))));
  }

  function trimGap(maxSeconds = maxPreviewSeconds()) {
    return maxSeconds > TRIM_STEP ? TRIM_STEP : 0;
  }

  function percentForSeconds(value) {
    const maxSeconds = maxPreviewSeconds();
    if (maxSeconds === 0) return 0;
    const clamped = Math.max(0, Math.min(maxSeconds, Number.isFinite(value) ? value : 0));
    return (clamped / maxSeconds) * 100;
  }

  function activePreviewMedia() {
    if (!trimVideoEl.classList.contains("hidden")) return trimVideoEl;
    if (!trimAudioEl.classList.contains("hidden")) return trimAudioEl;
    return null;
  }

  function previewEndSeconds(trimState = getTrimState()) {
    return trimState.endSeconds === null
      ? maxPreviewSeconds()
      : clampPreviewSeconds(trimState.endSeconds, maxPreviewSeconds());
  }

  function previewSelectionLength(trimState = getTrimState()) {
    return Math.max(0, previewEndSeconds(trimState) - clampPreviewSeconds(trimState.startSeconds ?? 0));
  }

  function isPreviewPlaying(mediaEl = activePreviewMedia()) {
    return Boolean(mediaEl && !mediaEl.paused && !mediaEl.ended);
  }

  function isCurrentTimeWithinTrim(mediaEl, trimState = getTrimState()) {
    if (!mediaEl) return false;
    const currentSeconds = Number(mediaEl.currentTime) || 0;
    const startSeconds = clampPreviewSeconds(trimState.startSeconds ?? 0);
    const endSeconds = previewEndSeconds(trimState);
    return currentSeconds >= startSeconds && currentSeconds < Math.max(startSeconds + TRIM_STEP, endSeconds);
  }

  function syncTrimPlayButton(mediaEl = activePreviewMedia()) {
    if (!trimPlaySelectionBtnEl || !trimPlaySelectionIconEl) return;

    const isPlaying = isPreviewPlaying(mediaEl);
    const actionTitle = isPlaying ? "選択区間を一時停止" : "選択区間を再生";

    trimPlaySelectionBtnEl.dataset.state = isPlaying ? "pause" : "play";
    trimPlaySelectionBtnEl.setAttribute("aria-label", actionTitle);
    trimPlaySelectionBtnEl.setAttribute("aria-pressed", String(isPlaying));
    trimPlaySelectionBtnEl.title = actionTitle;
    trimPlaySelectionIconEl.classList.toggle("trim-mini-icon-play", !isPlaying);
    trimPlaySelectionIconEl.classList.toggle("trim-mini-icon-pause", isPlaying);
  }

  function syncTrimActionButtons(trimState = getTrimState()) {
    const hasPreview = maxPreviewSeconds() > 0 && Boolean(activePreviewMedia());
    const hasClip = previewSelectionLength(trimState) > 0;
    const isPlaying = isPreviewPlaying();
    const nextPlayDisabled = !hasPreview || !hasClip;
    const nextState = JSON.stringify({
      error: trimState.error,
      hasClip,
      hasPreview,
      isPlaying,
      playDisabled: nextPlayDisabled,
    });

    if (lastTrimActionState !== nextState) {
      lastTrimActionState = nextState;
      logPreview("Trim action buttons updated", activePreviewMedia(), {
        hasClip,
        hasPreview,
        isPlaying,
        playButtonDisabled: nextPlayDisabled,
      });
    }

    syncTrimNudgeButtons();
    syncTrimPlayButton();
    trimSetStartBtnEl.disabled = !hasPreview;
    trimSeekStartBtnEl.disabled = !hasPreview;
    trimSetEndBtnEl.disabled = !hasPreview;
    trimSeekEndBtnEl.disabled = !hasPreview;
    trimPlaySelectionBtnEl.disabled = nextPlayDisabled;
    trimJumpBackBtnEl.disabled = !hasPreview;
    trimJumpForwardBtnEl.disabled = !hasPreview;
  }

  function syncTrimSummary(trimState = getTrimState()) {
    syncTrimActionButtons(trimState);
  }

  function clearMediaElement(mediaEl) {
    mediaEl.pause();
    mediaEl.removeAttribute("src");
    mediaEl.load();
    mediaEl.classList.add("hidden");
  }

  function revokePreviewUrl() {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }

  function seekPreview(seconds) {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    const nextTime = clampPreviewSeconds(seconds);
    logPreview("Seeking preview", mediaEl, {
      requestedSeconds: roundSeconds(seconds),
      seekTargetSeconds: roundSeconds(nextTime),
    });
    mediaEl.currentTime = nextTime;
    syncPreviewPosition(nextTime);
  }

  function applyTrimRange(startSeconds, endSeconds, { seekTo } = {}) {
    const maxSeconds = maxPreviewSeconds();
    const safeStart = clampPreviewSeconds(startSeconds ?? 0);
    let safeEnd = endSeconds === null ? null : clampPreviewSeconds(endSeconds, maxSeconds);

    if (safeEnd !== null && safeEnd <= safeStart) {
      safeEnd = Math.min(maxSeconds, safeStart + trimGap(maxSeconds));
    }
    if (safeEnd !== null && Math.abs(safeEnd - maxSeconds) <= TRIM_STEP) {
      safeEnd = null;
    }

    trimStartEl.value = formatClock(safeStart);
    trimEndEl.value = safeEnd === null ? "" : formatClock(safeEnd);

    logPreview("Applied trim range", activePreviewMedia(), {
      requestedEndSeconds: roundSeconds(endSeconds),
      requestedStartSeconds: roundSeconds(startSeconds),
      safeEndSeconds: roundSeconds(safeEnd ?? maxSeconds),
      safeStartSeconds: roundSeconds(safeStart),
      seekTo: roundSeconds(seekTo),
    });

    if (Number.isFinite(seekTo)) {
      seekPreview(seekTo);
    }

    handleChange("trim-start");
  }

  function syncPreviewPosition(forcedSeconds) {
    const mediaEl = activePreviewMedia();
    const currentSeconds = Number.isFinite(forcedSeconds)
      ? forcedSeconds
      : Number.isFinite(mediaEl?.currentTime)
        ? mediaEl.currentTime
        : 0;

    trimCurrentTimeEl.textContent = formatClock(currentSeconds);
    trimDurationEl.textContent = previewDuration > 0 ? formatClock(previewDuration) : "00:00:00";
    trimPlayheadEl.max = String(maxPreviewSeconds());
    trimPlayheadEl.value = String(clampPreviewSeconds(currentSeconds));
    trimPlayheadEl.disabled = maxPreviewSeconds() === 0;
    trimCurrentMarkerEl.style.left = `${percentForSeconds(currentSeconds)}%`;
    trimCurrentMarkerEl.classList.toggle("hidden", maxPreviewSeconds() === 0);
  }

  function syncTrimPreviewControls() {
    const trimState = getTrimState();
    const maxSeconds = maxPreviewSeconds();
    const minGap = trimGap(maxSeconds);
    const startMax = maxSeconds > 0 ? Math.max(0, maxSeconds - minGap) : 0;
    const startValue = Math.min(clampPreviewSeconds(trimState.startSeconds ?? 0), startMax);
    const endValue = trimState.endSeconds === null
      ? maxSeconds
      : clampPreviewSeconds(trimState.endSeconds, maxSeconds);
    const safeEndValue = maxSeconds > 0 ? Math.max(minGap || maxSeconds, endValue) : 0;

    trimPlayheadEl.min = "0";
    trimPlayheadEl.step = String(TRIM_STEP);
    const isDisabled = maxSeconds === 0;
    trimHandleStartEl.classList.toggle("is-disabled", isDisabled);
    trimHandleEndEl.classList.toggle("is-disabled", isDisabled);
    trimHandleStartEl.style.left = `${percentForSeconds(startValue)}%`;
    trimHandleEndEl.style.left = `${percentForSeconds(safeEndValue)}%`;
    trimHandleStartEl.setAttribute("aria-valuenow", String(startValue));
    trimHandleEndEl.setAttribute("aria-valuenow", String(safeEndValue));
    trimHandleStartEl.setAttribute("aria-valuemax", String(maxSeconds));
    trimHandleEndEl.setAttribute("aria-valuemax", String(maxSeconds));
    trimStartDisplayEl.textContent = formatClock(startValue);
    trimEndDisplayEl.textContent = trimState.endSeconds === null ? "最後まで" : formatClock(safeEndValue);
    trimSelectionFillEl.style.left = `${percentForSeconds(startValue)}%`;
    trimSelectionFillEl.style.width = `${Math.max(0, percentForSeconds(safeEndValue) - percentForSeconds(startValue))}%`;
    trimSelectionFillEl.classList.toggle("hidden", maxSeconds === 0);
    syncTrimSummary(trimState);
    syncPreviewPosition();
  }

  function syncTrimState() {
    const trimState = getTrimState();
    const hasError = Boolean(trimState.error);
    trimStartEl.classList.toggle("is-invalid", trimState.startInvalid || trimState.rangeInvalid);
    trimEndEl.classList.toggle("is-invalid", trimState.endInvalid || trimState.rangeInvalid);
    trimErrorEl.textContent = trimState.error;
    trimErrorEl.classList.toggle("hidden", !hasError);
    if (trimDisclosureEl) {
      const shouldOpen = trimState.hasTrim || hasError;
      if (shouldOpen) {
        trimDisclosureEl.open = true;
      }
    }
    if (trimToggleChipEl) {
      const chipLabel = trimState.hasTrim
        ? "範囲あり"
        : trimDisclosureEl?.open
          ? "表示中"
          : "オフ";
      trimToggleChipEl.textContent = chipLabel;
      trimToggleChipEl.classList.toggle("is-active", Boolean(trimState.hasTrim || trimDisclosureEl?.open));
    }
    syncTrimPreviewControls();
  }

  function syncCodecOptions(preferredVideo, preferredAudio) {
    const fmt = formatEl.value;
    const compat = FORMAT_CODEC_COMPAT[fmt] || { video: [], audio: [] };

    const videoValues = ["auto", ...compat.video];
    const audioValues = ["auto", ...compat.audio];
    populateSelect(videoCodecEl, videoValues, preferredVideo ?? videoCodecEl.value);
    populateSelect(audioCodecEl, audioValues, preferredAudio ?? audioCodecEl.value);
  }

  function markTrimUsed() {
    if (isTrimEnabled) return;
    isTrimEnabled = true;
    updateVisibility();
    saveSettings();
  }

  function updateVisibility(trimState = getTrimState()) {
    const fmt = formatEl.value;
    const isAudio = AUDIO_FORMATS.has(fmt);
    const isGif = fmt === "gif";

    advancedSettingsEl.classList.toggle("hidden", !isAdvancedMode);
    advancedToggleEl.classList.toggle("is-active", isAdvancedMode);
    advancedToggleEl.setAttribute("aria-expanded", String(isAdvancedMode));
    parallelismGroupEl?.classList.add("hidden");
    if (parallelismEl) {
      parallelismEl.value = String(DEFAULT_PARALLELISM);
      parallelismEl.disabled = true;
    }
    trimGroupEl?.classList.remove("hidden");
    $("#video-settings").classList.toggle("hidden", isAudio || isGif);
    $("#resolution-group").classList.toggle("hidden", isAudio);
    $("#quality-group").classList.toggle("hidden", isGif);
    $("#audio-codec-group").classList.toggle("hidden", isGif);
  }

  function setAdvancedMode(nextValue, { silent = false } = {}) {
    isAdvancedMode = Boolean(nextValue);
    updateVisibility();

    if (silent) return;
    saveSettings();
    notifyChange();
  }

  function notifyChange() {
    if (typeof onChange === "function") {
      onChange(getSettings());
    }
  }

  function clearPreview() {
    debugLog("preview", "Clearing preview", {
      previewItemCount: previewItems.length,
      previewItemId,
    });
    resetPlaybackWatch();
    stopSelectionDrag();
    stopHandleDrag();
    waveformRequestId += 1;
    trimWaveformEl.classList.remove("is-loading");
    drawWaveform();
    clearMediaElement(trimVideoEl);
    clearMediaElement(trimAudioEl);
    revokePreviewUrl();
    previewDuration = 0;
    previewItemId = null;
    previewItems = [];
    trimPreviewFileEl.innerHTML = "";
    trimPreviewPickerEl.classList.add("hidden");
    trimPreviewEl.classList.add("hidden");
    trimPreviewEl.classList.remove("is-audio-only");
    syncTrimPreviewControls();
  }

  function populatePreviewOptions() {
    trimPreviewFileEl.innerHTML = "";
    for (const item of previewItems) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = item.file.name;
      trimPreviewFileEl.append(option);
    }
  }

  function loadPreviewItemById(id) {
    const item = previewItems.find((entry) => entry.id === id);
    if (!item) {
      debugLog("preview", "Preview item not found", {
        availableIds: previewItems.map((entry) => entry.id),
        requestedId: id,
      });
      clearPreview();
      return;
    }

    previewItemId = item.id;
    previewDuration = Number.isFinite(item.metadata?.duration) ? item.metadata.duration : 0;
    resetPlaybackWatch();
    clearMediaElement(trimVideoEl);
    clearMediaElement(trimAudioEl);
    revokePreviewUrl();

    const kind = mediaKind(item);
    const mediaEl = kind === "video" ? trimVideoEl : trimAudioEl;
    previewUrl = URL.createObjectURL(item.file);
    restorePreviewAudioOutput(mediaEl, "load-preview-item");
    logVideoPreviewAudioPath(mediaEl, "load-preview-item");
    debugLog("preview", "Loading preview item", {
      fileName: item.file.name,
      fileType: item.file.type,
      mediaKind: kind,
      metadataDuration: roundSeconds(item.metadata?.duration),
      previewItemId: item.id,
      size: item.file.size,
    });
    mediaEl.classList.remove("hidden");
    mediaEl.src = previewUrl;
    mediaEl.load();

    trimPreviewEl.classList.remove("hidden");
    trimPreviewEl.classList.toggle("is-audio-only", kind === "audio");
    trimPreviewFileEl.value = String(item.id);
    syncTrimState();
    loadWaveform(item);
  }

  function syncPreviewItems(items) {
    previewItems = items.filter((item) => item?.file);
    debugLog("preview", "Syncing preview items", {
      nextPreviewItemCount: previewItems.length,
      previewItemId,
      queueItemIds: previewItems.map((item) => item.id),
    });
    if (!previewItems.length) {
      clearPreview();
      return;
    }

    populatePreviewOptions();
    trimPreviewPickerEl.classList.toggle("hidden", previewItems.length < 2);
    trimPreviewEl.classList.remove("hidden");

    const nextPreviewId = previewItems.some((item) => item.id === previewItemId)
      ? previewItemId
      : previewItems[0].id;

    if (previewItemId !== nextPreviewId || !previewUrl) {
      loadPreviewItemById(nextPreviewId);
      return;
    }

    trimPreviewFileEl.value = String(nextPreviewId);
    const currentItem = previewItems.find((item) => item.id === nextPreviewId);
    if (Number.isFinite(currentItem?.metadata?.duration)) {
      previewDuration = currentItem.metadata.duration;
    }
    syncTrimState();
  }

  function loadSettings() {
    trimEndEl.placeholder = "最後まで";
    resetTrimInputs();
    if (parallelismEl) {
      parallelismEl.value = String(DEFAULT_PARALLELISM);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      isTrimEnabled = false;
      syncCodecOptions();
      syncTrimState();
      setAdvancedMode(false, { silent: true });
      return;
    }

    try {
      const saved = JSON.parse(raw);
      ignoreEvents = true;

      if (saved.outputFormat && FORMAT_DEFAULTS[saved.outputFormat]) {
        formatEl.value = saved.outputFormat;
      }
      isAdvancedMode = false;
      isTrimEnabled = Boolean(saved.trimEnabled || hasSavedTrimValues(saved));

      syncCodecOptions(saved.videoCodec, saved.audioCodec);
      syncFormatCards();

      if (saved.quality && QUALITY_MAP[saved.quality]) {
        qualityEl.value = saved.quality;
      }
      if (saved.resolution) {
        resolutionEl.value = saved.resolution;
      }
      if (typeof saved.trimStart === "string" && saved.trimStart.trim()) {
        trimStartEl.value = saved.trimStart;
      }
      if (typeof saved.trimEnd === "string") {
        trimEndEl.value = saved.trimEnd;
      }
      ignoreEvents = false;
      syncTrimState();
      setAdvancedMode(isAdvancedMode, { silent: true });
    } catch {
      ignoreEvents = false;
      isTrimEnabled = false;
      resetTrimInputs();
      syncCodecOptions();
      syncFormatCards();
      syncTrimState();
      setAdvancedMode(false, { silent: true });
    }
  }

  function handleChange(sourceId) {
    if (ignoreEvents) return;

    if (sourceId === "output-format") {
      syncFormatCards();
      syncCodecOptions();
    }
    if (sourceId.startsWith("trim-")) {
      markTrimUsed();
    }

    syncTrimState();
    updateVisibility(getTrimState());
    saveSettings();
    notifyChange();
  }

  function handlePreviewLoadedMetadata(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl || mediaEl !== activePreviewMedia()) return;

    previewDuration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;
    logPreview("Media event: loadedmetadata", mediaEl);
    syncTrimState();

    const startSeconds = clampPreviewSeconds(getTrimState().startSeconds ?? 0);
    if (startSeconds > 0) {
      logPreview("Seeking to trim start after metadata load", mediaEl, {
        seekTargetSeconds: roundSeconds(startSeconds),
      });
      mediaEl.currentTime = Math.min(startSeconds, mediaEl.duration || startSeconds);
    } else {
      syncPreviewPosition(0);
    }
  }

  function handlePreviewTimeUpdate(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl || mediaEl !== activePreviewMedia()) return;

    const currentBucket = Math.floor((Number(mediaEl.currentTime) || 0) * 2) / 2;
    if (lastTimeUpdateBucket !== currentBucket) {
      lastTimeUpdateBucket = currentBucket;
      logPreview("Media event: timeupdate", mediaEl);
    }

    const trimState = getTrimState();
    if (trimState.endSeconds !== null && mediaEl.currentTime >= trimState.endSeconds) {
      logPreview("Reached trim end during playback", mediaEl, {
        pauseAtSeconds: roundSeconds(trimState.endSeconds),
      });
      mediaEl.currentTime = trimState.endSeconds;
      mediaEl.pause();
    }

    syncPreviewPosition();
  }

  function handlePreviewPlay(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl || mediaEl !== activePreviewMedia()) return;

    logVideoPreviewAudioPath(mediaEl, "media-event-play");
    logPreview("Media event: play", mediaEl);
    const trimState = getTrimState();
    const startSeconds = clampPreviewSeconds(trimState.startSeconds ?? 0);
    const endSeconds = previewEndSeconds(trimState);

    if (mediaEl.currentTime < startSeconds || mediaEl.currentTime >= Math.max(startSeconds, endSeconds - TRIM_STEP)) {
      logPreview("Adjusting playhead to trim start on play", mediaEl, {
        seekTargetSeconds: roundSeconds(startSeconds),
      });
      mediaEl.currentTime = startSeconds;
    }
    syncTrimActionButtons();
  }

  function handlePreviewPause(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl || mediaEl !== activePreviewMedia()) return;
    logPreview("Media event: pause", mediaEl);
    syncPreviewPosition();
    syncTrimActionButtons();
  }

  function handlePreviewSeeked(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl || mediaEl !== activePreviewMedia()) return;
    logPreview("Media event: seeked", mediaEl);
    syncPreviewPosition();
  }

  function handlePreviewPassiveEvent(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl) return;
    logPreview(`Media event: ${event.type}`, mediaEl);
  }

  function handlePreviewError(event) {
    const mediaEl = previewMediaFromEvent(event);
    if (!mediaEl) return;
    debugError(
      "preview",
      "Media event: error",
      mediaErrorCode(mediaEl.error) || "Unknown media element error",
      previewDebugState(mediaEl),
    );
  }

  function handlePlayheadInput() {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    markTrimUsed();
    const nextTime = Number(trimPlayheadEl.value) || 0;
    seekPreview(nextTime);
  }

  function stopHandleDrag() {
    if (!handleDrag) return;
    window.removeEventListener("pointermove", handleHandleDragMove);
    window.removeEventListener("pointerup", stopHandleDrag);
    window.removeEventListener("pointercancel", stopHandleDrag);
    handleDrag.el.classList.remove("is-dragging");
    handleDrag = null;
  }

  function handleHandleDragMove(event) {
    if (!handleDrag) return;
    const rect = trimSelectionSliderEl.getBoundingClientRect();
    if (!rect.width) return;

    const deltaRatio = (event.clientX - handleDrag.originX) / rect.width;
    const rawValue = clampPreviewSeconds(handleDrag.originValue + deltaRatio * handleDrag.maxSeconds);
    const trimState = getTrimState();

    if (handleDrag.which === "start") {
      const nextEnd = trimState.endSeconds !== null && trimState.endSeconds <= rawValue
        ? Math.min(handleDrag.maxSeconds, rawValue + trimGap())
        : trimState.endSeconds;
      applyTrimRange(rawValue, nextEnd, { seekTo: rawValue });
    } else {
      const atEnd = rawValue >= handleDrag.maxSeconds - trimGap();
      const endSeconds = atEnd ? null : rawValue;
      const nextStart = (trimState.startSeconds ?? 0) >= (endSeconds ?? handleDrag.maxSeconds)
        ? Math.max(0, (endSeconds ?? handleDrag.maxSeconds) - trimGap())
        : trimState.startSeconds ?? 0;
      applyTrimRange(nextStart, endSeconds, { seekTo: atEnd ? handleDrag.maxSeconds : rawValue });
    }
  }

  function startHandleDrag(event, which) {
    if (maxPreviewSeconds() === 0) return;
    event.preventDefault();
    event.stopPropagation();

    const trimState = getTrimState();
    const originValue = which === "start"
      ? clampPreviewSeconds(trimState.startSeconds ?? 0)
      : previewEndSeconds(trimState);
    const el = which === "start" ? trimHandleStartEl : trimHandleEndEl;
    el.classList.add("is-dragging");

    handleDrag = { el, maxSeconds: maxPreviewSeconds(), originValue, originX: event.clientX, which };
    window.addEventListener("pointermove", handleHandleDragMove);
    window.addEventListener("pointerup", stopHandleDrag);
    window.addEventListener("pointercancel", stopHandleDrag);
  }

  function handleTrimReset() {
    applyTrimRange(0, null, { seekTo: 0 });
  }

  function setTrimFromCurrent(which) {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    const currentSeconds = clampPreviewSeconds(mediaEl.currentTime || 0);
    const trimState = getTrimState();
    if (which === "start") {
      applyTrimRange(currentSeconds, trimState.endSeconds, { seekTo: currentSeconds });
      return;
    }

    applyTrimRange(trimState.startSeconds ?? 0, currentSeconds, { seekTo: currentSeconds });
  }

  function seekToTrimStart() {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    const startSeconds = clampPreviewSeconds(getTrimState().startSeconds ?? 0);
    seekPreview(startSeconds);
  }

  function seekToTrimEnd() {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    seekPreview(previewEndSeconds());
  }

  async function resumeSelectionPlayback(mediaEl) {
    if (!mediaEl) return;

    logPreview("Resuming selection playback from current position", mediaEl);
    logVideoPreviewAudioPath(mediaEl, "resume-selection");
    mediaEl.defaultPlaybackRate = 1;
    mediaEl.playbackRate = 1;
    try {
      await mediaEl.play();
      logPreview("mediaEl.play() resolved", mediaEl, {
        resumedFromCurrentPosition: true,
      });
      schedulePlaybackWatch(mediaEl, "trim-resume-selection");
    } catch (error) {
      debugError("preview", "mediaEl.play() rejected", error, previewDebugState(mediaEl));
    }
  }

  async function playSelection() {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) {
      debugLog("preview", "Play selection requested without active media");
      return;
    }

    markTrimUsed();
    const trimState = getTrimState();
    const startSeconds = clampPreviewSeconds(trimState.startSeconds ?? 0);
    logPreview("Play selection requested", mediaEl, {
      requestedStartSeconds: roundSeconds(startSeconds),
    });
    mediaEl.pause();
    logVideoPreviewAudioPath(mediaEl, "play-selection");
    mediaEl.defaultPlaybackRate = 1;
    mediaEl.playbackRate = 1;
    syncPreviewPosition(startSeconds);
    await seekPreviewForPlayback(mediaEl, startSeconds);
    syncPreviewPosition(startSeconds);
    try {
      await mediaEl.play();
      logPreview("mediaEl.play() resolved", mediaEl);
      schedulePlaybackWatch(mediaEl, "trim-play-selection");
    } catch (error) {
      debugError("preview", "mediaEl.play() rejected", error, previewDebugState(mediaEl));
    }
  }

  function handlePlaySelectionButtonClick() {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    if (isPreviewPlaying(mediaEl)) {
      mediaEl.pause();
      return;
    }

    if (isCurrentTimeWithinTrim(mediaEl)) {
      resumeSelectionPlayback(mediaEl);
      return;
    }

    playSelection();
  }

  function nudgePreview(direction) {
    const mediaEl = activePreviewMedia();
    if (!mediaEl) return;

    markTrimUsed();
    seekPreview((mediaEl.currentTime || 0) + (trimNudgeSeconds() * direction));
  }

  function sliderSecondsFromClientX(clientX) {
    const rect = trimSelectionSliderEl.getBoundingClientRect();
    if (!rect.width) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return clampPreviewSeconds(ratio * maxPreviewSeconds());
  }

  function stopSelectionDrag() {
    if (!selectionDrag) return;
    window.removeEventListener("pointermove", handleSelectionDragMove);
    window.removeEventListener("pointerup", stopSelectionDrag);
    window.removeEventListener("pointercancel", stopSelectionDrag);
    trimSelectionFillEl.classList.remove("is-dragging");
    selectionDrag = null;
  }

  function handleSelectionDragMove(event) {
    if (!selectionDrag) return;

    const rect = trimSelectionSliderEl.getBoundingClientRect();
    if (!rect.width) return;

    const deltaRatio = (event.clientX - selectionDrag.originX) / rect.width;
    const deltaSeconds = deltaRatio * selectionDrag.maxSeconds;
    const nextStart = Math.max(0, Math.min(selectionDrag.maxSeconds - selectionDrag.span, selectionDrag.start + deltaSeconds));
    const nextEnd = nextStart + selectionDrag.span;

    applyTrimRange(nextStart, nextEnd, { seekTo: nextStart });
  }

  function startSelectionDrag(event) {
    if (maxPreviewSeconds() === 0) return;

    const trimState = getTrimState();
    const startSeconds = clampPreviewSeconds(trimState.startSeconds ?? 0);
    const endSeconds = previewEndSeconds(trimState);
    const span = Math.max(0, endSeconds - startSeconds);

    if (span <= 0 || span >= maxPreviewSeconds()) return;

    markTrimUsed();
    event.preventDefault();
    selectionDrag = {
      end: endSeconds,
      maxSeconds: maxPreviewSeconds(),
      originX: event.clientX,
      span,
      start: startSeconds,
    };
    trimSelectionFillEl.classList.add("is-dragging");
    window.addEventListener("pointermove", handleSelectionDragMove);
    window.addEventListener("pointerup", stopSelectionDrag);
    window.addEventListener("pointercancel", stopSelectionDrag);
  }

  function handleTrimSliderPointerDown(event) {
    if (maxPreviewSeconds() === 0) return;
    if (event.target === trimSelectionFillEl) {
      startSelectionDrag(event);
      return;
    }
    if (event.target.closest("input")) return;
    markTrimUsed();
    seekPreview(sliderSecondsFromClientX(event.clientX));
  }

  function bindEvents() {
    const settingIds = ["output-format", "video-codec", "audio-codec", "quality", "resolution"];
    for (const id of settingIds) {
      $(`#${id}`).addEventListener("change", () => handleChange(id));
    }

    for (const id of ["trim-start", "trim-end"]) {
      $(`#${id}`).addEventListener("input", () => handleChange(id));
      $(`#${id}`).addEventListener("change", () => handleChange(id));
    }

    formatCardsEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-format-value]");
      if (!button) return;
      const nextValue = button.dataset.formatValue;
      if (!nextValue || formatEl.value === nextValue) return;
      formatEl.value = nextValue;
      handleChange("output-format");
    });

    advancedToggleEl.addEventListener("click", () => {
      setAdvancedMode(!isAdvancedMode);
    });

    trimDisclosureEl?.addEventListener("toggle", () => {
      syncTrimState();
    });

    trimPreviewFileEl.addEventListener("change", () => {
      markTrimUsed();
      debugLog("preview", "Preview file picker changed", {
        selectedId: Number(trimPreviewFileEl.value),
      });
      loadPreviewItemById(Number(trimPreviewFileEl.value));
    });

    trimPlayheadEl.addEventListener("input", handlePlayheadInput);
    trimHandleStartEl.addEventListener("pointerdown", (e) => startHandleDrag(e, "start"));
    trimHandleEndEl.addEventListener("pointerdown", (e) => startHandleDrag(e, "end"));
    trimSelectionSliderEl.addEventListener("pointerdown", handleTrimSliderPointerDown);
    trimSetStartBtnEl.addEventListener("click", () => setTrimFromCurrent("start"));
    trimSeekStartBtnEl.addEventListener("click", seekToTrimStart);
    trimSetEndBtnEl.addEventListener("click", () => setTrimFromCurrent("end"));
    trimSeekEndBtnEl.addEventListener("click", seekToTrimEnd);
    trimPlaySelectionBtnEl.addEventListener("click", handlePlaySelectionButtonClick);
    trimResetBtnEl.addEventListener("click", handleTrimReset);
    trimJumpBackBtnEl.addEventListener("click", () => nudgePreview(-1));
    trimJumpForwardBtnEl.addEventListener("click", () => nudgePreview(1));

    for (const mediaEl of [trimVideoEl, trimAudioEl]) {
      mediaEl.addEventListener("loadstart", handlePreviewPassiveEvent);
      mediaEl.addEventListener("loadeddata", handlePreviewPassiveEvent);
      mediaEl.addEventListener("loadedmetadata", handlePreviewLoadedMetadata);
      mediaEl.addEventListener("canplay", handlePreviewPassiveEvent);
      mediaEl.addEventListener("canplaythrough", handlePreviewPassiveEvent);
      mediaEl.addEventListener("durationchange", handlePreviewPassiveEvent);
      mediaEl.addEventListener("emptied", handlePreviewPassiveEvent);
      mediaEl.addEventListener("ended", handlePreviewPassiveEvent);
      mediaEl.addEventListener("error", handlePreviewError);
      mediaEl.addEventListener("timeupdate", handlePreviewTimeUpdate);
      mediaEl.addEventListener("play", handlePreviewPlay);
      mediaEl.addEventListener("playing", handlePreviewPassiveEvent);
      mediaEl.addEventListener("pause", handlePreviewPause);
      mediaEl.addEventListener("seeking", handlePreviewPassiveEvent);
      mediaEl.addEventListener("seeked", handlePreviewSeeked);
      mediaEl.addEventListener("stalled", handlePreviewPassiveEvent);
      mediaEl.addEventListener("suspend", handlePreviewPassiveEvent);
      mediaEl.addEventListener("waiting", handlePreviewPassiveEvent);
    }

    if (typeof ResizeObserver === "function") {
      waveformResizeObserver = new ResizeObserver(() => redrawWaveform());
      waveformResizeObserver.observe(trimSelectionSliderEl);
    } else {
      window.addEventListener("resize", redrawWaveform);
    }
  }

  function init() {
    populateOutputFormats();
    loadSettings();
    syncFormatCards();
    syncTrimState();
    setAdvancedMode(isAdvancedMode, { silent: true });
    bindEvents();
  }

  function applyItemConfig(config) {
    if (!config) return;
    ignoreEvents = true;
    if (formatEl && config.format) formatEl.value = config.format;
    syncCodecOptions(config.videoCodec, config.audioCodec);
    if (qualityEl && config.quality) qualityEl.value = config.quality;
    if (resolutionEl && config.resolution) resolutionEl.value = config.resolution;
    trimStartEl.value = config.trimStart ?? "";
    trimEndEl.value = config.trimEnd ?? "";
    isTrimEnabled = Boolean(config.hasTrim || config.trimStart || config.trimEnd);
    ignoreEvents = false;
    syncFormatCards();
    syncTrimState();
    updateVisibility();
  }

  function setPreviewFocus(itemId) {
    const item = previewItems.find((i) => i.id === itemId);
    if (!item) return;
    if (previewItemId === itemId && previewUrl) return;
    loadPreviewItemById(itemId);
  }

  return {
    applyItemConfig,
    getSettings,
    init,
    setPreviewFocus,
    syncCodecOptions,
    syncPreviewItems,
    updateVisibility,
  };
}
