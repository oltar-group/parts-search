## Why

Users need a quick way to search spare parts by article number or brand and see current availability, price, and an image without working directly with supplier APIs. The first prototype should validate the workflow against the UniqTrade API while keeping the design ready for additional supplier APIs.

## What Changes

- Add a searchable web prototype where a user enters a part article, optionally narrows by brand, and receives normalized search results.
- Integrate the UniqTrade API as the first supplier source using server-side credentials and JWT token refresh.
- Request image-enriched search data where supported and show supplier-provided thumbnails/full images when available.
- Normalize supplier responses into a common result model so later APIs can be added as independent adapters.
- Include UX states for loading, no results, supplier errors, expired authentication, and results without images.
- Document non-web delivery alternatives for the same search capability: chat bot, internal API endpoint, CLI/admin utility, spreadsheet import/export, and lightweight mobile/PWA flow.

## Capabilities

### New Capabilities

- `parts-search`: User-facing and API-backed spare parts search across one or more supplier providers, including normalized result display and image handling.

### Modified Capabilities

None.

## Impact

- New prototype application surface for spare parts search.
- New server-side supplier integration for `https://order24-api.utr.ua`.
- New configuration for UniqTrade email, password, browser fingerprint, API base URL, request timeout, and image behavior.
- Future provider additions should implement the same adapter contract instead of changing the UI search flow.
