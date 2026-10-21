// Bundles the app into one self-contained HTML file, index.html, served by GitHub Pages.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

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

writeFileSync("index.html", html);
console.log(`index.html  ${(html.length / 1024).toFixed(0)} KB`);
