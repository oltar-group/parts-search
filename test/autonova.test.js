import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { createProviders } from "../src/providers/index.js";
import {
  AutonovaProvider,
  normalizeAutonovaArticleSearch,
  normalizeAutonovaDetailSearch
} from "../src/providers/autonova.js";

test("Autonova provider authenticates and searches article details", async () => {
  const calls = [];
  const provider = new AutonovaProvider({
    baseUrl: "https://api.autonovad.ua/stable",
    login: "user",
    password: "pass",
    clientId: "12345",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/api/v1/auth/token")) {
        return jsonResponse(200, {
          access_token: "access-token",
          refreshToken: "refresh-token",
          expires_in: 300
        });
      }
      if (url.endsWith("/api/v1/wares/article/OC90")) {
        assert.equal(options.headers.Authorization, "Bearer access-token");
        return jsonResponse(200, [
          {
            partId: 77,
            brand: "MAHLE",
            article: "OC90",
            name: "Oil filter"
          }
        ]);
      }
      if (url.includes("/api/v1/wares/clients/12345/parts/77")) {
        assert.equal(options.headers.Authorization, "Bearer access-token");
        return jsonResponse(200, [
          {
            wareId: 77,
            brand: "MAHLE",
            article: "OC90",
            name: "Oil filter",
            warehouseName: "Kyiv",
            quantity: 4,
            clientPrice: 92.5,
            currency: "UAH",
            supplierId: 5
          }
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  const results = await provider.search({ article: "OC90", brand: "MAHLE" });
  const authBody = JSON.parse(calls[0].options.body);

  assert.deepEqual(authBody, { login: "user", password: "pass" });
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, "autonova");
  assert.equal(results[0].externalId, "77");
  assert.equal(results[0].brand, "MAHLE");
  assert.deepEqual(results[0].price, { value: 92.5, currency: "UAH" });
  assert.deepEqual(results[0].remains, [
    {
      storageId: null,
      storageName: "Kyiv",
      quantity: 4,
      price: 92.5,
      currency: "UAH",
      supplierId: 5,
      deliveryType: "",
      deliveryDate: "",
      resultCategory: null
    }
  ]);
});

test("Autonova provider filters article rows by brand before details", async () => {
  const detailUrls = [];
  const provider = new AutonovaProvider({
    baseUrl: "https://api.autonovad.ua/stable",
    login: "user",
    password: "pass",
    clientId: "12345",
    fetchImpl: async (url) => {
      if (url.endsWith("/api/v1/auth/token")) {
        return jsonResponse(200, { access_token: "access-token" });
      }
      if (url.endsWith("/api/v1/wares/article/OC90")) {
        return jsonResponse(200, [
          { partId: 1, brand: "MAHLE", article: "OC90" },
          { partId: 2, brand: "BOSCH", article: "OC90" }
        ]);
      }
      detailUrls.push(url);
      return jsonResponse(200, []);
    }
  });

  const results = await provider.search({ article: "OC90", brand: "MAHLE" });

  assert.equal(results.length, 1);
  assert.equal(results[0].brand, "MAHLE");
  assert.equal(detailUrls.length, 1);
  assert.match(detailUrls[0], /\/parts\/1\?/);
});

test("normalizes Autonova article and detail rows", () => {
  const articleResults = normalizeAutonovaArticleSearch([
    {
      partId: 77,
      producerName: "MAHLE",
      article: "OC90",
      name: "Oil filter"
    }
  ]);
  const detailResults = normalizeAutonovaDetailSearch([
    {
      wareId: 77,
      brand: "MAHLE",
      article: "OC90",
      name: "Oil filter",
      offers: [
        {
          warehouseId: 10,
          warehouseName: "Lviv",
          quantity: 2,
          clientPrice: 91,
          currency: "UAH"
        }
      ]
    }
  ]);

  assert.equal(articleResults[0].externalId, "77");
  assert.equal(articleResults[0].displayBrand, "MAHLE");
  assert.equal(detailResults[0].price.value, 91);
  assert.deepEqual(detailResults[0].remains, [
    {
      storageId: 10,
      storageName: "Lviv",
      quantity: 2,
      price: 91,
      currency: "UAH",
      supplierId: null,
      deliveryType: "",
      deliveryDate: "",
      resultCategory: null
    }
  ]);
});

test("registers Autonova provider only when credentials and client id are configured", () => {
  const withoutAutonova = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp"
    })
  );
  assert.deepEqual(
    withoutAutonova.map((provider) => provider.id),
    ["uniqtrade"]
  );

  const withAutonova = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp",
      AUTONOVA_LOGIN: "user",
      AUTONOVA_PASSWORD: "pass",
      AUTONOVA_CLIENT_ID: "12345"
    })
  );
  assert.deepEqual(
    withAutonova.map((provider) => provider.id),
    ["uniqtrade", "autonova"]
  );
});

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
