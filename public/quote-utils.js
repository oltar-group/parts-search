// Pure helpers for the quote list. No DOM access, so tests can import them.

// Client price per unit: purchase price plus markup percent, rounded up to the
// next ten (123 -> 130, 130 -> 130). Rounds to cents first so float noise such
// as 100 * 1.3 = 130.00000000000003 does not push 130 up to 140.
export function clientUnitPrice(purchasePrice, markupPercent) {
  const price = Number(purchasePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  const markup = Number(markupPercent);
  const withMarkup = price * (1 + (Number.isFinite(markup) ? markup : 0) / 100);
  const cents = Math.round(withMarkup * 100) / 100;
  return Math.ceil(cents / 10) * 10;
}

// Part name for the client: the supplier title without the article number.
// Removes the article written with or without separators ("0 986-494.947").
export function stripArticle(title, article) {
  let text = String(title || "");
  const compact = String(article || "").replace(/[^\p{L}\p{N}]+/gu, "");
  if (compact) {
    const pattern = [...compact]
      .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s./-]?");
    text = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`, "giu"), "$1");
  }
  return text
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:/-]+|[\s,.;:/-]+$/g, "")
    .trim();
}

export function quoteTotals(items) {
  let purchase = 0;
  let client = 0;
  for (const item of items) {
    const qty = positiveQty(item.qty);
    purchase += (Number(item.price) || 0) * qty;
    client += clientUnitPrice(item.price, item.markup) * qty;
  }
  purchase = Math.round(purchase * 100) / 100;
  return { purchase, client, profit: Math.round((client - purchase) * 100) / 100 };
}

export function positiveQty(value) {
  const qty = Math.floor(Number(value));
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

// Plain text of the client list, for pasting into a messenger.
export function clientListText(items, formatMoney) {
  const lines = items.map((item, index) => {
    const qty = positiveQty(item.qty);
    const unit = clientUnitPrice(item.price, item.markup);
    const brand = clientBrand(item);
    const name = `${clientName(item)}${brand ? ` (${brand})` : ""}`;
    return qty > 1
      ? `${index + 1}. ${name} — ${qty} шт × ${formatMoney(unit)} = ${formatMoney(unit * qty)}`
      : `${index + 1}. ${name} — ${formatMoney(unit)}`;
  });
  lines.push("", `Разом: ${formatMoney(quoteTotals(items).client)}`);
  return lines.join("\n");
}

export function clientName(item) {
  return item.clientName || stripArticle(item.title, item.article) || "Запчастина";
}

export function clientBrand(item) {
  return String(item.clientBrand ?? item.brand ?? "").trim();
}
