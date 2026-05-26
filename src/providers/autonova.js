import { ProviderError } from "./provider-error.js";
import { redactSensitive } from "../redact.js";
import { logEvent } from "../logger.js";

const DEFAULT_PROVIDER = {
  id: "autonova",
  name: "Autonova-D",
  apiBaseUrl: "https://api.autonovad.ua/stable",
  webBaseUrl: "https://autonovad.ua"
};

export class AutonovaProvider {
  constructor(options = {}) {
    this.id = DEFAULT_PROVIDER.id;
    this.name = DEFAULT_PROVIDER.name;
    this.baseUrl = trimTrailingSlash(
      options.baseUrl || DEFAULT_PROVIDER.apiBaseUrl
    );
    this.webBaseUrl = trimTrailingSlash(
      options.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl
    );
    this.login = options.login || "";
    this.password = options.password || "";
    this.clientId = options.clientId || "";
    this.authLoginField = options.authLoginField || "login";
    this.filterByResultCategory = options.filterByResultCategory || "1,2,3";
    this.maxDetails = parseInt(options.maxDetails || "8", 10);
    this.timeoutMs = options.timeoutMs || 20000;
    this.logLevel = options.logLevel || "off";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.token = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(this.login && this.password && this.clientId);
  }

  async search({ article, brand }) {
    if (!this.isConfigured()) {
      throw new ProviderError(
        "auth_not_configured",
        "Autonova-D credentials are not configured",
        { providerId: this.id }
      );
    }

    const normalizedArticle = String(article || "").trim();
    const normalizedBrand = String(brand || "").trim();
    const articlePath = `/api/v1/wares/article/${encodeURIComponent(normalizedArticle)}`;
    const articlePayload = await this.getJson(articlePath);
    this.logRawSearch({
      article: normalizedArticle,
      brand: normalizedBrand,
      path: articlePath,
      payload: articlePayload
    });

    const articleRows = normalizeAutonovaArticleSearch(articlePayload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl
    }).filter((result) => matchesBrandFilter(result, normalizedBrand));

    const rowsWithPartId = articleRows.filter((result) => result.externalId);
    const detailRows = await Promise.all(
      rowsWithPartId.slice(0, this.maxDetails).map((result) =>
        this.getDetailResult(result, normalizedArticle, normalizedBrand)
      )
    );

    const byId = new Map();
    for (const result of [...articleRows, ...detailRows.filter(Boolean)]) {
      byId.set(result.externalId || `${result.article}-${result.brand}`, result);
    }

