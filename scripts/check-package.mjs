import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run through npm (for example: npm run test:package)");

// Invoke npm through Node rather than a shell or npm.cmd for Windows portability.
// Offline dry-run only: no tarball, install, registry request, or API key required.
const output = execFileSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts", "--offline"],
  { cwd: fileURLToPath(root), encoding: "utf8" },
);
const [packed] = JSON.parse(output);
assert.equal(packed.name, manifest.name);
assert.equal(packed.version, manifest.version);
assert.equal(manifest.license, "MIT");
assert.equal(manifest.engines.node, ">=22");
assert.equal(manifest.bin["xai-search-mcp"], "./build/index.js");

const files = new Map(packed.files.map((file) => [file.path, file]));
for (const path of ["package.json", "README.md", "LICENSE", "build/index.js"]) {
  assert.ok(files.has(path), `Package missing ${path}`);
  assert.ok(files.get(path).size > 0, `Packaged ${path} is empty`);
}

async function checkBuild(directory = "build/") {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) {
      await checkBuild(`${path}/`);
    } else {
      assert.ok(entry.isFile(), `Unexpected non-file in build: ${path}`);
      assert.ok(files.has(path), `Package missing build output: ${path}`);
    }
  }
}
await checkBuild();

for (const path of files.keys()) {
  assert.ok(
    ["package.json", "README.md", "LICENSE"].includes(path) || path.startsWith("build/"),
    `Unexpected packaged file: ${path}`,
  );
}
const entrypoint = await readFile(new URL("build/index.js", root), "utf8");
assert.ok(entrypoint.startsWith("#!/usr/bin/env node\n"), "CLI must have a Node shebang");
// Windows uses npm's command shims rather than POSIX executable bits.
if (process.platform !== "win32") {
  assert.ok((files.get("build/index.js").mode & 0o111) !== 0, "Packed CLI must be executable");
}
const license = await readFile(new URL("LICENSE", root), "utf8");
assert.ok(license.includes("MIT License"), "MIT license text missing");
console.log(`Package smoke check passed: ${packed.name}@${packed.version} (${files.size} files)`);
