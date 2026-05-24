import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSLineCabinetSearchUrl,
  normalizeSLineSearch,
  SLineProvider
} from "../src/providers/sline.js";
import { readConfig } from "../src/config.js";
import { createProviders } from "../src/providers/index.js";

test("S-LINE provider builds search request with API key and manufacturer", async () => {
  const calls = [];
  const provider = new SLineProvider({
    baseUrl: "https://s-line.ua/api/v1",
    apiKey: "secret-key",
    currency: "UAH",
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse(200, {
        data: [
          {
            PartId: 7949,
            Number: "4881533090",
            Manufacturer: "TOYOTA",
            Name: "Stabilizer bushing",
            Price: 100,
            Quantity: 2
          }
        ]
      });
    }
  });

  const results = await provider.search({
    article: "4881533090",
    brand: "TOYOTA"
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, "sline");
  assert.equal(results[0].providerHomeUrl, "https://s-line.ua");
  assert.equal(results[0].article, "4881533090");
  assert.equal(results[0].brand, "TOYOTA");
  assert.equal(results[0].price.value, 100);
  assert.match(calls[0], /apikey=secret-key/);
  assert.match(calls[0], /number=4881533090/);
  assert.match(calls[0], /manufacturer=TOYOTA/);
  assert.match(calls[0], /currency=UAH/);
});

test("normalizes flexible S-LINE response rows", () => {
  const results = normalizeSLineSearch({
    Results: [
      {
        Id: 1,
        Article: "OC90",
        Brand: "MAHLE",
        Description: "Oil filter",
        CustomerPrice: { amount: 88.5, currency: "UAH" },
        Balance: 4,
        Storages: [{ StorageName: "Kyiv", Quantity: 4 }]
      }
    ]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].externalId, "1");
  assert.equal(results[0].article, "OC90");
  assert.equal(results[0].displayBrand, "MAHLE");
  assert.deepEqual(results[0].price, { value: 88.5, currency: "UAH" });
  assert.equal(results[0].quantity, 4);
  assert.deepEqual(results[0].remains, [
    { StorageName: "Kyiv", Quantity: 4 }
  ]);
  assert.equal(results[0].providerUrl, "https://s-line.ua/Home/Index?search=OC90");
});

test("uses direct S-LINE provider URL only when response includes one", () => {
  const results = normalizeSLineSearch({
    data: [
      {
        PartId: 1,
        Number: "4881533090",
        Manufacturer: "TOYOTA",
        ProductUrl: "https://s-line.ua/cabinet/parts/1"
      }
    ]
  });

  assert.equal(results[0].providerUrl, "https://s-line.ua/cabinet/parts/1");
});

test("builds S-LINE cabinet search URL", () => {
  assert.equal(
    buildSLineCabinetSearchUrl("https://s-line.ua", {
      article: "0451103079"
    }),
    "https://s-line.ua/Home/Index?search=0451103079"
  );
});

test("normalizes S-LINE offers as remains and minimum price without aggregating quantity", () => {
  const results = normalizeSLineSearch({
    Parts: [
      {
        Id: 186304,
        Manufacturer: "BOSCH",
        Number: "0451103079",
        Name: "ФІЛЬТР ОЛИВИ",
        Offers: [
          {
            StorageId: 522,
            Region: "Україна",
            StorageName: "TRLK",
            Quantity: 12,
            Price: 114.92,
            Logistic: {
              Status: 1,
              DeliveryType: "Авто",
              ShippingDate: "2026-05-25T14:00:00",
              DeliveryAmount: 0,
              Message: ""
            }
          },
          {
            StorageId: 145,
            Region: "Україна",
            StorageName: "KVOK",
            Quantity: 16,
            Price: 130.39,
            Logistic: {
              Status: 1,
              DeliveryType: "Авто",
              ShippingDate: "2026-05-26T12:00:00",
              DeliveryAmount: 0,
              Message: ""
            }
          }
        ]
      }
    ],
    Currency: "UAH"
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].quantity, null);
  assert.deepEqual(results[0].price, { value: 114.92, currency: "UAH" });
  assert.deepEqual(results[0].remains, [
    {
      storageId: 522,
      storageName: "TRLK",
      region: "Україна",
      quantity: 12,
      price: 114.92,
      purchaseReturns: null,
      returnsDaysLimit: null,
      logistic: {
        Status: 1,
        DeliveryType: "Авто",
        ShippingDate: "2026-05-25T14:00:00",
        DeliveryAmount: 0,
        Message: ""
      }
    },
    {
      storageId: 145,
      storageName: "KVOK",
      region: "Україна",
      quantity: 16,
      price: 130.39,
      purchaseReturns: null,
      returnsDaysLimit: null,
      logistic: {
        Status: 1,
        DeliveryType: "Авто",
        ShippingDate: "2026-05-26T12:00:00",
        DeliveryAmount: 0,
        Message: ""
      }
    }
  ]);
});

test("registers S-LINE provider only when API key is configured", () => {
  const withoutKey = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp"
    })
  );
  assert.deepEqual(
    withoutKey.map((provider) => provider.id),
    ["uniqtrade"]
  );

  const withKey = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp",
      SLINE_API_KEY: "secret-key"
    })
  );
  assert.deepEqual(
    withKey.map((provider) => provider.id),
    ["uniqtrade", "sline"]
  );
});

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
