import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureLogger, logEvent } from "../src/logger.js";

test("logger writes JSON events and rotates across configured files", () => {
  const dir = mkdtempSync(join(tmpdir(), "parts-search-logs-"));
  const filePath = join(dir, "search.log");
  const messages = [];
  const originalInfo = console.info;
  console.info = (message) => messages.push(message);

  try {
    configureLogger({
      filePath,
      maxBytes: 120,
      maxFiles: 3
    });

    for (let index = 0; index < 8; index += 1) {
      logEvent({
        event: "test.event",
        index,
        payload: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      });
    }

    const files = readdirSync(dir).sort();
    assert.deepEqual(files, ["search.log", "search.log.1", "search.log.2"]);
    assert.match(readFileSync(filePath, "utf8"), /"event": "test.event"/);
    assert.equal(messages.length, 8);
  } finally {
    console.info = originalInfo;
    configureLogger({});
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("logger does not throw when file logging fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "parts-search-logs-"));
  const blockedPath = join(dir, "not-a-directory");
  const filePath = join(blockedPath, "search.log");
  const warnings = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = () => {};
  console.warn = (message) => warnings.push(message);

  try {
    writeFileSync(blockedPath, "blocks mkdir");
    configureLogger({ filePath });

    assert.doesNotThrow(() => {
      logEvent({ event: "test.event" });
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Search log write failed/);
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    configureLogger({});
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("logger truncates current log when max files is one", () => {
  const dir = mkdtempSync(join(tmpdir(), "parts-search-logs-"));
  const filePath = join(dir, "search.log");
  const originalInfo = console.info;
  console.info = () => {};

  try {
    configureLogger({
      filePath,
      maxBytes: 120,
      maxFiles: 1
    });

    for (let index = 0; index < 4; index += 1) {
      logEvent({
        event: "test.event",
        index,
        payload: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      });
    }

    const files = readdirSync(dir).sort();
    const content = readFileSync(filePath, "utf8");
    assert.deepEqual(files, ["search.log"]);
    assert.match(content, /"event": "test.event"/);
    assert.ok(content.length <= 120);
  } finally {
    console.info = originalInfo;
    configureLogger({});
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
