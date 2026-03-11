import { cpSync, mkdirSync, rmSync } from "node:fs";

const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Source files
for (const entry of ["app.js", "style.css", "_headers", "Logo.png", "OGP.png", "favicon.png", "favicon-32.png", "favicon-192.png"]) {
  cpSync(entry, `${DIST}/${entry}`);
}
cpSync("src", `${DIST}/src`, { recursive: true });

// Copy index.html as-is (ffmpeg-engine.js already uses /vendor/ paths)
cpSync("index.html", `${DIST}/index.html`);

// Copy deps to vendor/ (wasm excluded — loaded from CDN at runtime)
const deps = [
  ["node_modules/@ffmpeg/ffmpeg/dist/esm", "vendor/@ffmpeg/ffmpeg/dist/esm"],
  ["node_modules/@ffmpeg/util/dist/esm",   "vendor/@ffmpeg/util/dist/esm"],
  ["node_modules/jszip/dist",              "vendor/jszip/dist"],
];
for (const [src, dest] of deps) {
  cpSync(src, `${DIST}/${dest}`, { recursive: true });
}

console.log("Build complete → dist/");
