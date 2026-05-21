import test from "node:test";
import assert from "node:assert/strict";
import {
  UniqTradeProvider,
  normalizeUniqTradeSearch
} from "../src/providers/uniqtrade.js";
import { redactSensitive } from "../src/redact.js";

test("normalizes UniqTrade rows with supplier images", () => {
  const results = normalizeUniqTradeSearch({
    data: [
      {
        id: 10,
        brand: "MAHLE",
        article: "OC90",
        name: "Oil filter",
        price: 120.5,
        currency: "UAH",
        quantity: 4,
        multiplicity: 1,
        images: [
          {
            thumbnail: "https://cdn.example/thumb.jpg",
            fullImagePath: "https://cdn.example/full.jpg"
          }
        ]
      }
    ]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, "uniqtrade");
  assert.equal(results[0].brand, "MAHLE");
  assert.equal(results[0].article, "OC90");
  assert.deepEqual(results[0].price, { value: 120.5, currency: "UAH" });
  assert.equal(results[0].hasImage, true);
  assert.equal(results[0].images[0].thumbnail, "https://cdn.example/thumb.jpg");
});

test("normalizes UniqTrade rows without images", () => {
  const results = normalizeUniqTradeSearch([
    {
      productId: "abc",
      brandName: "MANN",
      oem: "W712",
      description: "Filter",
      stock: "8"
    }
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].externalId, "abc");
  assert.equal(results[0].displayBrand, "MANN");
  assert.equal(results[0].quantity, 8);
  assert.equal(results[0].hasImage, false);
  assert.deepEqual(results[0].images, []);
});

test("UniqTrade provider logs in, refreshes expired token, and retries once", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith("/api/login_check")) {
      return jsonResponse(200, {
        token: "old-token",
        refresh_token: "refresh-token"
      });
    }

    if (url.includes("/api/search/OC90") && calls.length === 2) {
      return jsonResponse(401, { message: "Expired JWT Token" });
    }

    if (url.endsWith("/api/token/refresh")) {
      return jsonResponse(200, {
        token: "new-token",
        refresh_token: "new-refresh-token"
      });
    }

    if (url.includes("/api/search/OC90")) {
      return jsonResponse(200, {
        data: [{ brand: "MAHLE", article: "OC90", price: 100 }]
      });
    }

    return jsonResponse(500, { message: "unexpected" });
  };

  const provider = new UniqTradeProvider({
    baseUrl: "https://order24-api.utr.ua",
    email: "user@example.com",
    password: "secret",
    browserFingerprint: "test",
    fetchImpl
  });

  const results = await provider.search({ article: "OC90", brand: "MAHLE" });

  assert.equal(results.length, 1);
  assert.equal(calls.length, 4);
  assert.equal(calls[1].options.headers.Authorization, "Bearer old-token");
  assert.equal(calls[3].options.headers.Authorization, "Bearer new-token");
  assert.match(calls[3].url, /brand=MAHLE/);
  assert.match(calls[3].url, /info=1/);
});

test("redacts sensitive fields from raw provider data", () => {
  assert.deepEqual(
    redactSensitive({
      token: "abc",
      nested: { password: "secret", value: "visible" }
    }),
    {
      token: "[redacted]",
      nested: { password: "[redacted]", value: "visible" }
    }
  );
});

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
