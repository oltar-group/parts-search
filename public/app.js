const form = document.querySelector("#search-form");
const articleInput = document.querySelector("#article");
const brandInput = document.querySelector("#brand");
const button = document.querySelector("#search-button");
const statusEl = document.querySelector("#status");
const errorsEl = document.querySelector("#provider-errors");
const resultsEl = document.querySelector("#results");
const template = document.querySelector("#result-template");
const imageDialog = document.querySelector("#image-dialog");
const dialogImage = document.querySelector("#dialog-image");
const dialogClose = document.querySelector(".dialog-close");
const buildInfo = document.querySelector("#build-info");
const searchStats = document.querySelector("#search-stats");
const sortControl = document.querySelector("#sort-control");
const sortOptions = [...document.querySelectorAll(".sort-option")];
let currentResults = [];
let currentSort = "";

dialogClose.addEventListener("click", () => imageDialog.close());
imageDialog.addEventListener("click", (event) => {
  if (event.target === imageDialog) {
    imageDialog.close();
  }
});

loadBuildInfo();
loadSearchStats();

sortOptions.forEach((option) => {
  option.addEventListener("click", () => {
    currentSort = option.dataset.sort || "";
    updateSortControl();
    renderResults(currentResults);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const article = articleInput.value.trim();
  const brand = brandInput.value.trim();
  if (!article) {
    setStatus("Article is required.", "error");
    articleInput.focus();
    return;
  }

  setLoading(true);
  setStatus("Searching suppliers...");
  setSortVisibility(false);
  currentResults = [];
  renderProviderMessages([], []);
  resultsEl.replaceChildren();

  try {
    const params = new URLSearchParams({ q: article });
    if (brand) {
      params.set("brand", brand);
    }

    const response = await fetch(`/api/parts/search?${params}`);
    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message || "Search failed.";
      renderProviderMessages(payload.errors || [], payload.providers || []);
      setStatus(message, "error");
      return;
    }

    renderProviderMessages(payload.errors || [], payload.providers || []);
    currentResults = payload.results || [];
    renderResults(currentResults);

    const count = payload.results?.length || 0;
    setSortVisibility(count > 1);
    if (count === 0 && payload.errors?.length) {
      setStatus("No results because all providers failed.", "error");
    } else if (count === 0) {
      const providerText = formatProviders(payload.providers || []);
      setStatus(`No matching parts found.${providerText ? ` ${providerText}` : ""}`);
    } else if (payload.meta?.partial) {
      setStatus(`${count} result${count === 1 ? "" : "s"} found. Some providers failed.`);
    } else {
      setStatus(`${count} result${count === 1 ? "" : "s"} found.`);
    }
    await loadSearchStats();
  } catch (error) {
    setStatus(error?.message || "Search failed.", "error");
  } finally {
    setLoading(false);
  }
});

async function loadBuildInfo() {
  if (!buildInfo) {
    return;
  }

  try {
    const response = await fetch("/api/health");
    const payload = await response.json();
    const version = payload?.build?.version;
    const commit = payload?.build?.commit;
    const time = payload?.build?.time;
    const parts = [
      version ? `v${version}` : "",
      commit ? commit.slice(0, 7) : "",
      time || ""
    ].filter(Boolean);
    buildInfo.textContent = parts.length ? `Build ${parts.join(" · ")}` : "";
  } catch {
    buildInfo.textContent = "";
  }
}

async function loadSearchStats() {
  if (!searchStats) {
    return;
  }

  try {
    const response = await fetch("/api/search-stats");
    if (!response.ok) {
      searchStats.hidden = true;
      return;
    }

    const stats = await response.json();
    const total = formatInteger(stats?.totalSearches);
    const today = formatInteger(stats?.todaySearches);
    if (!total) {
      searchStats.hidden = true;
      return;
    }

    searchStats.textContent = `Searches ${total} · Today ${today || "0"}`;
    searchStats.hidden = false;
  } catch {
    searchStats.hidden = true;
  }
}

function setLoading(isLoading) {
  button.disabled = isLoading;
  button.textContent = isLoading ? "Searching" : "Search";
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.className = tone === "error" ? "status error" : "status";
}

function renderProviderMessages(errors, providers) {
  errorsEl.replaceChildren();
  const messages = [
    ...errors.map((error) => ({
      tone: "error",
      text: formatProviderError(error)
    })),
    ...providers
      .filter((provider) => provider.ok && provider.count === 0)
      .map((provider) => ({
        tone: "empty",
        text: `${provider.name || provider.id}: no matches for this article`
      }))
  ];

  if (!messages.length) {
    errorsEl.hidden = true;
    return;
  }

  const list = document.createElement("ul");
  for (const message of messages) {
    const item = document.createElement("li");
    item.className = message.tone;
    item.textContent = message.text;
    list.append(item);
  }

  errorsEl.append(list);
  errorsEl.hidden = false;
}

function formatProviderError(error) {
  const provider = error.providerId || "provider";
  if (error.code === "timeout") {
    return `${provider}: timed out. Try a more exact article number.`;
  }
  return `${provider}: ${error.message}`;
}

function renderResults(results) {
  resultsEl.replaceChildren(...sortResults(results).map(renderResultCard));
}

function sortResults(results) {
  if (!currentSort) {
    return results;
  }

  const direction = currentSort === "price-desc" ? -1 : 1;
  return results
    .map((result, index) => ({ result, index, price: getPriceValue(result) }))
    .sort((left, right) => {
      const leftHasPrice = Number.isFinite(left.price);
      const rightHasPrice = Number.isFinite(right.price);

      if (leftHasPrice && rightHasPrice && left.price !== right.price) {
        return (left.price - right.price) * direction;
      }

      if (leftHasPrice !== rightHasPrice) {
        return leftHasPrice ? -1 : 1;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function getPriceValue(result) {
  const value = result?.price?.value;
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = Number(value.replace(",", "."));
    return Number.isFinite(normalized) ? normalized : NaN;
  }

  return NaN;
}

function setSortVisibility(isVisible) {
  if (!sortControl) {
    return;
  }

  sortControl.hidden = !isVisible;
  if (!isVisible) {
    currentSort = "";
  }
  updateSortControl();
}

function updateSortControl() {
  for (const option of sortOptions) {
    const isActive = option.dataset.sort === currentSort;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-pressed", String(isActive));
  }
}

function renderProviderLabel(providerEl, result) {
  const label = result.providerName || result.providerId || "Supplier";
  providerEl.replaceChildren();

  if (!result.providerHomeUrl) {
    providerEl.textContent = label;
    return;
  }

  const link = document.createElement("a");
  link.href = result.providerHomeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  providerEl.append(link);
}

function renderResultCard(result) {
  const node = template.content.firstElementChild.cloneNode(true);
  const imageWrap = node.querySelector(".image-wrap");
  const provider = node.querySelector(".provider");
  const title = node.querySelector(".title");
  const price = node.querySelector(".price");
  const details = node.querySelector(".details");
  const actions = document.createElement("div");

  renderProviderLabel(provider, result);
  title.textContent = result.title || [result.brand, result.article].filter(Boolean).join(" ");
  price.textContent = formatPrice(result.price);

  const image = result.images?.[0];
  if (image?.thumbnail || image?.fullImagePath) {
    const img = document.createElement("img");
    img.alt = title.textContent || "Part image";
    img.src = image.fullImagePath || image.thumbnail;
    img.loading = "lazy";

    imageWrap.append(img);
    imageWrap.addEventListener("click", () => {
      openImagePreview(image.fullImagePath || image.thumbnail, img.alt);
    });
  } else {
    imageWrap.classList.add("no-image");
    imageWrap.disabled = true;
    imageWrap.textContent = "No image";
  }

  const rows = [
    ["Brand", result.displayBrand || result.brand],
    ["Article", result.article],
    ...(result.providerId === "sline"
      ? []
      : [["Quantity", valueOrDash(result.quantity)]]),
    ["Multiplicity", valueOrDash(result.multiplicity)],
    ["Category", result.category],
    ["Provider ID", result.externalId]
  ];

  for (const [label, value] of rows) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value || "-";
    wrapper.append(dt, dd);
    details.append(wrapper);
  }

  actions.className = "result-actions";
  const providerActionUrl = getProviderActionUrl(result);
  if (providerActionUrl) {
    const providerLink = document.createElement("a");
    providerLink.className = "provider-link";
    providerLink.href = providerActionUrl;
    providerLink.target = "_blank";
    providerLink.rel = "noopener noreferrer";
    providerLink.textContent = "Open in provider";
    actions.append(providerLink);
  }
  if (result.apiDetailUrl) {
    const detail = document.createElement("span");
    detail.className = "detail-hint";
    detail.textContent = `API detail: ${result.externalId}`;
    actions.append(detail);
  }
  if (actions.childElementCount > 0) {
    node.querySelector(".result-body").append(actions);
  }

  const stockBlock = renderRemains(result.remains);
  if (stockBlock) {
    node.querySelector(".result-body").append(stockBlock);
  }

  return node;
}

function formatPrice(price) {
  if (!price?.value) {
    return "Price N/A";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency || "UAH",
    maximumFractionDigits: 2
  }).format(price.value);
}

function formatInteger(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return new Intl.NumberFormat().format(value);
}

function getProviderActionUrl(result) {
  if (result.providerUrl) {
    return result.providerUrl;
  }

  if (result.providerId === "sline" && result.article) {
    const params = new URLSearchParams({ search: result.article });
    return `https://s-line.ua/Home/Index?${params}`;
  }

  return "";
}

function valueOrDash(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function renderRemains(remains) {
  const rows = normalizeRemains(remains);
  if (!rows.length) {
    return renderEmptyRemains(remains);
  }

  const visibleLimit = 3;
  const hasHiddenRows = rows.length > visibleLimit;
  const section = document.createElement("section");
  section.className = "stock-section";

  const header = document.createElement("div");
  header.className = "stock-header";

  const title = document.createElement("h3");
  title.textContent = `Remains (${rows.length})`;
  header.append(title);

  const list = document.createElement("ul");
  list.className = "stock-list";

  for (const row of rows.slice(0, visibleLimit)) {
    list.append(renderRemainRow(row));
  }

  section.append(header, list);

  if (hasHiddenRows) {
    const toggle = document.createElement("button");
    toggle.className = "stock-toggle";
    toggle.type = "button";
    toggle.textContent = `Show all ${rows.length}`;
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded ? `Show all ${rows.length}` : "Hide offers";
      list.replaceChildren(
        ...(!expanded ? rows : rows.slice(0, visibleLimit)).map(renderRemainRow)
      );
    });
    toggle.setAttribute("aria-expanded", "false");
    header.append(toggle);
  }

  return section;
}

function renderRemainRow(row) {
    const item = document.createElement("li");
    const storage = document.createElement("span");
    const remain = document.createElement("strong");
    const meta = document.createElement("small");
    storage.textContent = row.storage || "Warehouse";
    remain.textContent = valueOrDash(row.remain);
    meta.textContent = row.meta || "";
    item.append(storage, remain);
    if (row.meta) {
      item.append(meta);
    }
    return item;
}

function renderEmptyRemains(remains) {
  const section = document.createElement("section");
  section.className = "stock-section";

  const header = document.createElement("div");
  header.className = "stock-header";

  const title = document.createElement("h3");
  title.textContent = "Remains";
  header.append(title);

  const message = document.createElement("p");
  message.className = "stock-empty";
  message.textContent = Array.isArray(remains)
    ? "No stock remains reported"
    : "Not provided";

  section.append(header, message);
  return section;
}

function normalizeRemains(remains) {
  if (!remains) {
    return [];
  }

  if (Array.isArray(remains)) {
    return remains
      .map((entry) => ({
        storage:
          entry?.storage?.name ||
          entry?.warehouse?.name ||
          entry?.store?.name ||
          entry?.city?.name ||
          entry?.region?.name ||
          entry?.storageName ||
          entry?.StorageName ||
          entry?.warehouseName ||
          entry?.WarehouseName ||
          entry?.storeName ||
          entry?.StoreName ||
          entry?.name ||
          entry?.Name ||
          "",
        remain:
          entry?.remain ??
          entry?.Remain ??
          entry?.balance ??
          entry?.Balance ??
          entry?.quantity ??
          entry?.Quantity ??
          entry?.qty ??
          entry?.Qty ??
          entry?.available ??
          entry?.Available ??
          entry?.stock ??
          entry?.Stock ??
          "",
        meta: formatRemainMeta(entry)
      }))
      .filter((entry) => entry.storage || entry.remain !== "");
  }

  if (typeof remains === "object") {
    return Object.entries(remains).map(([storage, remain]) => ({
      storage,
      remain
    }));
  }

  return [{ storage: "Supplier", remain: remains }];
}

function formatRemainMeta(entry) {
  const parts = [];
  const price = entry?.price ?? entry?.Price;
  const currency = entry?.currency || entry?.Currency || "UAH";
  const region = entry?.region || entry?.Region;
  const logistic = entry?.logistic || entry?.Logistic;
  const deliveryType =
    entry?.deliveryType ||
    entry?.DeliveryType ||
    logistic?.DeliveryType ||
    logistic?.deliveryType;
  const shippingDate =
    entry?.deliveryDate ||
    entry?.DeliveryDate ||
    logistic?.ShippingDate ||
    logistic?.shippingDate;

  if (price !== undefined && price !== null && price !== "") {
    parts.push(`${price} ${currency}`);
  }
  if (region) {
    parts.push(region);
  }
  if (deliveryType) {
    parts.push(deliveryType);
  }
  if (shippingDate) {
    parts.push(formatDateTime(shippingDate));
  }

  return parts.join(" · ");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatProviders(providers) {
  if (!providers.length) {
    return "";
  }

  return providers
    .map((provider) => `${provider.name || provider.id}: ${provider.count || 0}`)
    .join(", ");
}

function openImagePreview(src, alt) {
  dialogImage.src = src;
  dialogImage.alt = alt;
  if (typeof imageDialog.showModal === "function") {
    imageDialog.showModal();
  } else {
    window.open(src, "_blank", "noopener,noreferrer");
  }
}
