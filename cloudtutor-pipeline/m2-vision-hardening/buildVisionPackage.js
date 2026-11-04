"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
const seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = path.resolve(root, file);
  const content = fs.readFileSync(source, "utf8");
  if (file.endsWith(".js")) {
    execFileSync(process.execPath, ["--check", source], { stdio: "pipe" });
    for (const match of content.matchAll(/require\s*\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const base = path.resolve(path.dirname(source), match[1]);
      const resolved = [base, base + ".js", base + ".json"].find(name => fs.existsSync(name) && fs.statSync(name).isFile());
      if (!resolved) throw new Error(`MISSING_DEPENDENCY: ${match[1]}`);
      const relative = path.relative(root, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("DEPENDENCY_OUTSIDE_PROJECT");
      visit(relative);
    }
  }
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
fs.rmSync(target, { recursive: true, force: true });
visit("onVisionFallback.js");
console.log(`PACKAGED: ${seen.size} local modules; no node_modules in function ZIP.`);
