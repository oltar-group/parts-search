import test from "node:test";
import assert from "node:assert/strict";
import {
  clientListText,
  clientUnitPrice,
  quoteTotals,
  stripArticle
} from "../public/quote-utils.js";

test("client price adds markup and rounds up to tens", () => {
  assert.equal(clientUnitPrice(100, 23), 130);
  assert.equal(clientUnitPrice(984, 0), 990);
  assert.equal(clientUnitPrice(100, 30), 130);
  assert.equal(clientUnitPrice(120, 0), 120);
  assert.equal(clientUnitPrice(1010.49, 25), 1270);
  assert.equal(clientUnitPrice(0, 30), 0);
  assert.equal(clientUnitPrice("", 30), 0);
});

test("strips the article from the part name", () => {
  assert.equal(stripArticle("Олива коробки передач 184251", "184251"), "Олива коробки передач");
  assert.equal(stripArticle("Фільтр 0 986 494 947 BOSCH", "0986494947"), "Фільтр BOSCH");
  assert.equal(stripArticle("OC90 Фільтр масляний", "OC 90"), "Фільтр масляний");
  assert.equal(stripArticle("Фільтр (OC90)", "OC90"), "Фільтр");
  assert.equal(stripArticle("Ремінь OC900", "OC90"), "Ремінь OC900");
});

test("totals and client text", () => {
  const items = [
    { title: "Олива 184251", article: "184251", price: 984, markup: 20, qty: 2 },
    { title: "Фільтр", clientName: "Фільтр масляний", article: "X", price: 100, markup: 23 }
  ];
  assert.deepEqual(quoteTotals(items), { purchase: 2068, client: 2510, profit: 442 });
  const text = clientListText(items, (value) => `${value} грн`);
  assert.equal(
    text,
    "1. Олива — 2 шт × 1190 грн = 2380 грн\n2. Фільтр масляний — 130 грн\n\nРазом: 2510 грн"
  );
});
