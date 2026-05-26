import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(filePath = resolve(process.cwd(), ".env")) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function readConfig(env = process.env) {
  return {
    host: env.HOST || "127.0.0.1",
    port: parseInt(env.PORT || "3000", 10),
    includeSupplierImages: env.INCLUDE_SUPPLIER_IMAGES !== "false",
    searchLogLevel: env.SEARCH_LOG_LEVEL || "off",
    uniqtrade: {
      baseUrl: env.UNIQTRADE_API_BASE_URL || "https://order24-api.utr.ua",
      webBaseUrl: env.UNIQTRADE_WEB_BASE_URL || "https://order24.utr.ua",
      email: env.UNIQTRADE_EMAIL || "",
      password: env.UNIQTRADE_PASSWORD || "",
      browserFingerprint:
        env.UNIQTRADE_BROWSER_FINGERPRINT || "parts-search-prototype",
      timeoutMs: parseInt(env.UNIQTRADE_TIMEOUT_MS || "20000", 10),
      logLevel: env.SEARCH_LOG_LEVEL || "off"
    },
    sline: {
      baseUrl: env.SLINE_API_BASE_URL || "https://s-line.ua/api/v1",
      webBaseUrl: env.SLINE_WEB_BASE_URL || "https://s-line.ua",
      apiKey: env.SLINE_API_KEY || "",
      currency: env.SLINE_CURRENCY || "UAH",
      storageId: env.SLINE_STORAGE_ID || "",
      sendBrandFlag: env.SLINE_SEND_BRAND_FLAG === "true",
      timeoutMs: parseInt(env.SLINE_TIMEOUT_MS || "20000", 10),
      logLevel: env.SEARCH_LOG_LEVEL || "off"
    },
    tehnomir: {
      baseUrl: env.TEHNOMIR_API_BASE_URL || "https://api.tehnomir.com.ua",
      webBaseUrl: env.TEHNOMIR_WEB_BASE_URL || "https://tehnomir.com.ua",
      apiToken: env.TEHNOMIR_API_TOKEN || "",
      currency: env.TEHNOMIR_CURRENCY || "UAH",
      isShowAnalogs: env.TEHNOMIR_SHOW_ANALOGS || "",
      timeoutMs: parseInt(env.TEHNOMIR_TIMEOUT_MS || "20000", 10),
      logLevel: env.SEARCH_LOG_LEVEL || "off"
    }
  };
}
