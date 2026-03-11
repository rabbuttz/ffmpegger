import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Source files
for (const entry of ["app.js", "style.css", "_headers"]) {
  cpSync(entry, `${DIST}/${entry}`);
}
cpSync("src", `${DIST}/src`, { recursive: true });

// Patch /node_modules/ → /vendor/ in index.html and ffmpeg-engine.js
for (const file of ["index.html", `src/ffmpeg-engine.js`]) {
  const src = file === "index.html" ? file : `src/ffmpeg-engine.js`;
  const dest = file === "index.html" ? `${DIST}/index.html` : `${DIST}/src/ffmpeg-engine.js`;
  const content = readFileSync(src, "utf8").replaceAll("/node_modules/", "/vendor/");
  writeFileSync(dest, content);
}

// Copy deps to vendor/ instead of node_modules/
const deps = [
  ["node_modules/@ffmpeg/ffmpeg/dist/esm", "vendor/@ffmpeg/ffmpeg/dist/esm"],
  ["node_modules/@ffmpeg/core/dist/esm",   "vendor/@ffmpeg/core/dist/esm"],
  ["node_modules/@ffmpeg/util/dist/esm",   "vendor/@ffmpeg/util/dist/esm"],
  ["node_modules/jszip/dist",              "vendor/jszip/dist"],
];
for (const [src, dest] of deps) {
  cpSync(src, `${DIST}/${dest}`, { recursive: true });
}

console.log("Build complete → dist/");
