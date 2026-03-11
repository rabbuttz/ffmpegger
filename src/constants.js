export const AUDIO_FORMATS = new Set(["mp3", "aac", "wav", "ogg", "flac", "opus"]);

export const ACCEPTED_EXTENSIONS = new Set([
  "mkv",
  "avi",
  "flv",
  "wmv",
  "mov",
  "webm",
  "mp4",
  "m4a",
  "flac",
  "ogg",
  "opus",
  "wav",
  "aac",
  "wma",
  "mp3",
]);

export const FORMAT_DEFAULTS = {
  mp4: { vcodec: "libx264", acodec: "aac" },
  webm: { vcodec: "libvpx-vp9", acodec: "libopus" },
  avi: { vcodec: "libx264", acodec: "libmp3lame" },
  mkv: { vcodec: "libx264", acodec: "aac" },
  mov: { vcodec: "libx264", acodec: "aac" },
  gif: { vcodec: null, acodec: null },
  mp3: { vcodec: null, acodec: "libmp3lame" },
  aac: { vcodec: null, acodec: "aac" },
  wav: { vcodec: null, acodec: "pcm_s16le" },
  ogg: { vcodec: null, acodec: "libvorbis" },
  flac: { vcodec: null, acodec: "flac" },
  opus: { vcodec: null, acodec: "libopus" },
};

export const FORMAT_CODEC_COMPAT = {
  mp4: { video: ["libx264", "libx265"], audio: ["aac", "libmp3lame"] },
  webm: { video: ["libvpx-vp9"], audio: ["libopus", "libvorbis"] },
  avi: { video: ["libx264"], audio: ["libmp3lame", "pcm_s16le"] },
  mkv: {
    video: ["libx264", "libx265", "libvpx-vp9"],
    audio: ["aac", "libmp3lame", "libvorbis", "libopus", "pcm_s16le", "flac"],
  },
  mov: { video: ["libx264", "libx265"], audio: ["aac", "pcm_s16le"] },
  gif: { video: [], audio: [] },
  mp3: { video: [], audio: ["libmp3lame"] },
  aac: { video: [], audio: ["aac"] },
  wav: { video: [], audio: ["pcm_s16le"] },
  ogg: { video: [], audio: ["libvorbis"] },
  flac: { video: [], audio: ["flac"] },
  opus: { video: [], audio: ["libopus"] },
};

export const QUALITY_MAP = {
  high: { crf: "18", ab: "256k" },
  medium: { crf: "23", ab: "192k" },
  low: { crf: "30", ab: "128k" },
};

export const CODEC_LABELS = {
  auto: "自動",
  libx264: "H.264",
  libx265: "H.265 (HEVC)",
  "libvpx-vp9": "VP9",
  aac: "AAC",
  libmp3lame: "MP3",
  libvorbis: "Vorbis",
  libopus: "Opus",
  pcm_s16le: "PCM (無圧縮)",
  flac: "FLAC",
};

export const PRESETS = {
  hq: {
    format: "mp4",
    quality: "high",
    resolution: "1920:1080",
    videoCodec: "libx264",
    audioCodec: "aac",
  },
  balanced: {
    format: "mp4",
    quality: "medium",
    resolution: "original",
    videoCodec: "libx264",
    audioCodec: "aac",
  },
  small: {
    format: "mp4",
    quality: "low",
    resolution: "854:480",
    videoCodec: "libx264",
    audioCodec: "aac",
  },
  "extract-audio": {
    format: "mp3",
    quality: "medium",
    resolution: "original",
    videoCodec: "auto",
    audioCodec: "libmp3lame",
  },
};

export const DEFAULT_PARALLELISM = 3;

export const DEFAULT_FRAME_NUDGE_SECONDS = 1 / 30;

export const OUTPUT_FORMAT_GROUPS = [
  {
    label: "動画",
    formats: [
      { value: "mp4", title: "MP4", description: "標準的で一番使いやすい" },
      { value: "webm", title: "WebM", description: "Web向けで軽め" },
      { value: "mkv", title: "MKV", description: "柔軟で高機能" },
      { value: "mov", title: "MOV", description: "Apple系と相性が良い" },
      { value: "avi", title: "AVI", description: "古めの機器向け" },
      { value: "gif", title: "GIF", description: "短いアニメに変換" },
    ],
  },
  {
    label: "音声",
    formats: [
      { value: "mp3", title: "MP3", description: "互換性が高い定番" },
      { value: "aac", title: "AAC", description: "高効率で扱いやすい" },
      { value: "wav", title: "WAV", description: "無圧縮でそのまま" },
      { value: "flac", title: "FLAC", description: "可逆圧縮で高音質" },
      { value: "ogg", title: "OGG", description: "オープン形式" },
      { value: "opus", title: "Opus", description: "音声中心なら高効率" },
    ],
  },
];

export const STORAGE_KEY = "ffmpegger.settings.v2";
