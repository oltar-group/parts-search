import { ProviderError } from "./provider-error.js";
import { redactSensitive } from "../redact.js";

const DEFAULT_PROVIDER = {
  id: "uniqtrade",
  name: "UniqTrade",
  webBaseUrl: "https://order24.utr.ua",
  apiBaseUrl: "https://order24-api.utr.ua"
};

export class UniqTradeProvider {
  constructor(options = {}) {
    this.id = DEFAULT_PROVIDER.id;
    this.name = DEFAULT_PROVIDER.name;
    this.baseUrl = trimTrailingSlash(
      options.baseUrl || DEFAULT_PROVIDER.apiBaseUrl
    );
    this.webBaseUrl = trimTrailingSlash(
      options.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl
    );
    this.email = options.email || "";
    this.password = options.password || "";
    this.browserFingerprint =
      options.browserFingerprint || "parts-search-prototype";
    this.timeoutMs = options.timeoutMs || 12000;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.token = null;
    this.refreshToken = null;
  }

  isConfigured() {
    return Boolean(this.email && this.password && this.browserFingerprint);
  }

  async search({ article, brand, includeImages = true }) {
    if (!this.isConfigured()) {
      throw new ProviderError(
        "auth_not_configured",
        "UniqTrade credentials are not configured",
        { providerId: this.id }
      );
    }

    const normalizedArticle = String(article || "").trim();
    const params = new URLSearchParams();
    if (brand) {
      params.set("brand", brand);
    }
    params.set("info", includeImages ? "1" : "0");

    const path = `/api/search/${encodeURIComponent(normalizedArticle)}?${params}`;
    const response = await this.authenticatedRequest(path);
    const payload = await safeJson(response);
    return normalizeUniqTradeSearch(payload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl,
      apiBaseUrl: this.baseUrl
    });
  }

  async authenticatedRequest(path) {
    await this.ensureToken();

    let response = await this.request(path, {
      headers: { Authorization: `Bearer ${this.token}` }
    });

    if (response.status === 401 || response.status === 403) {
      await this.refreshAuthToken();
      response = await this.request(path, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
    }

    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    return response;
  }

  async ensureToken() {
    if (this.token) {
      return;
    }

    const response = await this.request("/api/login_check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
        browser_fingerprint: this.browserFingerprint
      })
    });

    if (!response.ok) {
      throw await this.errorFromResponse(response, "auth_failed");
    }

    const payload = await safeJson(response);
    this.token = payload?.token || payload?.access_token || null;
    this.refreshToken = payload?.refresh_token || payload?.refreshToken || null;

    if (!this.token) {
      throw new ProviderError(
        "invalid_response",
        "UniqTrade login response did not include a token",
        { providerId: this.id }
      );
    }
  }

  async refreshAuthToken() {
    if (!this.refreshToken) {
      this.token = null;
      await this.ensureToken();
      return;
    }

    const response = await this.request("/api/token/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: this.refreshToken,
        browser_fingerprint: this.browserFingerprint
      })
    });

    if (!response.ok) {
      this.token = null;
      this.refreshToken = null;
      throw await this.errorFromResponse(response, "auth_failed");
    }

    const payload = await safeJson(response);
    this.token = payload?.token || payload?.access_token || this.token;
    this.refreshToken =
      payload?.refresh_token || payload?.refreshToken || this.refreshToken;
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
      throw new ProviderError(code, "UniqTrade request failed", {
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
      payload?.message ||
      payload?.error ||
      `UniqTrade returned HTTP ${response.status}`;
    const code =
      response.status === 401 || response.status === 403
        ? "auth_failed"
        : fallbackCode;

    return new ProviderError(code, message, {
      providerId: this.id,
      status: response.status
    });
  }
}

export function normalizeUniqTradeSearch(payload, provider = DEFAULT_PROVIDER) {
  const rows = extractRows(payload);
  return rows.map((item, index) => normalizeUniqTradeItem(item, index, provider));
}

