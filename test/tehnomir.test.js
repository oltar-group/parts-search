import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { createProviders } from "../src/providers/index.js";
import {
  buildTehnomirSearchUrl,
  normalizeTehnomirSearch,
  TehnomirProvider
} from "../src/providers/tehnomir.js";

test("Tehnomir provider posts article search with API token", async () => {
  const calls = [];
  const provider = new TehnomirProvider({
    baseUrl: "https://api.tehnomir.com.ua",
    apiToken: "secret-token",
    currency: "UAH",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, {
        success: true,
        data: [
          {
            productId: 4106,
            brand: "BOSCH",
            code: "0451103079",
            descriptionUa: "Фільтр оливи",
            rests: [
              {
                priceLogo: "ABCD",
                quantity: 20,
                quantityType: "MORE",
                price: 112.79,
                currency: "UAH",
                multiplicity: 1,
                deliveryType: "Авто",
                deliveryDate: "2026-05-27T10:00:00"
              }
            ]
          }
        ]
      });
    }
  });

  const results = await provider.search({ article: "0451103079" });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(calls[0].url, "https://api.tehnomir.com.ua/price/search");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(body.apiToken, "secret-token");
  assert.equal(body.code, "0451103079");
  assert.equal(body.currency, "UAH");
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, "tehnomir");
  assert.equal(results[0].article, "0451103079");
  assert.deepEqual(results[0].price, { value: 112.79, currency: "UAH" });
  assert.equal(results[0].quantity, null);
  assert.equal(results[0].remains[0].quantity, "> 20");
});

test("normalizes Tehnomir price/search response", () => {
  const results = normalizeTehnomirSearch({
    success: true,
    data: [
      {
        productId: 11,
        brand: "MAHLE",
        code: "OC90",
        descriptionRus: "Масляный фильтр",
        rests: [
          {
            priceLogo: "KYIV",
            price: 90,
            currency: "UAH",
            quantity: 4,
            quantityType: "EQUAL",
            multiplicity: 2,
            deliveryType: "Самовывоз"
          },
          {
            priceLogo: "LWOW",
            price: 88,
            currency: "UAH",
            quantity: 10,
            quantityType: "MORE",
            multiplicity: 1,
            deliveryType: "Авто"
          }
        ],
        images: [{ image: "https://example.test/oc90.jpg" }]
      }
    ]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].externalId, "11");
  assert.equal(results[0].displayBrand, "MAHLE");
  assert.equal(results[0].title, "Масляный фильтр");
  assert.deepEqual(results[0].price, { value: 88, currency: "UAH" });
  assert.equal(results[0].multiplicity, 2);
  assert.deepEqual(results[0].images, [
    {
      type: "image",
      value: "https://example.test/oc90.jpg",
      thumbnail: "https://example.test/oc90.jpg",
      fullImagePath: "https://example.test/oc90.jpg"
    }
  ]);
  assert.deepEqual(results[0].remains, [
    {
      storageId: "KYIV",
      storageName: "KYIV",
      quantity: 4,
      quantityType: "EQUAL",
      price: 90,
      currency: "UAH",
      multiplicity: 2,
      deliveryType: "Самовывоз",
      deliveryTime: null,
      deliveryDate: "",
      deliveryPercent: null,
      isReturn: null,
      isPriceFinal: null
    },
    {
      storageId: "LWOW",
      storageName: "LWOW",
      quantity: "> 10",
      quantityType: "MORE",
      price: 88,
      currency: "UAH",
      multiplicity: 1,
      deliveryType: "Авто",
      deliveryTime: null,
      deliveryDate: "",
      deliveryPercent: null,
      isReturn: null,
      isPriceFinal: null
    }
  ]);
});

test("builds Tehnomir search URL", () => {
  assert.equal(
    buildTehnomirSearchUrl("https://tehnomir.com.ua", {
      article: "0451103079"
    }),
    "https://tehnomir.com.ua/index.php?r=product%2Fsearch&SearchForm%5Bcode%5D=0451103079&SearchForm%5BbrandId%5D=&SearchForm%5BprofitLevel%5D=10&SearchForm%5BdaysFrom%5D=&SearchForm%5BdaysTo%5D=&sort=priceOuterPrice&SearchForm%5BcatalogRequest%5D="
  );
});

test("registers Tehnomir provider only when API token is configured", () => {
  const withoutToken = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp"
    })
  );
  assert.deepEqual(
    withoutToken.map((provider) => provider.id),
    ["uniqtrade"]
  );

  const withToken = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp",
      TEHNOMIR_API_TOKEN: "secret-token"
    })
  );
  assert.deepEqual(
    withToken.map((provider) => provider.id),
    ["uniqtrade", "tehnomir"]
  );
});

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
