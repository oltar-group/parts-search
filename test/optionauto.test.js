import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { createProviders } from "../src/providers/index.js";
import {
  buildOptionAutoCatalogUrl,
  buildVortexRequest,
  formatHashValue,
  hashVortexRequest,
  mergeOptionAutoStocks,
  normalizeOptionAutoArticleSearch,
  OptionAutoProvider
} from "../src/providers/optionauto.js";

test("OptionAuto provider builds signed Vortex search and stock requests", async () => {
  const calls = [];
  const provider = new OptionAutoProvider({
    baseUrl: "https://vortex.example/front_api/",
    webBaseUrl: "https://www.optionauto.com.ua",
    apiKey: "secret-key",
    clientId: "90",
    fetchImpl: async (url, options = {}) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      assert.equal(url, "https://vortex.example/front_api");
      assert.equal(body.module, "Vortex");
      assert.equal(body.client_id, 90);
      assert.equal(body.call_type, "crm");
      assert.equal(body.hash, hashVortexRequest(body, "secret-key"));

      if (body.method === "search_articles") {
        assert.deepEqual(body.data, {
          client_id: 90,
          query: "55822",
          search_by_description: false
        });
        return jsonResponse(200, {
          items: [
            {
              id: "762780",
              code: "55822",
              trademark: "RUVILLE",
              name: "Ролик натяжний"
            }
          ],
          query: "55822"
        });
      }

      if (body.method === "get_stocks_for_batch") {
        assert.deepEqual(body.data, {
          art_ids: ["762780"],
          client_id: 90,
          second_level_substitutes: false
        });
        return jsonResponse(200, {
          item: {
            id: "762780",
            code: "55822",
            brand_name: "RUVILLE",
            description: "Ролик",
            best_prices: { uah: "880.00" },
            stock: [
              {
                wh_stock_id: "7535",
                wh_id: "-1",
                wh_name: "СКЛАД",
                qty: 3,
                supplier_id: "1",
                prices: { uah: "800.00" },
                days: 0,
                return_period: "14",
                last_update: "17.04.2024"
              }
            ]
          }
        });
      }

      throw new Error(`Unexpected method: ${body.method}`);
    }
  });

  const results = await provider.search({ article: "55822", brand: "RUVILLE" });

  assert.equal(calls.length, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, "optionauto");
  assert.equal(results[0].providerName, "OptionAuto");
  assert.equal(results[0].externalId, "762780");
  assert.equal(results[0].brand, "RUVILLE");
  assert.equal(results[0].article, "55822");
  assert.equal(results[0].title, "Ролик");
  assert.deepEqual(results[0].price, { value: 880, currency: "UAH" });
  assert.equal(
    results[0].providerUrl,
    "https://www.optionauto.com.ua/catalog?query=55822"
  );
  assert.deepEqual(results[0].remains, [
    {
      storageId: "-1",
      storageName: "СКЛАД",
      quantity: 3,
      price: 800,
      currency: "UAH",
      supplierId: "1",
      deliveryType: "In stock",
      deliveryDate: "",
      deliveryDays: 0,
      returnPeriod: 14,
      lastUpdate: "17.04.2024"
    }
  ]);
});

test("normalizes OptionAuto article search rows", () => {
  const results = normalizeOptionAutoArticleSearch({
    items: [
      {
        code: "55822",
        id: "1742488",
        trademark: "SPIDAN",
        name: "Пружина ходової частини"
      }
    ]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].externalId, "1742488");
  assert.equal(results[0].brand, "SPIDAN");
  assert.equal(results[0].article, "55822");
  assert.equal(results[0].providerUrl, "https://www.optionauto.com.ua/catalog?query=55822");
});

test("normalizes OptionAuto article rows from nested data wrappers", () => {
  const results = normalizeOptionAutoArticleSearch({
    data: {
      items: [
        {
          code: "GDB1550",
          id: "991",
          trademark: "TRW",
          name: "Колодки дискового тормоза"
        }
      ]
    }
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].externalId, "991");
  assert.equal(results[0].brand, "TRW");
  assert.equal(results[0].article, "GDB1550");
});

test("OptionAuto provider reports nested API errors instead of empty results", async () => {
  const provider = new OptionAutoProvider({
    baseUrl: "https://vortex.example/front_api",
    apiKey: "secret-key",
    clientId: "90",
    fetchImpl: async () =>
      jsonResponse(200, {
        data: {
          error: {
            id: "ERROR_ACCESS_DENIED",
            message: "Access to this data is denied"
          },
          error_description: "Access denied"
        }
      })
  });

  await assert.rejects(
    () => provider.search({ article: "GDB1550", brand: "" }),
    /Access denied/
  );
});

test("merges OptionAuto stock payloads into article rows", () => {
  const articleRows = normalizeOptionAutoArticleSearch({
    items: [{ id: "762780", code: "55822", trademark: "RUVILLE" }]
  });
  const results = mergeOptionAutoStocks(articleRows, {
    data: {
      "762780": {
        item: {
          id: "762780",
          code: "55822",
          brand_name: "RUVILLE",
          description: "Ролик",
          stock: [{ wh_name: "СКЛАД", qty: "2", prices: { uah: "100.50" } }]
        }
      }
    }
  });

  assert.equal(results[0].title, "Ролик");
  assert.deepEqual(results[0].price, { value: 100.5, currency: "UAH" });
  assert.equal(results[0].remains[0].quantity, 2);
});

test("builds Vortex hash with PHP-compatible value formatting", () => {
  const request = {
    method: "search_articles",
    rand: 37507,
    time: 1713370302,
    cookies: [],
    data: {
      client_id: 90,
      query: "01389",
      search_by_description: false
    }
  };

  assert.equal(formatHashValue(false), "");
  assert.equal(formatHashValue(true), "1");
  assert.equal(formatHashValue(["762780"]), '["762780"]');
  assert.equal(
    hashVortexRequest(request, "secret-key"),
    "85d8b25e48b585bc38bf124e0f2aa39af2c4ec15"
  );
});

test("builds OptionAuto catalog URL", () => {
  assert.equal(
    buildOptionAutoCatalogUrl("https://www.optionauto.com.ua", { article: "55822" }),
    "https://www.optionauto.com.ua/catalog?query=55822"
  );
});

test("registers OptionAuto provider only when API key and client id are configured", () => {
  const withoutOptionAuto = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp"
    })
  );
  assert.deepEqual(
    withoutOptionAuto.map((provider) => provider.id),
    ["uniqtrade"]
  );

  const withOptionAuto = createProviders(
    readConfig({
      UNIQTRADE_EMAIL: "u",
      UNIQTRADE_PASSWORD: "p",
      UNIQTRADE_BROWSER_FINGERPRINT: "fp",
      OPTIONAUTO_API_KEY: "secret-key",
      OPTIONAUTO_CLIENT_ID: "90"
    })
  );
  assert.deepEqual(
    withOptionAuto.map((provider) => provider.id),
    ["uniqtrade", "optionauto"]
  );
});

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
