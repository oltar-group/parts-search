import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageVersion = readPackageVersion();

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
    searchStatsFile: env.SEARCH_STATS_FILE || "data/search-stats.json",
    build: {
      version: env.BUILD_VERSION || env.npm_package_version || packageVersion,
      commit:
        env.BUILD_COMMIT ||
        env.GIT_SHA ||
        env.RENDER_GIT_COMMIT ||
        env.VERCEL_GIT_COMMIT_SHA ||
        "",
      time: env.BUILD_TIME || ""
    },
    logging: {
      filePath: env.SEARCH_LOG_FILE || "logs/search.log",
      maxBytes: parseInt(env.SEARCH_LOG_MAX_BYTES || "1048576", 10),
      maxFiles: parseInt(env.SEARCH_LOG_MAX_FILES || "5", 10)
    },
    uniqtrade: {
      baseUrl: env.UNIQTRADE_API_BASE_URL || "https://order24-api.utr.ua",
      webBaseUrl: env.UNIQTRADE_WEB_BASE_URL || "https://order24.utr.ua",
      email: env.UNIQTRADE_EMAIL || "",
      password: env.UNIQTRADE_PASSWORD || "",
      browserFingerprint:
        env.UNIQTRADE_BROWSER_FINGERPRINT || "parts-search-prototype",
      currency: env.UNIQTRADE_CURRENCY || "UAH",
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
    },
    autonova: {
      baseUrl: env.AUTONOVA_API_BASE_URL || "https://api.autonovad.ua/stable",
      authBaseUrl:
        env.AUTONOVA_AUTH_BASE_URL ||
        env.AUTONOVA_API_BASE_URL ||
        "https://api.autonovad.ua/stable",
      webBaseUrl: env.AUTONOVA_WEB_BASE_URL || "https://autonovad.ua",
      login: env.AUTONOVA_LOGIN || "",
      password: env.AUTONOVA_PASSWORD || "",
      clientId: env.AUTONOVA_CLIENT_ID || "",
      filterByResultCategory: env.AUTONOVA_FILTER_BY_RESULT_CATEGORY || "1,2,3",
      maxDetails: env.AUTONOVA_MAX_DETAILS || "8",
      timeoutMs: parseInt(env.AUTONOVA_TIMEOUT_MS || "20000", 10),
      logLevel: env.SEARCH_LOG_LEVEL || "off"
    },
    optionauto: {
      baseUrl: env.OPTIONAUTO_API_BASE_URL || "https://crm.optionauto.com.ua/front_api",
      webBaseUrl: env.OPTIONAUTO_WEB_BASE_URL || "https://www.optionauto.com.ua",
      apiKey: env.OPTIONAUTO_API_KEY || "",
      clientId: env.OPTIONAUTO_CLIENT_ID || "",
      maxDetails: env.OPTIONAUTO_MAX_DETAILS || "8",
      timeoutMs: parseInt(env.OPTIONAUTO_TIMEOUT_MS || "20000", 10),
      logLevel: env.SEARCH_LOG_LEVEL || "off"
    }
  };
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    );
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
