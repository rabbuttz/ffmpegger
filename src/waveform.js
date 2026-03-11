import { debugError, debugLog } from "./debug.js";
import { getExtension } from "./utils.js";

const DEFAULT_PEAK_COUNT = 512;
const SAMPLE_RATE = 4000;
const SILENCE = [];

function safeDelete(ffmpeg, path) {
  return ffmpeg.deleteFile(path).catch(() => {});
}

function normalizePeaks(samples, peakCount) {
  if (!samples.length || peakCount <= 0) return SILENCE;

  const blockSize = Math.max(1, Math.ceil(samples.length / peakCount));
  const peaks = [];

  for (let offset = 0; offset < samples.length; offset += blockSize) {
    let max = 0;
    const limit = Math.min(samples.length, offset + blockSize);

    for (let index = offset; index < limit; index += 1) {
      const amplitude = Math.abs(samples[index]) / 32768;
      if (amplitude > max) max = amplitude;
    }

    peaks.push(Number(max.toFixed(4)));
  }

  return peaks;
}

function audioMissingError(error) {
  const message = String(error?.message || error || "");
  return /stream map .* matches no streams|output file .* does not contain any stream|matches no streams|does not contain any stream/i.test(message);
}

export function createWaveformSampler() {
  let ffmpeg = null;
  let fetchFile = null;
  let initPromise = null;
  let nextJob = Promise.resolve();
  let requestId = 0;

  async function init() {
    if (ffmpeg) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      debugLog("waveform", "Loading waveform sampler");
      const [{ FFmpeg }, util] = await Promise.all([
        import("/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js"),
        import("/node_modules/@ffmpeg/util/dist/esm/index.js"),
      ]);

      fetchFile = util.fetchFile;
      const instance = new FFmpeg();

      await instance.load({
        coreURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
        wasmURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
        classWorkerURL: "/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js",
      });

      ffmpeg = instance;
      debugLog("waveform", "Waveform sampler ready");
    })().finally(() => {
      initPromise = null;
    });

    return initPromise;
  }

  function queue(task) {
    const pending = nextJob.then(task, task);
    nextJob = pending.catch(() => {});
    return pending;
  }

  async function extractPeaks(file, peakCount = DEFAULT_PEAK_COUNT) {
    return queue(async () => {
      await init();

      requestId += 1;
      const inputExt = getExtension(file.name);
      const inputName = inputExt ? `waveform_input_${requestId}.${inputExt}` : `waveform_input_${requestId}`;
      const outputName = `waveform_output_${requestId}.raw`;

      try {
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        await ffmpeg.exec([
          "-i", inputName,
          "-map", "a:0",
          "-vn",
          "-ac", "1",
          "-ar", String(SAMPLE_RATE),
          "-f", "s16le",
          outputName,
        ]);

        const data = await ffmpeg.readFile(outputName);
        const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const samples = new Int16Array(bytes);
        return normalizePeaks(samples, peakCount);
      } catch (error) {
        if (audioMissingError(error)) return SILENCE;
        debugError("waveform", "Failed to extract waveform peaks", error, {
          fileName: file.name,
          peakCount,
        });
        throw error;
      } finally {
        await Promise.all([
          safeDelete(ffmpeg, inputName),
          safeDelete(ffmpeg, outputName),
        ]);
      }
    });
  }

  return {
    extractPeaks,
    init,
  };
}
