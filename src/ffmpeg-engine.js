import { AUDIO_FORMATS, FORMAT_DEFAULTS, QUALITY_MAP } from "./constants.js";
import { debugError, debugLog } from "./debug.js";
import { getExtension, getMimeType, stripExtension } from "./utils.js";

function buildTrimArgs(settings) {
  const preInputArgs = [];
  const postInputArgs = [];
  const start = Math.max(0, Number(settings.trimStartSeconds) || 0);
  const end = Number.isFinite(settings.trimEndSeconds) ? settings.trimEndSeconds : null;

  if (start > 0) {
    preInputArgs.push("-ss", String(start));
  }
  if (end !== null) {
    const duration = Math.max(0, end - start);
    postInputArgs.push("-t", String(duration));
  }

  return { postInputArgs, preInputArgs };
}

function buildArgs(settings, inputName, outputName) {
  const fmt = settings.format;
  const isAudio = AUDIO_FORMATS.has(fmt);
  const quality = QUALITY_MAP[settings.quality] || QUALITY_MAP.medium;
  const defaults = FORMAT_DEFAULTS[fmt];
  const { postInputArgs, preInputArgs } = buildTrimArgs(settings);
  const args = [...preInputArgs, "-i", inputName, ...postInputArgs];

  if (fmt === "gif") {
    const scaleExpr = settings.resolution !== "original"
      ? `scale=${settings.resolution}:flags=lanczos`
      : "scale='min(iw,640):-1':flags=lanczos";
    const filter = `${scaleExpr},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    args.push("-vf", filter, "-loop", "0");
  } else if (isAudio) {
    const acodec = settings.audioCodec !== "auto" ? settings.audioCodec : defaults.acodec;
    args.push("-vn");
    if (acodec) {
      args.push("-c:a", acodec);
      if (!["pcm_s16le", "flac"].includes(acodec)) {
        args.push("-b:a", quality.ab);
      }
    }
  } else {
    const vcodec = settings.videoCodec !== "auto" ? settings.videoCodec : defaults.vcodec;
    const acodec = settings.audioCodec !== "auto" ? settings.audioCodec : defaults.acodec;

    if (vcodec) args.push("-c:v", vcodec, "-crf", quality.crf);
    if (acodec) {
      args.push("-c:a", acodec);
      if (acodec !== "pcm_s16le") args.push("-b:a", quality.ab);
    }
    if (settings.resolution !== "original") {
      args.push("-vf", `scale=${settings.resolution}`);
    }
    if (fmt === "mp4" || fmt === "mov") {
      args.push("-movflags", "+faststart");
    }
  }

  args.push(outputName);
  return args;
}

async function safeDelete(ffmpeg, path) {
  if (!ffmpeg) return;
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Best effort cleanup.
  }
}

export function readFriendlyError(err) {
  const message = String(err?.message || err || "");
  if (/memory|out of memory|ENOMEM|allocation/i.test(message)) {
    return "メモリ不足の可能性があります。解像度を下げるか、短い動画で再試行してください。";
  }
  if (/unknown encoder|codec|not currently supported/i.test(message)) {
    return "設定したコーデックが非対応です。プリセットを「標準」に戻して再試行してください。";
  }
  if (/invalid data|moov atom|could not find|error while decoding/i.test(message)) {
    return "入力ファイルを読み取れませんでした。破損または未対応形式の可能性があります。";
  }
  return "変換に失敗しました。形式や品質を変更して再試行してください。";
}

export function createFfmpegEngine({ onLog, onProgress } = {}) {
  let ffmpeg = null;
  let fetchFile = null;
  let initPromise = null;

  async function init() {
    if (ffmpeg) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      debugLog("ffmpeg-engine", "Loading ffmpeg.wasm");
      const [{ FFmpeg }, util] = await Promise.all([
        import("/vendor/@ffmpeg/ffmpeg/dist/esm/index.js"),
        import("/vendor/@ffmpeg/util/dist/esm/index.js"),
      ]);

      fetchFile = util.fetchFile;
      const { toBlobURL } = util;
      const instance = new FFmpeg();

      instance.on("log", ({ message }) => {
        if (typeof onLog === "function") onLog(message);
      });
      instance.on("progress", ({ progress }) => {
        if (typeof onProgress === "function") onProgress(progress);
      });

      const CDN = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
      await instance.load({
        coreURL: await toBlobURL(`${CDN}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CDN}/ffmpeg-core.wasm`, "application/wasm"),
        classWorkerURL: "/vendor/@ffmpeg/ffmpeg/dist/esm/worker.js",
      });

      ffmpeg = instance;
      debugLog("ffmpeg-engine", "ffmpeg.wasm ready");
    })().finally(() => {
      initPromise = null;
    });

    return initPromise;
  }

  function isReady() {
    return Boolean(ffmpeg && fetchFile);
  }

  function terminate() {
    try {
      ffmpeg?.terminate();
    } catch {
      // Ignore terminate errors.
    }
    ffmpeg = null;
    fetchFile = null;
  }

  async function convertItem({ item, settings, isCanceled, onStage }) {
    await init();

    const outputExt = settings.format;
    const inputExt = getExtension(item.file.name);
    const inputName = inputExt ? `input_${item.id}.${inputExt}` : `input_${item.id}`;
    const outputName = `output_${item.id}.${outputExt}`;

    onStage?.("reading");

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      if (isCanceled?.()) throw new Error("aborted");

      const args = buildArgs(settings, inputName, outputName);
      debugLog("ffmpeg-engine", "Starting conversion", {
        args,
        fileName: item.file.name,
        outputName,
      });
      onStage?.("converting", { args });
      await ffmpeg.exec(args);
      if (isCanceled?.()) throw new Error("aborted");

      onStage?.("packaging");
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: getMimeType(outputName) });
      const resultName = `${stripExtension(item.file.name)}.${outputExt}`;

      await safeDelete(ffmpeg, inputName);
      await safeDelete(ffmpeg, outputName);

      return {
        args,
        blob,
        resultName,
      };
    } catch (err) {
      debugError("ffmpeg-engine", "Conversion failed", err, {
        fileName: item.file.name,
        inputName,
        outputName,
      });
      await safeDelete(ffmpeg, inputName);
      await safeDelete(ffmpeg, outputName);
      throw err;
    }
  }

  return {
    convertItem,
    init,
    isReady,
    terminate,
  };
}
