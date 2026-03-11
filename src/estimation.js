import { AUDIO_FORMATS } from "./constants.js";
import { formatClock, formatDuration, formatSize } from "./utils.js";

function parseResolution(value) {
  if (!value || value === "original") return null;
  const [w, h] = value.split(":").map((v) => Number(v));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

function getTrimDuration(item, settings) {
  if (!settings.hasTrim || !Number.isFinite(item.metadata?.duration)) return null;

  const sourceDuration = item.metadata.duration;
  const start = Math.max(0, Number(settings.trimStartSeconds) || 0);
  const end = Number.isFinite(settings.trimEndSeconds) ? settings.trimEndSeconds : sourceDuration;
  const clippedStart = Math.min(start, sourceDuration);
  const clippedEnd = Math.min(Math.max(clippedStart, end), sourceDuration);
  return Math.max(0, clippedEnd - clippedStart);
}

function estimateOutputSize(item, settings) {
  const input = item.file.size;
  const quality = settings.quality;
  const resolution = parseResolution(settings.resolution);
  const isAudioOutput = AUDIO_FORMATS.has(settings.format);

  let ratio = 0.6;

  if (settings.format === "gif") {
    ratio = quality === "high" ? 0.75 : quality === "medium" ? 0.5 : 0.35;
  } else if (isAudioOutput) {
    const audioRatio = {
      mp3: 0.12,
      aac: 0.1,
      wav: 0.6,
      ogg: 0.12,
      flac: 0.45,
      opus: 0.09,
    };
    ratio = audioRatio[settings.format] || 0.12;
  } else {
    ratio = quality === "high" ? 0.85 : quality === "medium" ? 0.62 : 0.4;
    if (resolution && item.metadata?.width && item.metadata?.height) {
      const sourcePixels = item.metadata.width * item.metadata.height;
      const targetPixels = resolution.w * resolution.h;
      const scaleRatio = Math.max(0.2, Math.min(1.2, targetPixels / sourcePixels));
      ratio *= scaleRatio;
    }
  }

  const trimDuration = getTrimDuration(item, settings);
  if (trimDuration !== null && Number.isFinite(item.metadata?.duration) && item.metadata.duration > 0) {
    ratio *= Math.max(0.02, trimDuration / item.metadata.duration);
  }

  return Math.max(1, Math.round(input * ratio));
}

function estimateProcessingSeconds(item, settings) {
  const hasDuration = Number.isFinite(item.metadata?.duration);
  const isAudioOutput = AUDIO_FORMATS.has(settings.format);
  const isGif = settings.format === "gif";
  const quality = settings.quality;
  const trimDuration = getTrimDuration(item, settings);

  if (hasDuration) {
    const duration = trimDuration ?? item.metadata.duration;
    let factor = quality === "high" ? 1.9 : quality === "medium" ? 1.3 : 0.95;
    if (isAudioOutput) factor *= 0.5;
    if (isGif) factor *= 1.5;

    const resolution = parseResolution(settings.resolution);
    if (resolution && item.metadata?.width && item.metadata?.height) {
      const sourcePixels = item.metadata.width * item.metadata.height;
      const targetPixels = resolution.w * resolution.h;
      const speedAdjust = Math.max(0.6, Math.min(1.4, targetPixels / sourcePixels));
      factor *= speedAdjust;
    }

    return Math.max(3, Math.round(duration * factor));
  }

  return Math.max(3, Math.round(item.file.size / (1024 * 1024) * 0.75));
}

export function buildEstimate(queue, settings) {
  if (!queue.length) {
    return {
      lines: ["見積もりはファイル追加後に表示されます。"],
      warning: false,
    };
  }

  if (settings.trimError) {
    return {
      lines: [settings.trimError],
      warning: true,
    };
  }

  const targets = queue.filter((item) => item.status !== "done");
  if (!targets.length) {
    return {
      lines: [],
      warning: false,
    };
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalSeconds = 0;
  let largestFile = 0;
  const parallelism = Math.max(1, Number(settings.parallelism) || 1);

  for (const item of targets) {
    totalInput += item.file.size;
    totalOutput += estimateOutputSize(item, settings);
    totalSeconds += estimateProcessingSeconds(item, settings);
    if (item.file.size > largestFile) largestFile = item.file.size;
  }

  const low = Math.max(1, Math.round(totalOutput * 0.7));
  const high = Math.max(low + 1, Math.round(totalOutput * 1.3));
  const effectiveParallelism = parallelism === 1 ? 1 : 1 + ((parallelism - 1) * 0.75);
  const estimatedWallTime = Math.max(1, Math.round(totalSeconds / effectiveParallelism));
  const lines = [
    `対象: ${targets.length}ファイル / 入力合計 ${formatSize(totalInput)}`,
    `出力見積: 約 ${formatSize(low)} - ${formatSize(high)}`,
    `処理時間見積: 約 ${formatDuration(estimatedWallTime)}`,
    `同時変換: ${parallelism}本`,
  ];

  if (settings.hasTrim) {
    const startText = formatClock(settings.trimStartSeconds || 0);
    const endText = Number.isFinite(settings.trimEndSeconds) ? formatClock(settings.trimEndSeconds) : "最後まで";
    lines.push(`トリミング: ${startText} - ${endText}`);
  }

  const warning = largestFile > 350 * 1024 * 1024;
  if (warning) {
    lines.push("大きいファイルはメモリ不足で失敗する場合があります。");
  }

  return { lines, warning };
}
