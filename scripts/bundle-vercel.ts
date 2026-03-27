/**
 * Vercel build script
 * 1. Vite build  → dist/public/  (frontend static files)
 * 2. esbuild     → api/bundle.js (serverless function — all local TS inlined)
 */

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

async function main() {
  console.log("Building client...");
  await viteBuild();

  console.log("Bundling API for Vercel...");
  await esbuild({
    entryPoints: ["api/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",   // npm packages stay in node_modules; local TS gets inlined
    outfile: "api/bundle.js",
    logLevel: "info",
  });

  console.log("Vercel build complete.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
