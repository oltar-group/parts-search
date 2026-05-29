import { createHash } from "node:crypto";
import { ProviderError } from "./provider-error.js";
import { redactSensitive } from "../redact.js";
import { logEvent } from "../logger.js";

const DEFAULT_PROVIDER = {
  id: "optionauto",
  name: "OptionAuto",
  apiBaseUrl: "https://t2.dev.vortex-services.com/front_api",
  webBaseUrl: "https://www.optionauto.com.ua"
};

export class OptionAutoProvider {
  constructor(options = {}) {
    this.id = DEFAULT_PROVIDER.id;
    this.name = DEFAULT_PROVIDER.name;
    this.baseUrl = options.baseUrl || DEFAULT_PROVIDER.apiBaseUrl;
    this.webBaseUrl = trimTrailingSlash(
      options.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl
    );
    this.apiKey = options.apiKey || "";
    this.clientId = options.clientId || "";
    this.maxDetails = parseInt(options.maxDetails || "8", 10);
    this.timeoutMs = options.timeoutMs || 20000;
    this.logLevel = options.logLevel || "off";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.clientId);
  }

  async search({ article, brand }) {
    if (!this.isConfigured()) {
      throw new ProviderError(
        "auth_not_configured",
        "OptionAuto API key and client id are not configured",
        { providerId: this.id }
      );
    }

    const normalizedArticle = String(article || "").trim();
    const normalizedBrand = String(brand || "").trim();
    const searchPayload = await this.callVortex("search_articles", {
      client_id: Number(this.clientId),
      query: normalizedArticle,
      search_by_description: false
    });
    this.logRawSearch({
      article: normalizedArticle,
      brand: normalizedBrand,
      method: "search_articles",
      payload: searchPayload
    });

    const articleRows = normalizeOptionAutoArticleSearch(searchPayload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl
    }).filter((result) => matchesBrandFilter(result, normalizedBrand));

    const ids = articleRows
      .map((result) => result.externalId)
      .filter(Boolean)
      .slice(0, this.maxDetails);
    if (ids.length === 0) {
      this.logSearchSummary({
        article: normalizedArticle,
        brand: normalizedBrand,
        results: articleRows
      });
      return articleRows;
    }

    const stockPayload = await this.callVortex("get_stocks_for_batch", {
      art_ids: ids,
      client_id: Number(this.clientId),
      second_level_substitutes: false
    });
    this.logRawSearch({
      article: normalizedArticle,
      brand: normalizedBrand,
      method: "get_stocks_for_batch",
      payload: stockPayload
    });

    const results = mergeOptionAutoStocks(articleRows, stockPayload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl
    });
    this.logSearchSummary({
      article: normalizedArticle,
      brand: normalizedBrand,
      results
    });
    return results;
  }

  async callVortex(method, data) {
    const requestPayload = buildVortexRequest({
      method,
      data,
      apiKey: this.apiKey,
      clientId: this.clientId
    });
    const response = await this.request({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    const payload = await safeJson(response);
    if (payload?.success === false || payload?.error || payload?.errors) {
      throw new ProviderError(
        "provider_error",
        pickErrorMessage(payload) || "OptionAuto request failed",
        { providerId: this.id }
      );
    }
    return payload;
  }

  async request(options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(this.baseUrl, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      const code = error?.name === "AbortError" ? "timeout" : "network_error";
      const message =
        code === "timeout"
          ? `OptionAuto request timed out after ${this.timeoutMs}ms`
          : "OptionAuto request failed";
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
    return new ProviderError(
      response.status === 401 || response.status === 403
        ? "auth_failed"
        : "provider_error",
      pickErrorMessage(payload) || `OptionAuto returned HTTP ${response.status}`,
      { providerId: this.id, status: response.status }
    );
  }

  logRawSearch({ article, brand, method, payload }) {
    if (this.logLevel !== "raw") {
      return;
    }

    logEvent({
      event: "supplier.raw_response",
      providerId: this.id,
      article,
      brand: brand || "",
      path: method,
      payload: redactSensitive(payload)
    });
  }

  logSearchSummary({ article, brand, results }) {
    if (this.logLevel !== "summary" && this.logLevel !== "raw") {
      return;
    }

    logEvent({
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
    });
  }
}

export function buildVortexRequest({
  method,
  data,
  apiKey,
  clientId,
  rand = randomFiveDigits(),
  time = Math.floor(Date.now() / 1000),
  cookies = []
}) {
  const request = {
    module: "Vortex",
    method,
    client_id: Number(clientId),
    rand,
    time,
    call_type: "crm",
    data,
    cookies
  };
  request.hash = hashVortexRequest(request, apiKey);
  return request;
}

export function hashVortexRequest(request, apiKey) {
  const data = request.data || {};
  const joinedData = Object.keys(data)
    .sort()
    .map((key) => `${key}=${formatHashValue(data[key])}`)
    .join("&");
  const source =
    `${request.rand}+${request.time}+${apiKey}+${request.method}+` +
    `${JSON.stringify(request.cookies || [])}+data:${joinedData}`;
  return createHash("sha1").update(source).digest("hex");
}

export function formatHashValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value === false || value === null || value === undefined) {
    return "";
  }
  if (value === true) {
    return "1";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function normalizeOptionAutoArticleSearch(
  payload,
  provider = DEFAULT_PROVIDER
) {
  return extractArticleRows(payload).map((item, index) =>
    normalizeOptionAutoArticle(item, index, provider)
  );
}

function normalizeOptionAutoArticle(item, index, provider = DEFAULT_PROVIDER) {
  const article = pickString(item, ["code", "Code", "article", "Article"]);
  const brand = pickString(item, [
    "trademark",
    "Trademark",
    "brand_name",
    "brandName",
    "BrandName",
    "brand"
  ]);
  const title = pickString(item, ["name", "Name", "description", "Description"]);
  const externalId = String(item?.id || item?.Id || `${article || "part"}-${index}`);

  return {
    providerId: provider.providerId || provider.id || DEFAULT_PROVIDER.id,
    providerName: provider.providerName || provider.name || DEFAULT_PROVIDER.name,
    providerHomeUrl: provider.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl,
    externalId,
    brand,
    displayBrand: brand,
    article,
    title: title || [brand, article].filter(Boolean).join(" "),
    category: "",
    price: null,
    quantity: null,
    remains: null,
    images: [],
    hasImage: false,
    multiplicity: null,
    rawUrl: "",
    providerUrl: buildOptionAutoCatalogUrl(provider.webBaseUrl, { article }),
    apiDetailUrl: "",
    raw: redactSensitive(item)
  };
}

export function mergeOptionAutoStocks(
  articleRows,
  stockPayload,
  provider = DEFAULT_PROVIDER
) {
  const stockItems = extractStockItems(stockPayload).map((item, index) =>
    normalizeOptionAutoStockItem(item, index, provider)
  );
  const byId = new Map(stockItems.map((item) => [item.externalId, item]));

  return articleRows.map((row) => {
    const stock = byId.get(row.externalId);
    if (!stock) {
      return row;
    }

    return {
      ...row,
      ...stock,
      externalId: row.externalId,
      brand: stock.brand || row.brand,
      displayBrand: stock.displayBrand || row.displayBrand,
      article: stock.article || row.article,
      title: stock.title || row.title,
      providerUrl: row.providerUrl || stock.providerUrl
    };
  });
}

function normalizeOptionAutoStockItem(item, index, provider = DEFAULT_PROVIDER) {
  const article = pickString(item, ["code", "Code", "article", "Article"]);
  const brand = pickString(item, ["brand_name", "brandName", "BrandName", "brand"]);
  const title = pickString(item, [
    "description",
    "Description",
    "extended_description",
    "name",
    "Name"
  ]);
  const externalId = String(item?.id || item?.Id || `${article || "part"}-${index}`);
  const remains = normalizeStocks(pickArray(item, ["stock", "Stock", "stocks", "Stocks"]));

  return {
    providerId: provider.providerId || provider.id || DEFAULT_PROVIDER.id,
    providerName: provider.providerName || provider.name || DEFAULT_PROVIDER.name,
    providerHomeUrl: provider.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl,
    externalId,
    brand,
    displayBrand: brand,
    article,
    title: title || [brand, article].filter(Boolean).join(" "),
    category: "",
    price: normalizePrice(item, remains),
    quantity: null,
    remains,
    images: [],
    hasImage: false,
    multiplicity: null,
    rawUrl: "",
    providerUrl: buildOptionAutoCatalogUrl(provider.webBaseUrl, { article }),
    apiDetailUrl: "",
    raw: redactSensitive(item)
  };
}

function normalizeStocks(stocks) {
  if (!Array.isArray(stocks)) {
    return null;
  }

  return stocks.map((stock) => ({
    storageId: stock?.wh_id ?? stock?.warehouseId ?? stock?.wh_stock_id ?? null,
    storageName: pickString(stock, ["wh_name", "warehouseName", "name"]) || "OptionAuto",
    quantity: pickNumber(stock, ["qty", "quantity", "Quantity"]),
    price: pickPrice(stock),
    currency: "UAH",
    supplierId: stock?.supplier_id ?? stock?.supplierId ?? null,
    deliveryType: pickDeliveryType(stock),
    deliveryDate: "",
    deliveryDays: pickNumber(stock, ["days", "delivery_to_wh"]),
    returnPeriod: pickNumber(stock, ["return_period"]),
    lastUpdate: pickString(stock, ["last_update"])
  }));
}

function normalizePrice(item, remains) {
  const best = item?.best_prices || item?.bestPrices || item?.BestPrices;
  const bestUah = numericValue(best?.uah || best?.UAH);
  if (bestUah !== null) {
    return { value: bestUah, currency: "UAH" };
  }

  const prices = (remains || [])
    .map((remain) => remain.price)
    .filter((price) => price !== null && price !== undefined);
  if (prices.length === 0) {
    return null;
  }
  return { value: Math.min(...prices), currency: "UAH" };
}

function pickPrice(stock) {
  const prices = stock?.prices || stock?.Prices || stock?.retail_prices;
  const uah = numericValue(prices?.uah || prices?.UAH);
  if (uah !== null) {
    return uah;
  }
  return pickNumber(stock, ["price", "retail_price", "base_price"]);
}

function pickDeliveryType(stock) {
  if (Number(stock?.days) === 0 || Number(stock?.delivery_to_wh) === 0) {
    return "In stock";
  }
  return "Order";
}

function extractArticleRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  for (const key of ["items", "Items", "results", "Results", "data", "Data"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }
  return [];
}

function extractStockItems(payload) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap(extractStockItems);
  }
  if (payload.item && typeof payload.item === "object") {
    return [payload.item];
  }
  if (looksLikeStockPart(payload)) {
    return [payload];
  }
  if (payload.items && typeof payload.items === "object") {
    return extractStockItems(payload.items);
  }
  if (payload.data && typeof payload.data === "object") {
    return extractStockItems(payload.data);
  }
  if (typeof payload === "object") {
    return Object.values(payload).flatMap((value) =>
      value && typeof value === "object" ? extractStockItems(value) : []
    );
  }
  return [];
}

