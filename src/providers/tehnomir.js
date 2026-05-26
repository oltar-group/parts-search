import { ProviderError } from "./provider-error.js";
import { redactSensitive } from "../redact.js";

const DEFAULT_PROVIDER = {
  id: "tehnomir",
  name: "Tehnomir",
  apiBaseUrl: "https://api.tehnomir.com.ua",
  webBaseUrl: "https://tehnomir.com.ua"
};

export class TehnomirProvider {
  constructor(options = {}) {
    this.id = DEFAULT_PROVIDER.id;
    this.name = DEFAULT_PROVIDER.name;
    this.baseUrl = trimTrailingSlash(
      options.baseUrl || DEFAULT_PROVIDER.apiBaseUrl
    );
    this.webBaseUrl = trimTrailingSlash(
      options.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl
    );
    this.apiToken = options.apiToken || "";
    this.currency = options.currency || "";
    this.isShowAnalogs = options.isShowAnalogs ?? "";
    this.timeoutMs = options.timeoutMs || 20000;
    this.logLevel = options.logLevel || "off";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  isConfigured() {
    return Boolean(this.apiToken);
  }

  async search({ article }) {
    if (!this.isConfigured()) {
      throw new ProviderError(
        "auth_not_configured",
        "Tehnomir API token is not configured",
        { providerId: this.id }
      );
    }

    const normalizedArticle = String(article || "").trim();
    const body = {
      apiToken: this.apiToken,
      code: normalizedArticle
    };
    if (this.currency) {
      body.currency = this.currency;
    }
    if (this.isShowAnalogs !== "") {
      body.isShowAnalogs = Number(this.isShowAnalogs);
    }

    const path = "/price/search";
    const response = await this.request(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    const payload = await safeJson(response);
    this.logRawSearch({ article: normalizedArticle, path, payload });

    if (payload?.success === false) {
      throw new ProviderError(
        "provider_error",
        pickErrorMessage(payload) || "Tehnomir search failed",
        { providerId: this.id }
      );
    }

    const results = normalizeTehnomirSearch(payload, {
      providerId: this.id,
      providerName: this.name,
      webBaseUrl: this.webBaseUrl
    });
    this.logSearchSummary({ article: normalizedArticle, results });
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
          ? `Tehnomir request timed out after ${this.timeoutMs}ms`
          : "Tehnomir request failed";
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
      pickErrorMessage(payload) || `Tehnomir returned HTTP ${response.status}`,
      { providerId: this.id, status: response.status }
    );
  }

  logRawSearch({ article, path, payload }) {
    if (this.logLevel !== "raw") {
      return;
    }

    console.info(
      JSON.stringify(
        {
          event: "supplier.raw_response",
          providerId: this.id,
          article,
          brand: "",
          path,
          payload: redactSensitive(payload)
        },
        null,
        2
      )
    );
  }

  logSearchSummary({ article, results }) {
    if (this.logLevel !== "summary" && this.logLevel !== "raw") {
      return;
    }

    console.info(
      JSON.stringify(
        {
          event: "supplier.search_summary",
          providerId: this.id,
          article,
          brand: "",
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

export function normalizeTehnomirSearch(payload, provider = DEFAULT_PROVIDER) {
  return extractRows(payload).map((item, index) =>
    normalizeTehnomirItem(item, index, provider)
  );
}

export function normalizeTehnomirItem(item, index, provider = DEFAULT_PROVIDER) {
  const brand = pickString(item, ["brand", "Brand"]);
  const article = pickString(item, ["code", "Code", "article", "Article"]);
  const title =
    pickString(item, ["descriptionUa", "descriptionRus", "description"]) ||
    [brand, article].filter(Boolean).join(" ");
  const rests = Array.isArray(item?.rests || item?.Rests)
    ? item?.rests || item?.Rests
    : [];
  const images = normalizeImages(item?.images || item?.Images);
  const externalId = String(
    item?.productId || item?.ProductId || `${article || "part"}-${index}`
  );

  return {
    providerId: provider.providerId || provider.id || DEFAULT_PROVIDER.id,
    providerName: provider.providerName || provider.name || DEFAULT_PROVIDER.name,
    providerHomeUrl: provider.webBaseUrl || DEFAULT_PROVIDER.webBaseUrl,
    externalId,
    brand,
    displayBrand: brand,
    article,
    title,
    category: "",
    price: normalizePrice(item, rests),
    quantity: null,
    remains: rests.length > 0 ? normalizeRests(rests) : null,
    images,
    hasImage: images.length > 0,
    multiplicity: normalizeMultiplicity(rests),
    rawUrl: "",
    providerUrl: buildTehnomirSearchUrl(provider.webBaseUrl, { article }),
    apiDetailUrl: "",
    raw: redactSensitive(item)
  };
}

export function buildTehnomirSearchUrl(baseUrl, { article }) {
  const params = new URLSearchParams();
  params.set("r", "product/search");
  params.set("SearchForm[code]", article || "");
  params.set("SearchForm[brandId]", "");
  params.set("SearchForm[profitLevel]", "10");
  params.set("SearchForm[daysFrom]", "");
  params.set("SearchForm[daysTo]", "");
  params.set("sort", "priceOuterPrice");
  params.set("SearchForm[catalogRequest]", "");

  return `${trimTrailingSlash(baseUrl || DEFAULT_PROVIDER.webBaseUrl)}/index.php?${params}`;
}

function normalizeRests(rests) {
  return rests.map((rest) => ({
    storageId: rest?.priceLogo || rest?.PriceLogo || null,
    storageName: rest?.priceLogo || rest?.PriceLogo || "",
    quantity: normalizeQuantity(rest),
    quantityType: pickString(rest, ["quantityType", "QuantityType"]),
    price: pickNumber(rest, ["price", "Price"]),
    currency: pickString(rest, ["currency", "Currency"]),
    multiplicity: pickNumber(rest, ["multiplicity", "Multiplicity"]),
    deliveryType: pickString(rest, ["deliveryType", "DeliveryType"]),
    deliveryTime: pickNumber(rest, ["deliveryTime", "DeliveryTime"]),
    deliveryDate: pickString(rest, ["deliveryDate", "DeliveryDate"]),
    deliveryPercent: pickNumber(rest, ["deliveryPercent", "DeliveryPercent"]),
    isReturn: pickNumber(rest, ["isReturn", "IsReturn"]),
    isPriceFinal: pickNumber(rest, ["isPriceFinal", "IsPriceFinal"])
  }));
}

function normalizePrice(item, rests) {
  const prices = rests
    .map((rest) => pickNumber(rest, ["price", "Price"]))
    .filter((price) => price !== null);
  if (prices.length > 0) {
    const cheapest = rests.find(
      (rest) => pickNumber(rest, ["price", "Price"]) === Math.min(...prices)
    );
    return {
      value: Math.min(...prices),
      currency: pickString(cheapest, ["currency", "Currency"]) || "UAH"
    };
  }

  const value = pickNumber(item, ["price", "Price"]);
  if (value === null) {
    return null;
  }

  return {
    value,
    currency: pickString(item, ["currency", "Currency"]) || "UAH"
  };
}

function normalizeQuantity(rest) {
  const quantity = pickNumber(rest, ["quantity", "Quantity"]);
  if (quantity === null) {
    return null;
  }

  const quantityType = pickString(rest, ["quantityType", "QuantityType"]);
  return quantityType === "MORE" ? `> ${quantity}` : quantity;
}

function normalizeMultiplicity(rests) {
  const value = rests
    .map((rest) => pickNumber(rest, ["multiplicity", "Multiplicity"]))
    .find((multiplicity) => multiplicity !== null);
  return value ?? null;
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
          : pickString(entry, ["image", "Image", "url", "Url"]);
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

  for (const key of ["data", "Data", "items", "Items", "results", "Results"]) {
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
    value?.code ||
      value?.Code ||
      value?.article ||
      value?.Article ||
      value?.productId ||
      value?.ProductId
  );
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
