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
    assert.match(messages[0], /"event":"test.event"/);
  } finally {
    console.info = originalInfo;
    configureLogger({});
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("logger keeps full JSON in file but prints compact console events", () => {
  const dir = mkdtempSync(join(tmpdir(), "parts-search-logs-"));
  const filePath = join(dir, "search.log");
  const messages = [];
  const originalInfo = console.info;
  console.info = (message) => messages.push(message);

  try {
    configureLogger({
      filePath,
      maxBytes: 1024 * 1024,
      maxFiles: 3
    });

    logEvent({
      event: "supplier.raw_response",
      providerId: "autonova",
      article: "OC90",
      path: "/api/v1/wares/article/OC90",
      payload: {
        data: {
          WareListItem: [
            { Id: "1", WareNumber: "OC90" },
            { Id: "2", WareNumber: "OC90" }
          ]
        }
      }
    });

    assert.equal(messages.length, 1);
    assert.equal(
      messages[0],
      "supplier.raw_response provider=autonova article=OC90 path=/api/v1/wares/article/OC90 payload=data:2"
    );
    assert.equal(messages[0].includes("WareListItem"), false);

    const content = readFileSync(filePath, "utf8");
    assert.match(content, /"event": "supplier.raw_response"/);
    assert.match(content, /"WareListItem"/);
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