export function normalizeUniqTradeItem(item, index, provider = DEFAULT_PROVIDER) {
  const images = normalizeImages(item?.images);
  const brand = pickString(item, [
    "brand",
    "brandName",
    "displayBrand",
    "producer",
    "manufacturer"
  ]);
  const article = pickString(item, ["article", "oem", "number", "code", "sku"]);
  const title = pickString(item, ["title", "name", "description", "productName"]);
  const externalId = String(
    item?.id || item?.externalId || item?.productId || `${article || "part"}-${index}`
  );
  const rawUrl = pickString(item, ["url", "rawUrl", "productUrl", "detailUrl"]);
  const providerUrl =
    rawUrl || buildUniqTradeSearchUrl(provider.webBaseUrl, { article, brand });
  const apiDetailUrl =
    item?.id
      ? `${trimTrailingSlash(provider.apiBaseUrl || DEFAULT_PROVIDER.apiBaseUrl)}/api/detail/${encodeURIComponent(item.id)}`
      : "";

  return {
    providerId: provider.providerId || provider.id || DEFAULT_PROVIDER.id,
    providerName: provider.providerName || provider.name || DEFAULT_PROVIDER.name,
    externalId,
    brand,
    displayBrand: pickString(item, ["displayBrand", "brandName"]) || brand,
    article,
    title: title || [brand, article].filter(Boolean).join(" "),
    category: pickString(item, ["category", "categoryName", "groupName"]),
    price: normalizePrice(item),
    quantity: pickNumber(item, ["quantity", "qty", "stock", "available"]),
    remains: item?.remains ?? item?.warehouses ?? item?.stores ?? null,
    images,
    hasImage: images.length > 0,
    multiplicity: pickNumber(item, ["multiplicity", "minimumOrderQuantity", "pack"]),
    rawUrl,
    providerUrl,
    apiDetailUrl,
    raw: redactSensitive(item)
  };
}

export function buildUniqTradeSearchUrl(baseUrl, { article, brand }) {
  const params = new URLSearchParams();
  if (article) {
    params.set("article", article);
  }
  if (brand) {
    params.set("brand", brand);
  }

  return `${trimTrailingSlash(baseUrl || DEFAULT_PROVIDER.webBaseUrl)}/ua/search-results?${params}`;
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of ["details", "data", "items", "results", "products", "rows"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  if (payload && typeof payload === "object") {
    return Object.values(payload).filter(
      (value) => value && typeof value === "object" && !Array.isArray(value)
    );
  }

  return [];
}

function normalizeImages(images) {
  if (!images) {
    return [];
  }

  const rows = Array.isArray(images) ? images : [images];
  return rows
    .map((image) => {
      if (typeof image === "string") {
        return { thumbnail: image, fullImagePath: image };
      }

      return {
        thumbnail:
          image?.thumbnail || image?.thumb || image?.preview || image?.url || null,
        fullImagePath:
          image?.fullImagePath || image?.full || image?.image || image?.url || null
      };
    })
    .filter((image) => image.thumbnail || image.fullImagePath);
}

function normalizePrice(item) {
  const price = item?.yourPrice || item?.price;
  if (price && typeof price === "object") {
    return {
      value: Number(price.value ?? price.amount ?? price.price) || null,
      currency:
        price.currency?.code ||
        price.currency ||
        item?.currency?.code ||
        item?.currency ||
        null
    };
  }

  const value = pickNumber(item, ["price", "priceValue", "cost"]);
  if (value === null) {
    return null;
  }

  return {
    value,
    currency: pickString(item, ["currency", "priceCurrency"]) || "UAH"
  };
}

function pickString(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value && typeof value === "object") {
      const nested =
        value.name ||
        value.displayName ||
        value.originalName ||
        value.code ||
        value.externalCode;
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
    throw new ProviderError("invalid_response", "Provider returned invalid JSON");
  }
}
