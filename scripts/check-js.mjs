import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = ["src", "public", "test", "scripts"];
const files = roots.flatMap((root) => findJavaScriptFiles(root)).sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} JavaScript files.`);
}

function findJavaScriptFiles(root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      entries.push(...findJavaScriptFiles(path));
    } else if (path.endsWith(".js") || path.endsWith(".mjs")) {
      entries.push(relative(process.cwd(), path));
    }
  }
  return entries;
}
