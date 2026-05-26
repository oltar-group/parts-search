## Context

The prototype starts with one supplier, UniqTrade, and must leave room for more supplier APIs. UniqTrade API v2 uses `POST https://order24-api.utr.ua/api/login_check` to exchange email, password, and `browser_fingerprint` for a JWT token and refresh token. Search is available through `GET https://order24-api.utr.ua/api/search/{oem}`, optionally with `brand={brand}` and `info=1` to include additional part information and images.

The user-facing workflow is simple: enter a spare part article, optionally enter or select a brand, and inspect a list of offers with supplier, brand, article, title, price, stock/remains, and image. Credentials must stay server-side because the API login/password and bearer tokens are supplier secrets.

## Goals / Non-Goals

**Goals:**

- Build a prototype web interface for part search by article and optional brand.
- Hide supplier credentials behind a backend API.
- Normalize UniqTrade responses into a supplier-agnostic result model.
- Show supplier-provided thumbnails or full images when available.
- Keep provider integration isolated so a second supplier can be added by implementing the same adapter interface.
- Make non-web delivery channels possible by exposing the same backend search operation.

**Non-Goals:**

- Placing orders, adding to basket, delivery selection, or payment.
- Full user account management for end customers.
- Scraping third-party image search results when supplier images are absent.
- Long-term price history, inventory synchronization, or local catalog indexing.
- Production-grade marketplace ranking across many suppliers.

## Decisions

### Backend-for-frontend owns supplier access

The browser SHALL call an application backend endpoint such as `GET /api/parts/search?q=OC90&brand=MAHLE`. The backend authenticates with supplier APIs, caches tokens, refreshes expired JWTs, calls provider adapters, and returns normalized results.

Rationale: this prevents supplier credentials and bearer tokens from reaching the browser and gives one place for retries, timeouts, logging, and provider aggregation. The main alternative was direct browser calls to UniqTrade, but that would expose credentials and is unlikely to work cleanly with CORS.

### Provider adapter contract

Each supplier integration SHALL implement a small contract:

- `providerId`
- `search({ article, brand, includeImages })`
- normalized result mapping
- provider-specific error mapping
- optional health/auth diagnostics

The normalized result model should include `providerId`, `providerName`, `externalId`, `brand`, `displayBrand`, `article`, `title`, `category`, `price`, `quantity`, `remains`, `images`, `hasImage`, `multiplicity`, `rawUrl`, and `raw`.

The prototype also carries `providerHomeUrl` for provider label links, `providerUrl` for result action links, and `apiDetailUrl` for provider API diagnostics or future detail/cart workflows. `quantity` and `remains` must remain separate because UniqTrade can return a quantity-like value even when provider shop stock remains are empty.

Rationale: the UI and alternate channels can use one stable response while supplier-specific fields remain available in `raw` during the prototype. The alternative was to return UniqTrade JSON directly, but that would make the first API shape leak into every future integration.

### UniqTrade search strategy

For single search, the adapter SHALL call:

- `GET /api/search/{oem}?info=1` when no brand is provided.
- `GET /api/search/{oem}?brand={brand}&info=1` when brand is provided.

The adapter SHALL use `Authorization: Bearer <token>` and refresh the token with `POST /api/token/refresh` when the API returns an expired JWT response.

Rationale: `info=1` is the documented way to receive image data in search responses. Brand filtering reduces noise when the user knows the manufacturer. Batch search can be considered later for multi-line search or cart import.

### Image handling

The backend SHALL preserve supplier image URLs from `images[].thumbnail` and `images[].fullImagePath`. The UI SHALL show the thumbnail first and allow opening the full image when present. If no image exists, the UI SHALL render a neutral placeholder and keep the result usable.

For the prototype, images can be loaded directly from the supplier file URL if the browser can access it. If hotlinking, authorization, or mixed-content issues appear, the backend should add an image proxy endpoint later.

Rationale: supplier-provided images are the most accurate source for spare parts. External image search or generated images are unsuitable for identifying specific parts because they can mislead users.

### Availability and action handling

The UI SHALL show `quantity` as a separate value and `remains` as its own availability section. If `remains` is an explicit empty list, the UI SHALL show a no-stock-remains state and SHALL NOT infer availability from `quantity`. If the provider result has no direct URL, the UniqTrade adapter SHALL build a fallback provider search link using `/ua/search-results?article={article}`. S-LINE SHALL build a cabinet search link using `/Home/Index?search={article}`.

Rationale: the API search can return a part even when the provider shop cannot sell it. Treating `quantity` as stock produced misleading UI, so stock must be based on remains or an explicit provider availability field.

