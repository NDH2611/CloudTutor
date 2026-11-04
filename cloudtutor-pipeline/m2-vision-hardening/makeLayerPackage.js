"use strict";
const fs = require("node:fs");
const path = require("node:path");
const [root, secretVersion, destination] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(secretVersion)) throw new Error("INVALID_SECRET_SDK_VERSION");
const project = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const dependencies = {};
for (const name of Object.keys(project.dependencies || {})) {
  if (!name.startsWith("@aws-sdk/")) continue;
  const version = lock.packages?.[`node_modules/${name}`]?.version || lock.dependencies?.[name]?.version;
  if (!version) throw new Error(`UNPINNED_SDK: ${name}`);
  dependencies[name] = version;
}
dependencies["@aws-sdk/client-secrets-manager"] = secretVersion;
fs.writeFileSync(destination, JSON.stringify({ name: "cloudtutor-vision-runtime-layer", version: "1.0.0", private: true, dependencies }), "utf8");
console.log(`Layer package pinned: ${Object.keys(dependencies).length} AWS SDK clients.`);
