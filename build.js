import { cpSync, mkdirSync, rmSync } from "node:fs";

const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Project files needed to use, modify, and redistribute the built site.
for (const entry of [
  "app.js",
  "build.js",
  "LICENSE",
  "LICENSE.txt",
  "package-lock.json",
  "package.json",
  "README.md",
  "server.js",
  "style.css",
  "THIRD_PARTY_NOTICES.txt",
  "_headers",
  "Logo.png",
  "OGP.png",
  "favicon.png",
  "favicon-32.png",
  "favicon-192.png",
]) {
  cpSync(entry, `${DIST}/${entry}`);
}
cpSync("src", `${DIST}/src`, { recursive: true });

cpSync("index.html", `${DIST}/index.html`);

// Copy runtime dependencies to vendor/ (@ffmpeg/core stays on CDN to avoid Pages' 25 MiB file limit).
const deps = [
  ["node_modules/@ffmpeg/ffmpeg/dist/esm", "vendor/@ffmpeg/ffmpeg/dist/esm"],
  ["node_modules/@ffmpeg/util/dist/esm",   "vendor/@ffmpeg/util/dist/esm"],
  ["node_modules/jszip/dist",              "vendor/jszip/dist"],
];
for (const [src, dest] of deps) {
  cpSync(src, `${DIST}/${dest}`, { recursive: true });
}

console.log("Build complete → dist/");
