import { build } from "esbuild";

await build({
  entryPoints: ["src/background.ts"],
  outfile: "dist/background.js",
  bundle: true,
  platform: "browser",
  target: ["es2022"],
  format: "esm"
});

