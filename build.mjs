// Bundles the app into one self-contained HTML page plus its icons and manifest, in dist/.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// Shown in feedback emails, so a report can be matched to the code that was running.
let commit = "dev";
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {}
const stamp = `${commit} ${new Date().toISOString().slice(0, 10)}`;

const result = await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari15", "chrome100", "firefox100"],
  write: false,
  legalComments: "none",
  define: { __BUILD__: JSON.stringify(stamp) },
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/index.html", "utf8").replace("<!-- APP_SCRIPT -->", () => `<script>${js}</script>`);

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
writeFileSync("dist/index.html", html);
cpSync("public", "dist", { recursive: true });
writeFileSync("dist/.nojekyll", "");

console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
