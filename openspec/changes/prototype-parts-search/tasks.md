## 1. Prototype Setup

- [x] 1.1 Choose and scaffold the prototype stack in this repository, favoring a small full-stack web app with server-side API routes.
- [x] 1.2 Add environment configuration for UniqTrade API base URL, email, password, browser fingerprint, request timeout, and token cache settings.
- [x] 1.3 Add a `.env.example` or equivalent template that documents required variables without real credentials.
- [x] 1.4 Add a basic run script and README notes for starting the prototype locally.

## 2. Supplier Provider Layer

- [x] 2.1 Define the provider adapter interface and normalized parts search result model.
- [x] 2.2 Implement UniqTrade authentication against `/api/login_check` with server-side token storage.
- [x] 2.3 Implement JWT refresh through `/api/token/refresh` and retry one failed search after token expiry.
- [x] 2.4 Implement UniqTrade article search with `info=1` and optional `brand` query parameter.
- [x] 2.5 Map UniqTrade part fields, price/stock data, and `images.thumbnail` or `images.fullImagePath` into the normalized model.
- [x] 2.6 Add provider-level timeout and error mapping for unavailable provider, authentication failure, invalid response, and no results.

## 3. Backend Search API

- [x] 3.1 Create backend endpoint `GET /api/parts/search` accepting required article query and optional brand.
- [x] 3.2 Validate empty or malformed article input before calling providers.
- [x] 3.3 Call configured providers through the adapter contract and merge normalized results.
- [x] 3.4 Return partial results with provider error metadata when at least one provider succeeds and another fails.
- [x] 3.5 Ensure supplier credentials, JWTs, and refresh tokens are never returned in API responses or browser bundles.

## 4. Web Interface

- [x] 4.1 Build the search form with article input, optional brand input, submit button, and client-side empty-query validation.
- [x] 4.2 Add loading, no-results, provider-error, authentication-error, and partial-results states.
- [x] 4.3 Build a responsive results list showing provider, brand, article, title, price, quantity/remains, and multiplicity where available.
- [x] 4.4 Display supplier thumbnails when available and a stable placeholder when a result has no image.
- [x] 4.5 Allow opening the full supplier image URL when `fullImagePath` is present.
- [x] 4.6 Keep result cards usable on desktop and mobile viewports.

## 5. Verification

- [x] 5.1 Add unit tests for UniqTrade response normalization, including results with and without images.
- [x] 5.2 Add backend tests for empty query validation, successful search, provider error, and token refresh retry.
- [x] 5.3 Add a mocked provider test that proves a second provider can be merged without changing the browser response contract.
- [x] 5.4 Run lint/type checks and the test suite.
- [x] 5.6 Add diagnostics for supplier raw/summary logging and redaction.
- [x] 5.7 Add validation and UI messaging for broad brand-only searches and provider timeouts.
- [x] 5.8 Verify that empty remains are not inferred from quantity and are shown as no stock remains.
- [x] 5.9 Show provider-level no-match status when other providers return results.
- [x] 5.10 Use S-LINE cabinet search route for provider action links when no direct product URL is returned.
- [x] 5.11 Link provider labels to provider home pages.
- [x] 5.12 Map S-LINE `Parts[].Offers[]` into remains, minimum price, and logistics display without aggregating quantity.
- [ ] 5.5 Manually verify local search with a known article and optional brand using real UniqTrade credentials.

## 6. Follow-up Options

- [x] 6.1 Document web alternatives that reuse the same backend search endpoint: chat bot, internal API, CLI/admin utility, spreadsheet batch import, and PWA/mobile view.
- [ ] 6.2 Decide whether an image proxy endpoint is needed after testing supplier image URLs from the browser.
- [x] 6.3 Capture the likely next supplier API requirements before adding the second provider.
