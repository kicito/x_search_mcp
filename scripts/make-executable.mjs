import { chmod } from "node:fs/promises";

// npm creates command shims on Windows; POSIX installs also need executable bits.
if (process.platform !== "win32") {
  await chmod(new URL("../build/index.js", import.meta.url), 0o755);
}
