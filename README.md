# Parts Search Prototype

Small full-stack prototype for searching spare parts through supplier APIs. The first provider is UniqTrade API v2; the code is structured so another provider can be added without changing the browser contract.

## What It Does

- Serves a web UI with article and optional brand search.
- Exposes `GET /api/parts/search?q=<article>&brand=<brand>`.
- Keeps UniqTrade credentials and JWT tokens on the server.
- Calls UniqTrade search with `info=1` so supplier image metadata can be shown.
- Normalizes provider responses into one result model.
- Handles loading, empty results, provider errors, auth errors, and missing images.

## Requirements

- Node.js 20 or newer.
- UniqTrade API login/password.

No npm packages are required for the prototype.

## Setup

```bash
cp .env.example .env
```

Fill in:

- `UNIQTRADE_EMAIL`
- `UNIQTRADE_PASSWORD`
- `UNIQTRADE_BROWSER_FINGERPRINT`
- `UNIQTRADE_WEB_BASE_URL` if the provider shop URL differs from `https://order24.utr.ua`

Then run:

```bash
npm start
```

Open `http://localhost:3000`.

Set `HOST=127.0.0.1` if your machine blocks binding to all interfaces.

## Test

```bash
npm test
npm run check
```

## Specification

The OpenSpec change is included in this repository so the prototype can move to GitHub as a self-contained project:

- [Proposal](openspec/changes/prototype-parts-search/proposal.md)
- [Design](openspec/changes/prototype-parts-search/design.md)
- [Parts search spec](openspec/changes/prototype-parts-search/specs/parts-search/spec.md)
- [Implementation tasks](openspec/changes/prototype-parts-search/tasks.md)

OpenSpec CLI can validate the change from the repository root:

```bash
openspec validate prototype-parts-search
```

## Search Logging

Set `SEARCH_LOG_LEVEL=summary` to print supplier result summaries to the server console. Use `SEARCH_LOG_LEVEL=raw` to also print the redacted raw UniqTrade response.

Useful when a result appears in API search but cannot be bought in the provider shop: check `quantity`, `remains`, price, provider URL, and any raw availability fields.

## API

```http
GET /api/parts/search?q=OC90&brand=MAHLE
```

Response shape:

```json
{
  "query": { "article": "OC90", "brand": "MAHLE" },
  "results": [],
  "errors": [],
  "providers": [{ "id": "uniqtrade", "name": "UniqTrade", "ok": true }],
  "meta": { "durationMs": 120, "partial": false }
}
```

Supplier credentials, JWTs, and refresh tokens are never returned by this endpoint.

## Adding Another Supplier

Add a provider object with:

- `id`
- `name`
- `search({ article, brand, includeImages })`

Then register it in `src/providers/index.js`. The UI consumes only the normalized backend response.

## Image Notes

The prototype renders supplier-provided `thumbnail` URLs and links to `fullImagePath` when present. If supplier image URLs are not publicly reachable from the browser, add a backend image proxy endpoint later and keep the same normalized image fields.
