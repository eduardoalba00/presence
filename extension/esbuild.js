// Bundles the extension into a single dist/extension.js so it can be packaged
// without shipping node_modules (which pnpm's layout makes unreliable for vsce).
// `ws` is inlined; the type-only @presence/protocol import is erased by esbuild.
const esbuild = require("esbuild");
const fs = require("node:fs");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  // Start from a clean dist so no stale (e.g. previously type-emitted) files
  // get packaged alongside the single bundle.
  fs.rmSync("dist", { recursive: true, force: true });

  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/extension.js",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    // Provided by the VS Code host; `ws`'s optional native speedups are absent.
    external: ["vscode", "bufferutil", "utf-8-validate"],
    logLevel: "warning",
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
