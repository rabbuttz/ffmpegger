import { cpSync, mkdirSync, rmSync } from "node:fs";

const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Source files
for (const entry of ["index.html", "app.js", "style.css", "_headers"]) {
  cpSync(entry, `${DIST}/${entry}`);
}
cpSync("src", `${DIST}/src`, { recursive: true });

// Only the node_modules files actually referenced at runtime
const deps = [
  "node_modules/@ffmpeg/ffmpeg/dist/esm",
  "node_modules/@ffmpeg/core/dist/esm",
  "node_modules/@ffmpeg/util/dist/esm",
  "node_modules/jszip/dist",
];
for (const dep of deps) {
  cpSync(dep, `${DIST}/${dep}`, { recursive: true });
}

console.log("Build complete → dist/");
