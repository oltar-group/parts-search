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
    this.authBaseUrl = trimTrailingSlash(
      options.authBaseUrl || options.baseUrl || DEFAULT_PROVIDER.apiBaseUrl
    );
    this.webBaseUrl = trimTrailingSlash(
      options.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl
    );
    this.login = options.login || "";
    this.password = options.password || "";
    this.clientId = options.clientId || "";
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
      username: this.login,
      password: this.password
    };

    const response = await this.request("/api/v1/auth/token", {
      baseUrl: this.authBaseUrl,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await this.errorFromResponse(
        response,
        "auth_failed",
        `auth base ${this.authBaseUrl}; auth field username`
      );
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
      {
        baseUrl: this.authBaseUrl,
        headers: { Accept: "application/json" }
      }
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
    const baseUrl = options.baseUrl || this.baseUrl;
    const requestOptions = { ...options };
    delete requestOptions.baseUrl;

    try {
      return await this.fetchImpl(`${baseUrl}${path}`, {
        ...requestOptions,
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

  async errorFromResponse(response, fallbackCode = "provider_error", context = "") {
    const { payload, text } = await readJsonOrText(response);
    const message =
      pickErrorMessage(payload) ||
      [
        `Autonova-D returned HTTP ${response.status}`,
        context,
        summarizeResponseText(text)
      ].filter(Boolean).join(": ");
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
      "WareManufacturer",
      "supplierBrandName",
      "SupplierBrandName"
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
      "wareNumber",
      "WareNumber",
      "supplierWareNumber",
      "SupplierWareNumber",
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
      "supplierWareName",
      "SupplierWareName",
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
  const images = normalizeImagesFromItem(item);

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
    images,
    hasImage: images.length > 0 || Boolean(item?.hasImage || item?.HasImage),
    multiplicity: pickNumber(item, [
      "useMultipleQnt",
      "UseMultipleQnt",
      "multiplicity",
      "Multiplicity",
      "saleQnt",
      "SaleQnt"
    ]),
    rawUrl: "",
    providerUrl: buildAutonovaSearchUrl(provider.webBaseUrl, { article }),
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

export function buildAutonovaSearchUrl(baseUrl, { article }) {
  const params = new URLSearchParams();
  params.set("query", article || "");

  return `${trimTrailingSlash(baseUrl || DEFAULT_PROVIDER.webBaseUrl)}/ru/search-products/?${params}`;
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
    "Result",
    "WareListItem"
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
    storageId: pickValue(row, [
      "warehouseId",
      "WarehouseId",
      "supplierWarehouseId",
      "SupplierWarehouseId",
      "storeId",
      "StoreId"
    ]),
    storageName:
      pickString(row, [
        "warehouseName",
        "WarehouseName",
        "supplierWarehouseName",
        "SupplierWarehouseName",
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
      "availableQnt",
      "AvailableQnt",
      "stock",
      "Stock"
    ]),
    quantityLabel: pickString(row, ["availableQntstr", "AvailableQntstr"]),
    price: pickNumber(row, [
      "price",
      "Price",
      "clientPrice",
      "ClientPrice",
      "clientSalePrice",
      "ClientSalePrice",
      "priceBeforeSale",
      "PriceBeforeSale",
      "warePrice",
      "WarePrice"
    ]),
    currency: pickString(row, ["currency", "Currency"]) || "UAH",
    supplierId: pickValue(row, ["supplierId", "SupplierId", "supplierUid", "SupplierUid"]),
    deliveryType: pickString(row, ["deliveryType", "DeliveryType"]),
    deliveryDate: pickString(row, ["deliveryDate", "DeliveryDate"]),
    deliveryDays: pickNumber(row, ["deliveryDays", "DeliveryDays"]),
    deliveryTerm: pickString(row, ["deliveryTerm", "DeliveryTerm"]),
    resultCategory: pickValue(row, ["resultCategory", "ResultCategory"])
  };
}

function normalizePrice(item, remains) {
  const direct = pickNumber(item, [
    "price",
    "Price",
    "clientPrice",
    "ClientPrice",
    "clientSalePrice",
    "ClientSalePrice",
    "priceBeforeSale",
    "PriceBeforeSale",
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

function normalizeImagesFromItem(item) {
  const images = normalizeImages(pickArray(item, ["images", "Images"]));
  const directUrls = [
    pickString(item, ["imageUrl", "ImageUrl"]),
    pickString(item, ["imageId", "ImageId"])
  ].filter((url) => url && isHttpUrl(url));
  const imageCodes = pickArray(item, ["imageCodes", "ImageCodes"]) || [];

  return [
    ...images,
    ...directUrls.map((url) => imageFromUrl(url)),
    ...normalizeImages(imageCodes.filter(isHttpUrl))
  ];
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
      return imageFromUrl(url);
    })
    .filter(Boolean);
}

function imageFromUrl(url) {
  return {
    type: "image",
    value: url,
    thumbnail: url,
    fullImagePath: url
  };
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of [
    "items",
    "Items",
    "results",
    "Results",
    "wares",
    "Wares",
    "parts",
    "Parts",
    "content",
    "Content",
    "wareListItem",
    "WareListItem"
  ]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  for (const key of ["data", "Data", "response", "Response"]) {
    if (payload?.[key] && typeof payload[key] === "object") {
      const nested = extractRows(payload[key]);
      if (nested.length > 0) {
        return nested;
      }
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
      value?.id ||
      value?.Id ||
      value?.article ||
      value?.Article ||
      value?.wareArticle ||
      value?.WareArticle ||
      value?.wareNumber ||
      value?.WareNumber
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
      value?.availableQnt ||
      value?.AvailableQnt ||
      value?.clientPrice ||
      value?.ClientPrice ||
      value?.supplierWarehouseId ||
      value?.SupplierWarehouseId
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
  if (typeof message === "string") {
    return message;
  }
  return JSON.stringify(redactSensitive(message));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

async function safeJson(response) {
  const { payload, text } = await readJsonOrText(response);
  if (!text) {
    return null;
  }

  if (payload !== null) {
    return payload;
  }

  throw new ProviderError(
    "invalid_response",
    [
      `Provider returned invalid JSON from HTTP ${response.status}`,
      summarizeResponseText(text)
    ].filter(Boolean).join(": "),
    {
      providerId: DEFAULT_PROVIDER.id,
      status: response.status
    }
  );
}

async function readJsonOrText(response) {
  const text = await response.text();
  if (!text) {
    return { payload: null, text: "" };
  }

  try {
    return { payload: JSON.parse(text), text };
  } catch {
    return { payload: null, text };
  }
}

function summarizeResponseText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return redactSensitive(normalized.slice(0, 180));
}
