import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError } from "../src/providers/provider-error.js";
import { SearchStatsStore } from "../src/search-stats.js";
import { searchParts } from "../src/search-service.js";
import { createRequestHandler } from "../src/server.js";

test("search service rejects empty article before calling providers", async () => {
  let called = false;
  const result = await searchParts({
    query: { q: "   " },
    providers: [
      {
        id: "mock",
        name: "Mock",
        async search() {
          called = true;
          return [];
        }
      }
    ]
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.errors[0].code, "empty_query");
  assert.equal(called, false);
});

test("search service rejects brand-only article query before calling providers", async () => {
  let called = false;
  const result = await searchParts({
    query: { q: "BOSCH" },
    providers: [
      {
        id: "mock",
        name: "Mock",
        async search() {
          called = true;
          return [];
        }
      }
    ]
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.errors[0].code, "article_too_broad");
  assert.equal(called, false);
});

test("search service merges a second provider without changing response contract", async () => {
  const result = await searchParts({
    query: { q: "OC90", brand: "MAHLE" },
    providers: [
      provider("uniqtrade", "UniqTrade", [
        { providerId: "uniqtrade", article: "OC90" }
      ]),
      provider("second", "Second Supplier", [
        { providerId: "second", article: "OC90" }
      ])
    ]
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 2);
  assert.deepEqual(
    result.body.providers.map((entry) => entry.id),
    ["uniqtrade", "second"]
  );
  assert.equal(result.body.meta.partial, false);
});

test("search service returns partial results when one provider fails", async () => {
  const result = await searchParts({
    query: { q: "OC90" },
    providers: [
      provider("ok", "OK Provider", [{ providerId: "ok", article: "OC90" }]),
      {
        id: "fail",
        name: "Fail Provider",
        async search() {
          throw new ProviderError("timeout", "Provider timed out", {
            providerId: "fail"
          });
        }
      }
    ]
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.results.length, 1);
  assert.equal(result.body.errors[0].code, "timeout");
  assert.equal(result.body.meta.partial, true);
});

test("search service logs summary when enabled", async () => {
  const messages = [];
  const originalInfo = console.info;
  console.info = (message) => messages.push(message);

  try {
    await searchParts({
      query: { q: "OC90" },
      logLevel: "summary",
      providers: [
        provider("ok", "OK Provider", [
          {
            providerId: "ok",
            article: "OC90",
            raw: { token: "secret-token" }
          }
        ])
      ]
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(messages.length, 1);
  assert.match(messages[0], /^parts\.search_response /);
  assert.match(messages[0], /results=1/);
  assert.equal(messages[0].includes("secret-token"), false);
});

test("HTTP API serves successful search and does not expose secrets", async () => {
  const handler = createRequestHandler({
    config: { includeSupplierImages: true },
    providers: [
      provider("mock", "Mock Supplier", [
        {
          providerId: "mock",
          providerName: "Mock Supplier",
          article: "OC90",
          brand: "MAHLE",
          title: "Oil filter",
          images: [],
          raw: { token: "provider-internal-value", value: "visible" }
        }
      ])
    ],
    searchStats: new SearchStatsStore({
      filePath: await createStatsFilePath()
    })
  });

  const response = await callHandler(handler, "/api/parts/search?q=OC90");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.results.length, 1);
  assert.equal(JSON.stringify(payload).includes("provider-internal-value"), false);
  assert.equal(payload.results[0].raw.token, "[redacted]");
});

test("HTTP API returns validation error for empty query", async () => {
  const handler = createRequestHandler({
    config: { includeSupplierImages: true },
    providers: [provider("mock", "Mock Supplier", [])]
  });

  const response = await callHandler(handler, "/api/parts/search?q=");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 400);
  assert.equal(payload.errors[0].code, "empty_query");
});

test("HTTP API records search stats for valid searches", async () => {
  const searchStats = new SearchStatsStore({
    filePath: await createStatsFilePath()
  });
  const handler = createRequestHandler({
    config: { includeSupplierImages: true },
    providers: [provider("mock", "Mock Supplier", [])],
    searchStats
  });

  const searchResponse = await callHandler(handler, "/api/parts/search?q=OC90");
  const statsResponse = await callHandler(handler, "/api/search-stats");
  const stats = JSON.parse(statsResponse.body);

  assert.equal(searchResponse.status, 200);
  assert.equal(statsResponse.status, 200);
  assert.equal(stats.totalSearches, 1);
  assert.equal(stats.todaySearches, 1);
  assert.equal(stats.last7DaysSearches, 1);
  assert.match(stats.firstSearchAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(stats.lastSearchAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("HTTP API does not record invalid search queries", async () => {
  const searchStats = new SearchStatsStore({
    filePath: await createStatsFilePath()
  });
  const handler = createRequestHandler({
    config: { includeSupplierImages: true },
    providers: [provider("mock", "Mock Supplier", [])],
    searchStats
  });

  const searchResponse = await callHandler(handler, "/api/parts/search?q=");
  const statsResponse = await callHandler(handler, "/api/search-stats");
  const stats = JSON.parse(statsResponse.body);

  assert.equal(searchResponse.status, 400);
  assert.equal(stats.totalSearches, 0);
  assert.equal(stats.todaySearches, 0);
});

test("search stats persist after recreating the store", async () => {
  const filePath = await createStatsFilePath();
  const firstHandler = createRequestHandler({
    config: { includeSupplierImages: true },
    providers: [provider("mock", "Mock Supplier", [])],
    searchStats: new SearchStatsStore({ filePath })
  });

  await callHandler(firstHandler, "/api/parts/search?q=OC90");

  const secondHandler = createRequestHandler({
    config: { includeSupplierImages: true },
    providers: [provider("mock", "Mock Supplier", [])],
    searchStats: new SearchStatsStore({ filePath })
  });
  const statsResponse = await callHandler(secondHandler, "/api/search-stats");
  const stats = JSON.parse(statsResponse.body);

  assert.equal(stats.totalSearches, 1);
  assert.equal(stats.todaySearches, 1);
});

test("HTTP health exposes build information", async () => {
  const handler = createRequestHandler({
    config: {
      includeSupplierImages: true,
      build: {
        version: "1.2.3",
        commit: "abcdef123456",
        time: "2026-05-27T10:00:00Z"
      }
    },
    providers: [provider("mock", "Mock Supplier", [])]
  });

  const response = await callHandler(handler, "/api/health");
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.build, {
    version: "1.2.3",
    commit: "abcdef123456",
    time: "2026-05-27T10:00:00Z"
  });
});

function provider(id, name, results) {
  return {
    id,
    name,
    async search() {
      return results;
    }
  };
}

async function createStatsFilePath() {
  const dir = await mkdtemp(join(tmpdir(), "parts-search-stats-"));
  return join(dir, "search-stats.json");
}

async function callHandler(handler, url) {
  let status = 0;
  let body = "";
  const chunks = [];
  const req = {
    url,
    headers: { host: "localhost" }
  };
  const res = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk = "") {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
  };

  await handler(req, res);
  return { status, body };
}
