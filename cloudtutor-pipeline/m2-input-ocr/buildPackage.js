"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const [root, entry, dest] = process.argv.slice(2);
const seen = new Set();
function copy(name) {
  if (seen.has(name)) return; seen.add(name);
  if (name.includes("..") || path.isAbsolute(name)) throw new Error("UNSAFE_LOCAL_IMPORT");
  const source = fs.readFileSync(path.join(root, name), "utf8");
  if (name.endsWith(".js")) cp.execFileSync(process.execPath, ["--check", path.join(root, name)]);
  fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
  fs.copyFileSync(path.join(root, name), path.join(dest, name));
  for (const m of source.matchAll(/require\(["'](\.\/[\w./-]+)["']\)/g)) {
    let imported = path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1]));
    if (!path.extname(imported)) imported += ".js";
    copy(imported);
  }
}
copy(entry); console.log(`PACKAGED: ${entry}, ${seen.size} local files, no node_modules.`);