function looksLikeStockPart(value) {
  return Boolean(
    value?.id &&
      (value?.code || value?.brand_name || value?.description || value?.stock)
  );
}

export function buildOptionAutoCatalogUrl(baseUrl, { article }) {
  const params = new URLSearchParams();
  if (article) {
    params.set("query", article);
  }
  return `${trimTrailingSlash(baseUrl || DEFAULT_PROVIDER.webBaseUrl)}/catalog?${params}`;
}

function matchesBrandFilter(result, brand) {
  if (!brand) {
    return true;
  }
  return normalizeComparable(result.displayBrand || result.brand) === normalizeComparable(brand);
}

function normalizeComparable(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function pickArray(item, keys) {
  for (const key of keys) {
    if (Array.isArray(item?.[key])) {
      return item[key];
    }
  }
  return null;
}

function pickString(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function pickNumber(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    const number = numericValue(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function numericValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickErrorMessage(payload) {
  const message =
    payload?.message ||
    payload?.Message ||
    payload?.error ||
    payload?.Error ||
    payload?.errors ||
    payload?.Errors ||
    "";
  if (!message) {
    return "";
  }
  return typeof message === "string" ? message : JSON.stringify(redactSensitive(message));
}

function randomFiveDigits() {
  return Math.floor(10000 + Math.random() * 90000);
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
