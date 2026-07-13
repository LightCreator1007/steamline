import esbuild from "esbuild";
await esbuild.build({ entryPoints: ["src/main.ts"], bundle: true, minify: true, format: "iife", outfile: "app.js" });
console.log("built app.js");
