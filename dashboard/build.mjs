// Builds app.js (browser dashboard) and api/run.js (serverless executor) from
// source. Pass --check to instead verify the committed bundles match a fresh
// build and exit nonzero on drift, so a stale bundle cannot ship (vercel.json
// deploys prebuilt, it does not rebuild). Run from the dashboard/ directory.
// ponytail: --check byte-compares esbuild output; an esbuild version bump can
// flag spurious drift. Fix is harmless: rerun `node build.mjs` to refresh.
import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const targets = [
  { entry: "src/main.ts", out: "app.js", opts: { minify: true, format: "iife" } },
  {
    entry: "../server/run.ts",
    out: "../api/run.js",
    opts: {
      minify: true,
      platform: "node",
      format: "esm",
      target: "node20",
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    },
  },
];

const check = process.argv.includes("--check");
let stale = false;

for (const t of targets) {
  const result = await esbuild.build({ entryPoints: [t.entry], bundle: true, write: false, ...t.opts });
  const fresh = result.outputFiles[0].text;
  const path = new URL(t.out, import.meta.url);
  if (check) {
    const current = readFileSync(path, "utf8");
    if (fresh === current) {
      console.log(`fresh: ${t.out}`);
    } else {
      console.error(`STALE: ${t.out} differs from a fresh build of ${t.entry} -> run: node build.mjs`);
      stale = true;
    }
  } else {
    writeFileSync(path, fresh);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log("bundles up to date");
} else {
  console.log("built app.js + api/run.js");
}
