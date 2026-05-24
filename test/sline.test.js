import test from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.equal(results[0].providerUrl, "");
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
