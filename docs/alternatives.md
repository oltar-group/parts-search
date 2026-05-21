# Alternative Interfaces

The web UI is the first prototype surface, but the backend search endpoint can serve other channels.

## Chat Bot

A Telegram or Viber bot can accept an article number and return the top normalized results with price, stock, provider, and image link. This is useful for quick lookup from a phone.

## Internal JSON API

Another internal tool or CRM can call `GET /api/parts/search` directly. This keeps supplier credentials in one backend service instead of duplicating integrations.

## CLI or Admin Utility

Support staff can use a command-line wrapper for fast checks during operations. The CLI should call the same backend endpoint, not UniqTrade directly.

## Spreadsheet Batch Search

A batch workflow can read article numbers from a spreadsheet, call the backend for each row, and export normalized results back to CSV/XLSX. This is useful for price checks and bulk availability reviews.

## PWA or Mobile View

The current web UI can be extended into a PWA for warehouse or shop-floor use. This should reuse the same search API and image handling.

## Next Supplier Checklist

Before adding the second provider, capture:

- Authentication method and token lifetime.
- Search endpoint shape for article and brand.
- Price, stock, multiplicity, and delivery fields.
- Whether images are available and how they are authorized.
- Rate limits, timeout expectations, and error response format.
- Required legal or commercial display constraints.

