import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  truncateSync
} from "node:fs";
import { dirname } from "node:path";

let fileConfig = {
  enabled: false,
  path: "",
  maxBytes: 1024 * 1024,
  maxFiles: 5
};

export function configureLogger(options = {}) {
  const path = options.filePath || "";
  fileConfig = {
    enabled: Boolean(path),
    path,
    maxBytes: parseInt(options.maxBytes || `${1024 * 1024}`, 10),
    maxFiles: Math.max(parseInt(options.maxFiles || "5", 10), 1)
  };
}

export function logEvent(event) {
  const line = JSON.stringify(event, null, 2);
  console.info(formatConsoleEvent(event));

  if (!fileConfig.enabled) {
    return;
  }

  try {
    appendRotatingLine(`${line}\n`);
  } catch (error) {
    console.warn(`Search log write failed: ${error?.message || error}`);
  }
}

function formatConsoleEvent(event) {
  if (event?.event === "supplier.raw_response") {
    return [
      "supplier.raw_response",
      `provider=${event.providerId || "-"}`,
      `article=${event.article || "-"}`,
      event.brand ? `brand=${event.brand}` : "",
      event.path ? `path=${event.path}` : "",
      event.payload ? `payload=${summarizePayload(event.payload)}` : ""
    ].filter(Boolean).join(" ");
  }

  if (event?.event === "supplier.search_summary") {
    return [
      "supplier.search_summary",
      `provider=${event.providerId || "-"}`,
      `article=${event.article || "-"}`,
      event.brand ? `brand=${event.brand}` : "",
      `count=${event.resultCount ?? 0}`,
      summarizeResults(event.results)
    ].filter(Boolean).join(" ");
  }

  if (event?.event === "parts.search_response") {
    return [
      "parts.search_response",
      `article=${event.query?.article || "-"}`,
      event.query?.brand ? `brand=${event.query.brand}` : "",
      `results=${event.resultCount ?? 0}`,
      `providers=${summarizeProviders(event.providers)}`,
      event.errors?.length ? `errors=${summarizeErrors(event.errors)}` : "",
      `durationMs=${event.durationMs ?? "-"}`
    ].filter(Boolean).join(" ");
  }

  return JSON.stringify(event);
}

function summarizePayload(payload) {
  if (Array.isArray(payload)) {
    return `array(${payload.length})`;
  }

  if (!payload || typeof payload !== "object") {
    return typeof payload;
  }

  const keys = Object.keys(payload);
  const usefulCounts = [
    countLabel(payload.details, "details"),
    countLabel(payload.Parts, "Parts"),
    countLabel(payload.parts, "parts"),
    countLabel(payload.data, "data"),
    countLabel(payload.items, "items"),
    countLabel(payload.results, "results")
  ].filter(Boolean);

  return usefulCounts.length
    ? usefulCounts.join(",")
    : `object(${keys.slice(0, 5).join(",")}${keys.length > 5 ? ",..." : ""})`;
}

function countLabel(value, label) {
  if (Array.isArray(value)) {
    return `${label}:${value.length}`;
  }

  if (value && typeof value === "object") {
    const nested = countNestedRows(value);
    return nested === null ? "" : `${label}:${nested}`;
  }

  return "";
}

function countNestedRows(value) {
  for (const key of ["WareListItem", "items", "results", "parts", "details"]) {
    if (Array.isArray(value?.[key])) {
      return value[key].length;
    }
  }
  return null;
}

function summarizeResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "";
  }

  const visible = results.slice(0, 3).map((result) =>
    [result.brand, result.article, formatPrice(result.price)]
      .filter(Boolean)
      .join("/")
  );
  return `results=${visible.join(",")}${results.length > visible.length ? ",..." : ""}`;
}

function formatPrice(price) {
  if (!price || price.value === null || price.value === undefined) {
    return "";
  }
  return `${price.value}${price.currency ? ` ${price.currency}` : ""}`;
}

function summarizeProviders(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    return "-";
  }
  return providers
    .map((provider) =>
      `${provider.id || provider.name}:${provider.ok ? provider.count ?? 0 : "fail"}`
    )
    .join(",");
}

function summarizeErrors(errors) {
  return errors
    .map((error) => `${error.providerId || "provider"}:${error.code || "error"}`)
    .join(",");
}

function appendRotatingLine(line) {
  mkdirSync(dirname(fileConfig.path), { recursive: true });
  rotateIfNeeded(Buffer.byteLength(line));
  appendFileSync(fileConfig.path, line);
}

function rotateIfNeeded(nextBytes) {
  if (!existsSync(fileConfig.path)) {
    return;
  }

  const size = statSync(fileConfig.path).size;
  if (size + nextBytes <= fileConfig.maxBytes) {
    return;
  }

  if (fileConfig.maxFiles === 1) {
    truncateSync(fileConfig.path, 0);
    return;
  }

  for (let index = fileConfig.maxFiles - 1; index >= 1; index -= 1) {
    const source = index === 1 ? fileConfig.path : `${fileConfig.path}.${index - 1}`;
    const target = `${fileConfig.path}.${index}`;
    if (existsSync(source)) {
      renameSync(source, target);
    }
  }
}
