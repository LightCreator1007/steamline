import esbuild from "esbuild";
await esbuild.build({ entryPoints: ["src/main.ts"], bundle: true, minify: true, format: "iife", outfile: "app.js" });
await esbuild.build({
  entryPoints: ["../server/run.ts"],
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  outfile: "../api/run.js",
});
console.log("built app.js + api/run.js");
