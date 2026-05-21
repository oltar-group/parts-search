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

dialogClose.addEventListener("click", () => imageDialog.close());
imageDialog.addEventListener("click", (event) => {
  if (event.target === imageDialog) {
    imageDialog.close();
  }
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
  renderProviderErrors([]);
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
      setStatus(message, "error");
      return;
    }

    renderProviderErrors(payload.errors || []);
    renderResults(payload.results || []);

    const count = payload.results?.length || 0;
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
  } catch (error) {
    setStatus(error?.message || "Search failed.", "error");
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  button.disabled = isLoading;
  button.textContent = isLoading ? "Searching" : "Search";
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.className = tone === "error" ? "status error" : "status";
}

function renderProviderErrors(errors) {
  errorsEl.replaceChildren();
  if (!errors.length) {
    errorsEl.hidden = true;
    return;
  }

  const list = document.createElement("ul");
  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = `${error.providerId || "provider"}: ${error.message}`;
    list.append(item);
  }

  errorsEl.append(list);
  errorsEl.hidden = false;
}

function renderResults(results) {
  resultsEl.replaceChildren(...results.map(renderResultCard));
}

function renderResultCard(result) {
  const node = template.content.firstElementChild.cloneNode(true);
  const imageWrap = node.querySelector(".image-wrap");
  const provider = node.querySelector(".provider");
  const title = node.querySelector(".title");
  const price = node.querySelector(".price");
  const details = node.querySelector(".details");
  const actions = document.createElement("div");

  provider.textContent = result.providerName || result.providerId || "Supplier";
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
    ["Quantity", valueOrDash(result.quantity)],
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

  const stockBlock = renderRemains(result.remains, result.quantity);
  if (stockBlock) {
    node.querySelector(".result-body").append(stockBlock);
  }

  actions.className = "result-actions";
  if (result.providerUrl) {
    const providerLink = document.createElement("a");
    providerLink.className = "provider-link";
    providerLink.href = result.providerUrl;
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

function valueOrDash(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function renderRemains(remains, quantity) {
  const rows = normalizeRemains(remains);
  if (!rows.length && quantity !== undefined && quantity !== null && quantity !== "") {
    rows.push({ storage: "Total", remain: quantity });
  }

  if (!rows.length) {
    return null;
  }

  const section = document.createElement("section");
  section.className = "stock-section";

  const title = document.createElement("h3");
  title.textContent = "Remains";
  section.append(title);

  const list = document.createElement("ul");
  list.className = "stock-list";

  for (const row of rows) {
    const item = document.createElement("li");
    const storage = document.createElement("span");
    const remain = document.createElement("strong");
    storage.textContent = row.storage || "Warehouse";
    remain.textContent = valueOrDash(row.remain);
    item.append(storage, remain);
    list.append(item);
  }

  section.append(list);
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
          entry?.warehouseName ||
          entry?.storeName ||
          entry?.name ||
          "",
        remain:
          entry?.remain ??
          entry?.balance ??
          entry?.quantity ??
          entry?.qty ??
          entry?.available ??
          entry?.stock ??
          ""
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
