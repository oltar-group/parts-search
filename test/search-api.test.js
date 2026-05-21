import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../src/providers/provider-error.js";
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
  console.info = (message) => messages.push(JSON.parse(message));

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
  assert.equal(messages[0].event, "parts.search_response");
  assert.equal(messages[0].resultCount, 1);
  assert.equal(JSON.stringify(messages).includes("secret-token"), false);
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
    ]
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

function provider(id, name, results) {
  return {
    id,
    name,
    async search() {
      return results;
    }
  };
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
