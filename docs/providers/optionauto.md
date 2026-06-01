# OptionAuto Provider Notes

OptionAuto runs on the Vortex storefront/API stack. The API is a JSON RPC-style
POST endpoint rather than REST: every call is sent to one `front_api` URL with
`module`, `method`, `client_id`, `data`, and a SHA1 `hash`.

Source contract files are included as [OptionAuto Vortex API DOCX](optionauto-api.docx)
and [redacted PHP client example](optionauto-client-example.php). The original
PHP sample contained an API key, so the committed copy uses placeholders.

## Prototype Configuration

```env
OPTIONAUTO_API_BASE_URL=https://crm.optionauto.com.ua/front_api
OPTIONAUTO_WEB_BASE_URL=https://www.optionauto.com.ua
OPTIONAUTO_API_KEY=
OPTIONAUTO_CLIENT_ID=
OPTIONAUTO_MAX_DETAILS=8
OPTIONAUTO_TIMEOUT_MS=20000
```

The provider is enabled only when `OPTIONAUTO_API_KEY` and
`OPTIONAUTO_CLIENT_ID` are set.

## Request Signing

The request body shape is:

```json
{
  "module": "Vortex",
  "method": "search_articles",
  "client_id": 90,
  "rand": 37507,
  "time": 1713370302,
  "call_type": "crm",
  "data": {},
  "cookies": [],
  "hash": "..."
}
```

The hash follows the PHP sample exactly:

1. Sort `data` keys alphabetically.
2. Convert arrays with JSON encoding.
3. Convert `false`, `null`, and missing values to an empty string; `true` to `1`.
4. Build:

```text
{rand}+{time}+{apiKey}+{method}+{jsonCookies}+data:{key=value&...}
```

5. SHA1 the string.

## Search Flow

1. Find Vortex article IDs:

```text
method=search_articles
data.client_id={clientId}
data.query={article}
data.search_by_description=false
```

The response contains `items[]` rows with:

| Normalized field | Vortex field |
| --- | --- |
| `externalId` | `id` |
| `article` | `code` |
| `brand` | `trademark` |
| `title` | `name` |

2. Load stock/price data for matched IDs:

```text
method=get_stocks_for_batch
data.art_ids=[id]
data.client_id={clientId}
data.second_level_substitutes=false
```

Stock rows are normalized from `stock[]`:

| Normalized remains field | Vortex field |
| --- | --- |
| `storageId` | `wh_id` |
| `storageName` | `wh_name` |
| `quantity` | `qty` |
| `price` | `prices.uah` |
| `supplierId` | `supplier_id` |
| `deliveryDays` | `days` or `delivery_to_wh` |
| `returnPeriod` | `return_period` |
| `lastUpdate` | `last_update` |

## Provider Links

`providerUrl` currently points to the storefront catalog search:

```text
https://www.optionauto.com.ua/catalog?query={article}
```

If OptionAuto exposes a better logged-in product/search route, replace this URL
builder without changing the normalized response contract.