    const results = [...byId.values()];
    this.logSearchSummary({
      article: normalizedArticle,
      brand: normalizedBrand,
      results
    });
    return results;
  }

  async getDetailResult(result, article, brand) {
    const params = new URLSearchParams();
    if (this.filterByResultCategory) {
      params.set("FilterByResultCategory", this.filterByResultCategory);
    }

    const path =
      `/api/v1/wares/clients/${encodeURIComponent(this.clientId)}` +
      `/parts/${encodeURIComponent(result.externalId)}?${params}`;
    const payload = await this.getJson(path);
    this.logRawSearch({ article, brand, path, payload });
    const detailResults = normalizeAutonovaDetailSearch(payload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl,
      fallback: result
    }).filter((entry) => matchesBrandFilter(entry, brand));

    if (detailResults.length === 0) {
      return {
        ...result,
        remains: []
      };
    }

    return mergeAutonovaResults(result, detailResults);
  }

  async getJson(path) {
    const response = await this.authenticatedRequest(path);
    return safeJson(response);
  }

  async authenticatedRequest(path) {
    await this.ensureToken();

    let response = await this.request(path, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`
      }
    });

    if (response.status === 401 || response.status === 403) {
      await this.refreshAuthToken();
      response = await this.request(path, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`
        }
      });
    }

    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    return response;
  }

  async ensureToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return;
    }

    const body = {
      [this.authLoginField]: this.login,
      password: this.password
    };

    const response = await this.request("/api/v1/auth/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await this.errorFromResponse(response, "auth_failed");
    }

    this.setAuthPayload(await safeJson(response));
  }

  async refreshAuthToken() {
    if (!this.refreshToken) {
      this.token = null;
      this.tokenExpiresAt = 0;
      await this.ensureToken();
      return;
    }

    const response = await this.request(
      `/api/v1/auth/token/refresh/${encodeURIComponent(this.refreshToken)}`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) {
      this.token = null;
      this.refreshToken = null;
      this.tokenExpiresAt = 0;
      throw await this.errorFromResponse(response, "auth_failed");
    }

    this.setAuthPayload(await safeJson(response));
  }

  setAuthPayload(payload) {
    this.token =
      payload?.access_token ||
      payload?.accessToken ||
      payload?.token ||
      payload?.Token ||
      null;
    this.refreshToken =
      payload?.refresh_token ||
      payload?.refreshToken ||
      payload?.RefreshToken ||
      this.refreshToken ||
      null;

    if (!this.token) {
      throw new ProviderError(
        "invalid_response",
        "Autonova-D auth response did not include an access token",
        { providerId: this.id }
      );
    }

    const expiresIn = pickNumber(payload, ["expires_in", "expiresIn"]) || 300;
    this.tokenExpiresAt = Date.now() + Math.max(expiresIn - 30, 1) * 1000;
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
          ? `Autonova-D request timed out after ${this.timeoutMs}ms`
          : "Autonova-D request failed";
      throw new ProviderError(code, message, {
        providerId: this.id,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async errorFromResponse(response, fallbackCode = "provider_error") {
    const payload = await safeJson(response);
    const message =
      pickErrorMessage(payload) || `Autonova-D returned HTTP ${response.status}`;
    const code =
      response.status === 401 || response.status === 403
        ? "auth_failed"
        : fallbackCode;
    return new ProviderError(code, message, {
      providerId: this.id,
      status: response.status
    });
  }

  logRawSearch({ article, brand, path, payload }) {
    if (this.logLevel !== "raw") {
      return;
    }

    logEvent({
          event: "supplier.raw_response",
          providerId: this.id,
          article,
          brand: brand || "",
          path,
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

export function normalizeAutonovaArticleSearch(
  payload,
  provider = DEFAULT_PROVIDER
) {
  return extractRows(payload).map((item, index) =>
    normalizeAutonovaItem(item, index, provider)
  );
}

export function normalizeAutonovaDetailSearch(
  payload,
  provider = DEFAULT_PROVIDER
) {
  return extractRows(payload).map((item, index) =>
    normalizeAutonovaItem(item, index, provider)
  );
}

export function normalizeAutonovaItem(item, index, provider = DEFAULT_PROVIDER) {
  const fallback = provider.fallback || {};
  const brand =
    pickString(item, [
      "brand",
      "Brand",
      "brandName",
      "BrandName",
      "producerName",
      "ProducerName",
      "producer",
      "Producer",
      "manufacturer",
      "Manufacturer",
      "wareManufacturer",
      "WareManufacturer"
    ]) || fallback.brand || "";
  const article =
    pickString(item, [
      "article",
      "Article",
      "artId",
      "ArtId",
      "articleId",
      "ArticleId",
      "wareArticle",
      "WareArticle",
      "code",
      "Code",
      "partCode",
      "PartCode"
    ]) || fallback.article || "";
  const title =
    pickString(item, [
      "name",
      "Name",
      "wareName",
      "WareName",
      "partName",
      "PartName",
      "description",
      "Description",
      "descriptionUa",
      "DescriptionUa",
      "descriptionRus",
      "DescriptionRus"
    ]) ||
    fallback.title ||
    [brand, article].filter(Boolean).join(" ");
  const externalId = String(
    pickValue(item, [
      "partId",
      "PartId",
      "wareId",
      "WareId",
      "id",
      "Id",
      "uid",
      "Uid"
    ]) || fallback.externalId || `${article || "part"}-${index}`
  );
  const remains = normalizeRemains(item);

  return {
    providerId: provider.providerId || provider.id || DEFAULT_PROVIDER.id,
    providerName: provider.providerName || provider.name || DEFAULT_PROVIDER.name,
    providerHomeUrl: provider.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl,
    externalId,
    brand,
    displayBrand: brand,
    article,
    title,
    category: pickString(item, ["category", "Category", "group", "Group"]),
    price: normalizePrice(item, remains),
    quantity: null,
    remains,
    images: normalizeImages(pickArray(item, ["images", "Images"])),
    hasImage: normalizeImages(pickArray(item, ["images", "Images"])).length > 0,
    multiplicity: pickNumber(item, ["saleQnt", "SaleQnt", "multiplicity"]),
    rawUrl: "",
    providerUrl: "",
    apiDetailUrl: "",
    raw: redactSensitive(item)
  };
}

function mergeAutonovaResults(base, details) {
  const remains = details.flatMap((detail) =>
    Array.isArray(detail.remains) ? detail.remains : []
  );
  const cheapest = details.find((detail) => detail.price?.value !== undefined);
  return {
    ...base,
    ...details[0],
    externalId: base.externalId,
    brand: details[0]?.brand || base.brand,
    displayBrand: details[0]?.displayBrand || base.displayBrand,
    article: details[0]?.article || base.article,
    title: details[0]?.title || base.title,
    price: cheapest?.price || base.price,
    remains
  };
}

function normalizeRemains(item) {
  const direct = pickArray(item, [
    "remains",
    "Remains",
    "rests",
    "Rests",
    "stocks",
    "Stocks",
    "offers",
    "Offers",
    "warehouses",
    "Warehouses",
    "result",
    "Result"
  ]);

  if (direct) {
    return direct.map(normalizeRemainRow);
  }

  if (looksLikeRemain(item)) {
    return [normalizeRemainRow(item)];
  }

  return null;
}

function normalizeRemainRow(row) {
  return {
    storageId: pickValue(row, ["warehouseId", "WarehouseId", "storeId", "StoreId"]),
    storageName:
      pickString(row, [
        "warehouseName",
        "WarehouseName",
        "storeName",
        "StoreName",
        "affiliateName",
        "AffiliateName",
        "resultCategory",
        "ResultCategory"
      ]) || "Autonova-D",
    quantity: pickNumber(row, [
      "quantity",
      "Quantity",
      "qnt",
      "Qnt",
      "wareQnt",
      "WareQnt",
      "availableQuantity",
      "AvailableQuantity",
      "stock",
      "Stock"
    ]),
    price: pickNumber(row, [
      "price",
      "Price",
      "clientPrice",
      "ClientPrice",
      "warePrice",
      "WarePrice"
    ]),
    currency: pickString(row, ["currency", "Currency"]) || "UAH",
    supplierId: pickValue(row, ["supplierId", "SupplierId", "supplierUid", "SupplierUid"]),
    deliveryType: pickString(row, ["deliveryType", "DeliveryType"]),
    deliveryDate: pickString(row, ["deliveryDate", "DeliveryDate"]),
    resultCategory: pickValue(row, ["resultCategory", "ResultCategory"])
  };
}

function normalizePrice(item, remains) {
  const direct = pickNumber(item, [
    "price",
    "Price",
    "clientPrice",
    "ClientPrice",
    "warePrice",
    "WarePrice"
  ]);
  if (direct !== null) {
    return {
      value: direct,
      currency: pickString(item, ["currency", "Currency"]) || "UAH"
    };
  }

  const prices = (remains || [])
    .map((remain) => remain.price)
    .filter((price) => price !== null && price !== undefined);
  if (prices.length === 0) {
    return null;
  }

  return {
    value: Math.min(...prices),
    currency: (remains || []).find((remain) => remain.price === Math.min(...prices))
      ?.currency || "UAH"
  };
}

function normalizeImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((entry) => {
      const url =
        typeof entry === "string"
          ? entry
          : pickString(entry, ["url", "Url", "image", "Image", "src", "Src"]);
      if (!url) {
        return null;
      }
      return {
        type: "image",
        value: url,
        thumbnail: url,
        fullImagePath: url
      };
    })
    .filter(Boolean);
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
    "wares",
    "Wares",
    "parts",
    "Parts",
    "content",
    "Content"
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
    value?.partId ||
      value?.PartId ||
      value?.wareId ||
      value?.WareId ||
      value?.article ||
      value?.Article ||
      value?.wareArticle ||
      value?.WareArticle
  );
}

function looksLikeRemain(value) {
  return Boolean(
    value?.warehouseId ||
      value?.WarehouseId ||
      value?.quantity ||
      value?.Quantity ||
      value?.qnt ||
      value?.Qnt ||
      value?.clientPrice ||
      value?.ClientPrice
  );
}

function matchesBrandFilter(result, brand) {
  if (!brand) {
    return true;
  }
  return normalizeComparable(result.displayBrand || result.brand) === normalizeComparable(brand);
}

function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase();
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
    if (value !== undefined && value !== null && value !== "") {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
  }
  return null;
}

function pickValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function pickErrorMessage(payload) {
  return (
    payload?.message ||
    payload?.Message ||
    payload?.error ||
    payload?.Error ||
    payload?.errors ||
    payload?.Errors ||
    ""
  );
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