For S-LINE, availability comes from `Parts[].Offers[]`. Each offer represents a storage-specific availability row with `StorageName`, `Quantity`, `Price`, region, return policy, and logistics. The adapter maps offers to `remains` and uses the minimum offer price as the result-level price so users can compare providers quickly while still seeing per-storage detail. It SHALL NOT sum offer quantities into result-level `quantity`, because that value is displayed as a separate provider field rather than aggregate availability. The UI omits top-level `Quantity` for S-LINE and shows offer quantities only in `Remains`.

For Tehnomir, the API is action-based JSON over HTTP rather than resource-oriented REST. Search uses `POST /price/search` with `apiToken` and `code` in the JSON body. Availability comes from `data[].rests[]`, where `quantity` can be exact or lower-bound depending on `quantityType`. The adapter maps rests to `remains`, displays `quantityType=MORE` as `> N`, uses the minimum rest price as the result-level price, and leaves top-level `quantity` empty to avoid presenting provider stock as an aggregate quantity.

For Autonova-D, the API uses temporary bearer tokens from `POST /api/v1/auth/token`, with refresh through `GET /api/v1/auth/token/refresh/{refreshToken}`. Search is a two-step flow: `GET /api/v1/wares/article/{articleId}` finds matching parts, then `GET /api/v1/wares/clients/{clientId}/parts/{partId}?FilterByResultCategory=1,2,3` loads client-specific availability and offers. Because the current UI provides brand as free text while Autonova's exact search uses `brandId`, the adapter filters by brand text after article lookup and before detail loading.

Result cards use the same layout for all providers: core fields first, provider action link next, remains below actions. This keeps S-LINE cards with many offers from hiding the provider action below a long remains list. Remains render the first three rows by default with a show/hide control for the full list.

### Search input and timeout handling

The backend SHALL reject brand-only article queries, such as `BOSCH` without a brand filter, before calling providers. Provider requests SHALL use a configurable timeout and return timeout metadata to the UI.

Rationale: UniqTrade article search is not a general brand search. Broad terms can time out and give poor feedback, while exact articles produce actionable results.

### Diagnostics logging

The server SHALL support `SEARCH_LOG_LEVEL=off|summary|raw`. Summary logs include query, provider state, result count, quantity, remains summary, price, provider URL, and API detail URL. Raw logs include the supplier response after redacting token, password, secret, and credential fields.

Rationale: diagnostics are needed to understand mismatches between API search results and provider shop availability without exposing credentials.

### Web UI first, shared backend for alternatives

The web UI is the primary prototype because it is easiest to validate with users and supports image-heavy results. The backend search endpoint also supports these alternatives:

- Telegram/Viber/chat bot for quick shop-floor lookup.
- Internal JSON API for another system or CRM to call.
- CLI/admin utility for support staff.
- Spreadsheet import/export for searching many articles at once.
- PWA/mobile-friendly view for phone use in a warehouse or store.

Rationale: these alternatives reuse the same provider adapters and normalized result model. They should not become separate supplier integrations.

## Risks / Trade-offs

- Supplier API availability or rate limits -> Add request timeout, provider-level error state, and clear partial-result rendering when only some providers fail.
- Broad brand-only searches -> Reject before provider calls and ask for an exact article number.
- Search result exists but cannot be purchased -> Display remains separately, show explicit empty-remains state, and use logs to inspect provider availability fields.
- Provider public URL assumptions -> Only show provider action links from direct response URLs or verified provider-specific URL builders.
- Provider discoverability -> Make provider labels link to provider home pages independently from result-specific action links.
- Provider-specific no matches hidden by aggregate results -> Display provider status messages for zero-result providers even when another provider returns matches.
- Expired or invalid UniqTrade credentials -> Keep credentials in environment variables, expose backend diagnostics, and map authentication failures to an operator-facing error.
- Images missing or inaccurate -> Prefer supplier images, display placeholders when absent, and avoid synthetic images for exact part identification.
- Slow multi-provider search later -> Query providers concurrently with per-provider timeouts and return partial results.
- Over-normalization too early -> Keep a `raw` field in prototype responses so provider-specific details remain available while the UI model stabilizes.
- Price/stock freshness expectations -> Label results as live supplier data from search time and avoid storing values as authoritative history in the prototype.

## Migration Plan

1. Create the prototype app and backend search endpoint.
2. Configure UniqTrade credentials through local environment variables.
3. Implement UniqTrade adapter, token handling, and normalized mapping.
4. Build the search UI and result list with image, price, and stock states.
5. Add tests around adapter mapping and backend search behavior.
6. Validate manually with a known article and brand.

Rollback is simple for the prototype: disable the application route or remove the provider configuration. No data migration is required.

## Open Questions

- Which technology stack should be used for the prototype if no existing app exists in the repository?
- Should the initial UI language be Ukrainian, Russian, or bilingual?
- Should supplier prices be visible to all prototype users or only authenticated internal users?
- Are UniqTrade image URLs publicly accessible from the target user network, or is an image proxy required?
- Which second supplier API is most likely to be added next, and does it support images?
