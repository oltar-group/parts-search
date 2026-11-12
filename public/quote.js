// Quote list: parts picked from search results, a markup per line, and a
// client version without part numbers or suppliers. Kept in this browser only.
import {
  clientBrand,
  clientListText,
  clientName,
  clientUnitPrice,
  positiveQty,
  quoteTotals,
  stripArticle
} from "./quote-utils.js?v=9";

const STORAGE_KEY = "parts-search-quote-v1";

export function createQuoteList({ panel, toggleButton }) {
  const state = load();
  let view = "mine";

  const body = panel.querySelector("#quote-body");
  const defaultMarkupInput = panel.querySelector("#quote-default-markup");
  const tabs = [...panel.querySelectorAll(".quote-tab")];

  defaultMarkupInput.value = String(state.defaultMarkup);
  defaultMarkupInput.addEventListener("input", () => {
    state.defaultMarkup = toNumber(defaultMarkupInput.value, 0);
    save();
  });
  panel.querySelector("#quote-apply-all").addEventListener("click", () => {
    state.items.forEach((item) => {
      item.markup = state.defaultMarkup;
    });
    save();
    render();
  });
  panel.querySelector("#quote-clear").addEventListener("click", () => {
    if (state.items.length && window.confirm("Очистити весь список?")) {
      state.items = [];
      save();
      render();
    }
  });
  panel.querySelector("#quote-close").addEventListener("click", () => setOpen(false));
  toggleButton.addEventListener("click", () => setOpen(panel.hidden));
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      view = tab.dataset.view;
      render();
    })
  );

  render();

  function add(item) {
    state.items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      qty: 1,
      markup: state.defaultMarkup,
      clientName: stripArticle(item.title, item.article),
      ...item
    });
    save();
    render();
    flash();
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggleButton.setAttribute("aria-expanded", String(open));
    if (open) {
      render();
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function render() {
    toggleButton.textContent = `Список (${state.items.length})`;
    toggleButton.hidden = state.items.length === 0 && panel.hidden;
    tabs.forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    if (!state.items.length) {
      body.replaceChildren(
        el("p", "quote-empty", "Список порожній. Додавайте запчастини кнопкою «+ До списку» в результатах пошуку.")
      );
      return;
    }
    body.replaceChildren(view === "client" ? renderClient() : renderMine());
  }

  function renderMine() {
    const wrap = el("div", "quote-mine");
    const table = el("table", "quote-table");
    const head = el("tr");
    ["Запчастина", "Вхід", "К-сть", "Націнка %", "Клієнту / шт", "Сума", ""].forEach((text) =>
      head.append(el("th", "", text))
    );
    table.append(el("thead", "", head));
    const tbody = el("tbody");
    const totalsEl = el("div", "quote-totals");

    for (const item of state.items) {
      const row = el("tr");
      const nameCell = el("td", "quote-name");
      const nameInput = input("text", item.clientName, "Назва для клієнта");
      nameInput.addEventListener("input", () => {
        item.clientName = nameInput.value;
        save();
      });
      const brandInput = input("text", clientBrand(item), "Виробник для клієнта");
      brandInput.className = "quote-brand";
      brandInput.placeholder = "Виробник";
      brandInput.addEventListener("input", () => {
        item.clientBrand = brandInput.value;
        save();
      });
      const source = el("div", "quote-source");
      const sourceText = [
        [item.brand, item.article].filter(Boolean).join(" "),
        item.provider,
        item.warehouse,
        Number.isFinite(item.deliveryDays) ? `${item.deliveryDays} дн.` : ""
      ]
        .filter(Boolean)
        .join(" · ");
      if (item.providerUrl) {
        const link = el("a", "", sourceText);
        link.href = item.providerUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        source.append(link);
      } else {
        source.textContent = sourceText;
      }
      nameCell.append(el("div", "quote-name-row", [nameInput, brandInput]), source);

      const qtyInput = input("number", item.qty, "Кількість");
      qtyInput.min = "1";
      qtyInput.step = "1";
      const markupInput = input("number", item.markup, "Націнка, %");
      markupInput.step = "1";
      const unitCell = el("td", "num");
      const sumCell = el("td", "num strong");
      const update = () => {
        const unit = clientUnitPrice(item.price, item.markup);
        unitCell.textContent = money(unit);
        sumCell.textContent = money(unit * positiveQty(item.qty));
        renderTotals(totalsEl);
      };
      qtyInput.addEventListener("input", () => {
        item.qty = positiveQty(qtyInput.value);
        save();
        update();
      });
      markupInput.addEventListener("input", () => {
        item.markup = toNumber(markupInput.value, 0);
        save();
        update();
      });

      const remove = el("button", "quote-remove", "✕");
      remove.type = "button";
      remove.title = "Видалити з списку";
      remove.addEventListener("click", () => {
        state.items = state.items.filter((entry) => entry.id !== item.id);
        save();
        render();
      });

      row.append(
        nameCell,
        el("td", "num", money(item.price)),
        el("td", "", qtyInput),
        el("td", "", markupInput),
        unitCell,
        sumCell,
        el("td", "", remove)
      );
      tbody.append(row);
      update();
    }

    table.append(tbody);
    const scroller = el("div", "quote-scroll", table);
    wrap.append(scroller, totalsEl);
    renderTotals(totalsEl);
    return wrap;
  }

  function renderTotals(target) {
    const totals = quoteTotals(state.items);
    target.replaceChildren(
      el("span", "", `Вхід: ${money(totals.purchase)}`),
      el("span", "", `Клієнту: ${money(totals.client)}`),
      el("span", "profit", `Заробіток: ${money(totals.profit)}`)
    );
  }

  function renderClient() {
    const wrap = el("div", "quote-client");
    const table = el("table", "quote-table quote-client-table");
    const head = el("tr");
    ["№", "Назва", "Виробник", "К-сть", "Ціна", "Сума"].forEach((text, index) =>
      head.append(el("th", index >= 3 ? "num" : "", text))
    );
    table.append(el("thead", "", head));
    const tbody = el("tbody");
    state.items.forEach((item, index) => {
      const qty = positiveQty(item.qty);
      const unit = clientUnitPrice(item.price, item.markup);
      const row = el("tr");
      row.append(
        el("td", "", index + 1),
        el("td", "", clientName(item)),
        el("td", "", clientBrand(item) || "—"),
        el("td", "num", qty),
        el("td", "num", money(unit)),
        el("td", "num strong", money(unit * qty))
      );
      tbody.append(row);
    });
    table.append(tbody);
    const list = el("div", "quote-scroll", table);
    const total = el("p", "quote-client-total", `Разом: ${money(quoteTotals(state.items).client)}`);

    const actions = el("div", "quote-actions");
    const copy = el("button", "quote-button primary", "Копіювати текст");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      const text = clientListText(state.items, money);
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "Скопійовано";
      } catch {
        window.prompt("Скопіюйте текст:", text);
      }
      setTimeout(() => (copy.textContent = "Копіювати текст"), 1500);
    });
    const print = el("button", "quote-button", "Друк");
    print.type = "button";
    print.addEventListener("click", printClientList);
    actions.append(copy, print);

    wrap.append(list, total, actions);
    return wrap;
  }

  function printClientList() {
    const win = window.open("", "_blank");
    if (!win) {
      return;
    }
    const doc = win.document;
    doc.title = "Список запчастин";
    const style = doc.createElement("style");
    style.textContent =
      "body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px}" +
      "table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:8px;text-align:left}" +
      ".num{text-align:right;white-space:nowrap}tfoot td{font-weight:700;border:0}";
    doc.head.append(style);
    const h1 = doc.createElement("h1");
    h1.textContent = `Список запчастин від ${new Date().toLocaleDateString("uk-UA")}`;
    const table = doc.createElement("table");
    table.innerHTML =
      "<thead><tr><th>№</th><th>Назва</th><th>Виробник</th><th class=num>К-сть</th><th class=num>Ціна</th><th class=num>Сума</th></tr></thead>";
    const tbody = doc.createElement("tbody");
    state.items.forEach((item, index) => {
      const qty = positiveQty(item.qty);
      const unit = clientUnitPrice(item.price, item.markup);
      const tr = doc.createElement("tr");
      [
        String(index + 1),
        clientName(item),
        clientBrand(item) || "—",
        String(qty),
        money(unit),
        money(unit * qty)
      ].forEach((text, cellIndex) => {
        const td = doc.createElement("td");
        td.textContent = text;
        if (cellIndex >= 3) td.className = "num";
        tr.append(td);
      });
      tbody.append(tr);
    });
    const tfoot = doc.createElement("tfoot");
    const footRow = doc.createElement("tr");
    const label = doc.createElement("td");
    label.colSpan = 5;
    label.textContent = "Разом";
    const sum = doc.createElement("td");
    sum.className = "num";
    sum.textContent = money(quoteTotals(state.items).client);
    footRow.append(label, sum);
    tfoot.append(footRow);
    table.append(tbody, tfoot);
    doc.body.append(h1, table);
    win.focus();
    win.print();
  }

  function flash() {
    toggleButton.classList.remove("bump");
    void toggleButton.offsetWidth;
    toggleButton.classList.add("bump");
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  return { add };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.items)) {
      return { items: saved.items, defaultMarkup: toNumber(saved.defaultMarkup, 25) };
    }
  } catch {}
  return { items: [], defaultMarkup: 25 };
}

function toNumber(value, fallback) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value || 0)} грн`;
}

function el(tag, className = "", content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (Array.isArray(content)) node.append(...content);
  else if (content instanceof Node) node.append(content);
  else if (content !== undefined) node.textContent = String(content);
  return node;
}

function input(type, value, label) {
  const node = document.createElement("input");
  node.type = type;
  node.value = value ?? "";
  node.setAttribute("aria-label", label);
  if (type === "number") node.inputMode = "decimal";
  return node;
}
