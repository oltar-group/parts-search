import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { createProviders } from "../src/providers/index.js";
import {
  AutonovaProvider,
  buildAutonovaSearchUrl,
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

  assert.deepEqual(authBody, { username: "user", password: "pass" });
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, "autonova");
  assert.equal(results[0].externalId, "77");
  assert.equal(results[0].brand, "MAHLE");
  assert.equal(
    results[0].providerUrl,
    "https://autonovad.ua/ru/search-products/?query=OC90"
  );
  assert.deepEqual(results[0].price, { value: 92.5, currency: "UAH" });
  assert.deepEqual(results[0].remains, [
    {
      storageId: null,
      storageName: "Kyiv",
      quantity: 4,
      quantityLabel: "",
      price: 92.5,
      currency: "UAH",
      supplierId: 5,
      deliveryType: "",
      deliveryDate: "",
      deliveryDays: null,
      deliveryTerm: "",
      resultCategory: null
    }
  ]);
});

test("Autonova provider sends documented username auth field once", async () => {
  const authBodies = [];
  const provider = new AutonovaProvider({
    baseUrl: "https://api.autonovad.ua/stable",
    login: "user",
    password: "pass",
    clientId: "12345",
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/api/v1/auth/token")) {
        const body = JSON.parse(options.body);
        authBodies.push(body);
        return jsonResponse(401, { message: "Unauthorized" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  await assert.rejects(
    () => provider.search({ article: "OC90" }),
    /Unauthorized/
  );

  assert.deepEqual(authBodies, [{ username: "user", password: "pass" }]);
});

test("Autonova provider reports non-JSON auth errors with HTTP status", async () => {
  const provider = new AutonovaProvider({
    baseUrl: "https://api.autonovad.ua/stable",
    login: "user",
    password: "pass",
    clientId: "12345",
    fetchImpl: async (url) => {
      if (url.endsWith("/api/v1/auth/token")) {
        return new Response("<html>Not Found</html>", {
          status: 404,
          headers: { "Content-Type": "text/html" }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  await assert.rejects(
    () => provider.search({ article: "OC90" }),
    (error) => {
      assert.equal(error.code, "auth_failed");
      assert.match(error.message, /HTTP 404/);
      assert.match(error.message, /Not Found/);
      return true;
    }
  );
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
      quantityLabel: "",
      price: 91,
      currency: "UAH",
      supplierId: null,
      deliveryType: "",
      deliveryDate: "",
      deliveryDays: null,
      deliveryTerm: "",
      resultCategory: null
    }
  ]);
});

test("normalizes documented Autonova OpenAPI response shapes", () => {
  const articleResults = normalizeAutonovaArticleSearch({
    success: "true",
    data: {
      Total: 1,
      WareListItem: [
        {
          Id: "111210_116",
          WareNumber: "111210",
          Name: "Трос",
          ProducerName: "Kolbenschmidt",
          HasImage: true,
          ImageId: "https://cdn.example/111210.jpg"
        }
      ]
    }
  });
  const detailResults = normalizeAutonovaDetailSearch({
    success: "true",
    data: [
      {
        Id: "111210_116",
        WareNumber: "111210",
        Name: "Трос",
        ProducerName: "Kolbenschmidt",
        SupplierWarehouseId: "351132",
        SupplierWarehouseName: "Main",
        AvailableQnt: 99,
        AvailableQntstr: "99",
        ClientPrice: 2356.52,
        DeliveryDays: 29,
        DeliveryTerm: "14:00",
        SupplierId: "36546541",
        ResultCategory: 3,
        ImageUrl: "https://cdn.example/offer.jpg"
      }
    ]
  });

  assert.equal(articleResults.length, 1);
  assert.equal(articleResults[0].externalId, "111210_116");
  assert.equal(articleResults[0].article, "111210");
  assert.equal(articleResults[0].brand, "Kolbenschmidt");
  assert.equal(articleResults[0].hasImage, true);
  assert.equal(articleResults[0].images[0].value, "https://cdn.example/111210.jpg");

  assert.equal(detailResults[0].price.value, 2356.52);
  assert.deepEqual(detailResults[0].remains, [
    {
      storageId: "351132",
      storageName: "Main",
      quantity: 99,
      quantityLabel: "99",
      price: 2356.52,
      currency: "UAH",
      supplierId: "36546541",
      deliveryType: "",
      deliveryDate: "",
      deliveryDays: 29,
      deliveryTerm: "14:00",
      resultCategory: 3
    }
  ]);
});

test("builds Autonova provider search URL", () => {
  assert.equal(
    buildAutonovaSearchUrl("https://autonovad.ua", { article: "038198119A" }),
    "https://autonovad.ua/ru/search-products/?query=038198119A"
  );
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
