import { existsSync, mkdirSync, renameSync, statSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

let fileConfig = {
  enabled: false,
  path: "",
  maxBytes: 1024 * 1024,
  maxFiles: 5
};

export function configureLogger(options = {}) {
  const path = options.filePath || "";
  fileConfig = {
    enabled: Boolean(path),
    path,
    maxBytes: parseInt(options.maxBytes || `${1024 * 1024}`, 10),
    maxFiles: Math.max(parseInt(options.maxFiles || "5", 10), 1)
  };
}

export function logEvent(event) {
  const line = JSON.stringify(event, null, 2);
  console.info(line);

  if (!fileConfig.enabled) {
    return;
  }

  appendRotatingLine(`${line}\n`);
}

function appendRotatingLine(line) {
  mkdirSync(dirname(fileConfig.path), { recursive: true });
  rotateIfNeeded(Buffer.byteLength(line));
  appendFileSync(fileConfig.path, line);
}

function rotateIfNeeded(nextBytes) {
  if (!existsSync(fileConfig.path)) {
    return;
  }

  const size = statSync(fileConfig.path).size;
  if (size + nextBytes <= fileConfig.maxBytes) {
    return;
  }

  for (let index = fileConfig.maxFiles - 1; index >= 1; index -= 1) {
    const source = index === 1 ? fileConfig.path : `${fileConfig.path}.${index - 1}`;
    const target = `${fileConfig.path}.${index}`;
    if (existsSync(source)) {
      renameSync(source, target);
    }
  }
}
