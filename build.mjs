// Bundles the app into one self-contained HTML page plus its icons and manifest, in dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const result = await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari15", "chrome100", "firefox100"],
  write: false,
  legalComments: "none",
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/index.html", "utf8").replace("<!-- APP_SCRIPT -->", () => `<script>${js}</script>`);

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
writeFileSync("dist/index.html", html);
cpSync("public", "dist", { recursive: true });
writeFileSync("dist/.nojekyll", "");

// Until GitHub Pages deploys from GitHub Actions, it serves the repository root,
// so keep a copy there. Remove this once the Pages source is "GitHub Actions".
if (process.argv.includes("--root")) {
  writeFileSync("index.html", html);
  cpSync("public", ".", { recursive: true });
}
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
