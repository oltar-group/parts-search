import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
