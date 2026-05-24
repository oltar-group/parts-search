import { ProviderError } from "./provider-error.js";
import { redactSensitive } from "../redact.js";

const DEFAULT_PROVIDER = {
  id: "sline",
  name: "S-LINE",
  apiBaseUrl: "https://s-line.ua/api/v1",
  webBaseUrl: "https://s-line.ua"
};

export class SLineProvider {
  constructor(options = {}) {
    this.id = DEFAULT_PROVIDER.id;
    this.name = DEFAULT_PROVIDER.name;
    this.baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_PROVIDER.apiBaseUrl);
    this.webBaseUrl = trimTrailingSlash(
      options.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl
    );
    this.apiKey = options.apiKey || "";
    this.currency = options.currency || "";
    this.storageId = options.storageId || "";
    this.sendBrandFlag = options.sendBrandFlag === true;
    this.timeoutMs = options.timeoutMs || 20000;
    this.logLevel = options.logLevel || "off";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async search({ article, brand }) {
    if (!this.isConfigured()) {
      throw new ProviderError(
        "auth_not_configured",
        "S-LINE API key is not configured",
        { providerId: this.id }
      );
    }

    const normalizedArticle = String(article || "").trim();
    const params = new URLSearchParams();
    params.set("apikey", this.apiKey);
    params.set("number", normalizedArticle);
    if (brand) {
      params.set("manufacturer", brand);
    }
    if (this.sendBrandFlag) {
      params.set("brand", "");
    }
    if (this.currency) {
      params.set("currency", this.currency);
    }
    if (this.storageId) {
      params.set("storageId", this.storageId);
    }

    const path = `/parts/search?${params}`;
    const response = await this.request(path);
    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    const payload = await safeJson(response);
    this.logRawSearch({ article: normalizedArticle, brand, path, payload });

    const results = normalizeSLineSearch(payload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl
    });
    this.logSearchSummary({ article: normalizedArticle, brand, results });
    return results;
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      const code = error?.name === "AbortError" ? "timeout" : "network_error";
      const message =
        code === "timeout"
          ? `S-LINE request timed out after ${this.timeoutMs}ms`
          : "S-LINE request failed";
      throw new ProviderError(code, message, {
        providerId: this.id,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async errorFromResponse(response) {
    const payload = await safeJson(response);
    const message =
      payload?.message ||
      payload?.error ||
      payload?.Message ||
      payload?.Error ||
      `S-LINE returned HTTP ${response.status}`;
    return new ProviderError("provider_error", message, {
      providerId: this.id,
      status: response.status
    });
  }

  logRawSearch({ article, brand, path, payload }) {
    if (this.logLevel !== "raw") {
      return;
    }

    console.info(
      JSON.stringify(
        {
          event: "supplier.raw_response",
          providerId: this.id,
          article,
          brand: brand || "",
          path: redactApiKey(path),
          payload: redactSensitive(payload)
        },
        null,
        2
      )
    );
  }

  logSearchSummary({ article, brand, results }) {
    if (this.logLevel !== "summary" && this.logLevel !== "raw") {
      return;
    }

    console.info(
      JSON.stringify(
        {
          event: "supplier.search_summary",
          providerId: this.id,
          article,
          brand: brand || "",
          resultCount: results.length,
          results: results.map((result) => ({
            id: result.externalId,
            article: result.article,
            brand: result.displayBrand || result.brand,
            title: result.title,
            quantity: result.quantity,
            remains: result.remains,
            price: result.price,
            multiplicity: result.multiplicity,
            providerUrl: result.providerUrl
          }))
        },
        null,
        2
      )
    );
  }
}

export function normalizeSLineSearch(payload, provider = DEFAULT_PROVIDER) {
  return extractRows(payload).map((item, index) =>
    normalizeSLineItem(item, index, provider)
  );
}

export function normalizeSLineItem(item, index, provider = DEFAULT_PROVIDER) {
  const brand = pickString(item, [
    "manufacturer",
    "Manufacturer",
    "brand",
    "Brand",
    "trademark",
    "Trademark"
  ]);
  const article = pickString(item, [
    "number",
    "Number",
    "article",
    "Article",
    "partNumber",
    "PartNumber",
    "oem",
    "OEM"
  ]);
  const title = pickString(item, [
    "name",
    "Name",
    "description",
    "Description",
    "productName",
    "ProductName"
  ]);
  const offers = Array.isArray(item?.Offers || item?.offers)
    ? item?.Offers || item?.offers
    : [];
  const externalId = String(
    item?.id ||
      item?.Id ||
      item?.partId ||
      item?.PartId ||
      item?.productId ||
      `${article || "part"}-${index}`
  );
  const rawUrl = pickString(item, [
    "url",
    "Url",
    "rawUrl",
    "RawUrl",
    "productUrl",
    "ProductUrl",
    "detailUrl",
    "DetailUrl"
  ]);

  return {
    providerId: provider.providerId || provider.id || DEFAULT_PROVIDER.id,
    providerName: provider.providerName || provider.name || DEFAULT_PROVIDER.name,
    providerHomeUrl: provider.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl,
    externalId,
    brand,
    displayBrand: brand,
    article,
    title: title || [brand, article].filter(Boolean).join(" "),
    category: pickString(item, ["category", "Category", "group", "Group"]),
    price: normalizePrice(item, offers),
    quantity: normalizeQuantity(item),
    remains: offers.length > 0 ? normalizeOffers(offers) : pickRemains(item),
    images: [],
    hasImage: false,
    multiplicity: pickNumber(item, [
      "multiplicity",
      "Multiplicity",
      "minimumOrderQuantity",
      "MinimumOrderQuantity"
    ]),
    rawUrl,
    providerUrl: rawUrl,
    apiDetailUrl: "",
    raw: redactSensitive(item)
  };
}

function normalizeQuantity(item) {
  return pickNumber(item, [
      "quantity",
      "Quantity",
      "qty",
      "Qty",
      "available",
      "Available",
      "stock",
      "Stock",
      "balance",
      "Balance"
    ]);
}

function normalizeOffers(offers) {
  return offers.map((offer) => ({
    storageId: offer?.StorageId ?? offer?.storageId ?? null,
    storageName: offer?.StorageName || offer?.storageName || "",
    region: offer?.Region || offer?.region || "",
    quantity: offer?.Quantity ?? offer?.quantity ?? null,
    price: offer?.Price ?? offer?.price ?? null,
    purchaseReturns: offer?.PurchaseReturns ?? offer?.purchaseReturns ?? null,
    returnsDaysLimit: offer?.ReturnsDaysLimit ?? offer?.returnsDaysLimit ?? null,
    logistic: offer?.Logistic || offer?.logistic || null
  }));
}

export function buildSLineSearchUrl(baseUrl, { article, brand }) {
  const params = new URLSearchParams();
  if (article) {
    params.set("number", article);
  }
  if (brand) {
    params.set("manufacturer", brand);
  }

  return `${trimTrailingSlash(baseUrl || DEFAULT_PROVIDER.webBaseUrl)}/?${params}`;
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of [
    "data",
    "Data",
    "items",
    "Items",
    "results",
    "Results",
    "parts",
    "Parts",
    "rows",
    "Rows"
  ]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  if (payload && typeof payload === "object" && looksLikePart(payload)) {
    return [payload];
  }

  return [];
}

function looksLikePart(value) {
  return Boolean(
    value?.number ||
      value?.Number ||
      value?.article ||
      value?.Article ||
      value?.partNumber ||
      value?.PartNumber ||
      value?.PartId ||
      value?.partId
  );
}

function normalizePrice(item, offers = []) {
  if (offers.length > 0) {
    const prices = offers
      .map((offer) => pickNumber(offer, ["Price", "price"]))
      .filter((price) => price !== null);
    if (prices.length > 0) {
      return {
        value: Math.min(...prices),
        currency: pickString(item, ["currency", "Currency"]) || "UAH"
      };
    }
  }

  const price = item?.price || item?.Price || item?.customerPrice || item?.CustomerPrice;
  if (price && typeof price === "object") {
    return {
      value: Number(price.value ?? price.amount ?? price.Amount ?? price.price) || null,
      currency: price.currency?.code || price.currency || price.Currency || null
    };
  }

  const value = pickNumber(item, [
    "price",
    "Price",
    "customerPrice",
    "CustomerPrice",
    "retailPrice",
    "RetailPrice"
  ]);
  if (value === null) {
    return null;
  }

  return {
    value,
    currency: pickString(item, ["currency", "Currency"]) || "UAH"
  };
}

function pickString(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value && typeof value === "object") {
      const nested = value.name || value.Name || value.code || value.Code;
      if (nested !== undefined && nested !== null && String(nested).trim()) {
        return String(nested).trim();
      }
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function pickNumber(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
  }
  return null;
}

function pickRemains(item) {
  for (const key of [
    "remains",
    "Remains",
    "storages",
    "Storages",
    "storage",
    "Storage",
    "warehouses",
    "Warehouses",
    "stocks",
    "Stocks",
    "balances",
    "Balances"
  ]) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function redactApiKey(value) {
  return String(value).replace(/(apikey=)[^&]+/i, "$1[redacted]");
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("invalid_response", "Provider returned invalid JSON", {
      providerId: DEFAULT_PROVIDER.id
    });
  }
}
