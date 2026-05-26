# Autonova-D Provider Notes

Source contract:

- [Autonova-D API instruction](autonova-api.md)
- Swagger UI: `https://api.autonovad.ua/webjars/swagger-ui/index.html#/`

## API Style

Autonova-D API is a resource-oriented HTTP API with token authentication.
The documentation describes two environments:

| Environment | Base URL |
| --- | --- |
| Test | `https://api.autonovad.ua/dev` |
| Production | `https://api.autonovad.ua/stable` |

The prototype defaults to the production GET-capable base URL and can be pointed
to `/dev` through `AUTONOVA_API_BASE_URL`.

## Prototype Configuration

```env
AUTONOVA_API_BASE_URL=https://api.autonovad.ua/stable
AUTONOVA_WEB_BASE_URL=https://autonovad.ua
AUTONOVA_LOGIN=
AUTONOVA_PASSWORD=
AUTONOVA_CLIENT_ID=
AUTONOVA_AUTH_LOGIN_FIELD=login
AUTONOVA_FILTER_BY_RESULT_CATEGORY=1,2,3
AUTONOVA_MAX_DETAILS=8
AUTONOVA_TIMEOUT_MS=20000
```

The provider is enabled only when `AUTONOVA_LOGIN`, `AUTONOVA_PASSWORD`, and
`AUTONOVA_CLIENT_ID` are set.

`AUTONOVA_AUTH_LOGIN_FIELD` exists because the instruction says login/password
are used, but does not show the exact JSON request body for `/auth/token`.
The default request body is:

```json
{
  "login": "...",
  "password": "..."
}
```

If Swagger shows a different field name, set `AUTONOVA_AUTH_LOGIN_FIELD`, for
example `username` or `email`.

## Authentication

Endpoint:

```http
POST /api/v1/auth/token
Content-Type: application/json
```

The response is expected to include an access token field such as
`access_token`, `accessToken`, or `token`. Tokens are cached server-side and
refreshed with:

```http
GET /api/v1/auth/token/refresh/{refreshToken}
```

Authenticated requests use:

```http
Authorization: Bearer <access_token>
```

## Search Flow

The provider uses a two-step search because the instruction separates article
lookup from client-specific availability.

1. Find parts by article:

```http
GET /api/v1/wares/article/{articleId}
```

2. For each matching `partId`, load client-specific offers:

```http
GET /api/v1/wares/clients/{clientId}/parts/{partId}?FilterByResultCategory=1%2C2%2C3
```

Brand text from the UI is applied as a local filter before loading details,
because exact API filtering needs Autonova `brandId`, while the current UI
accepts free-text brand values.

## Normalized Mapping

| Normalized field | Autonova-D source candidates |
| --- | --- |
| `providerId` | `autonova` |
| `providerName` | `Autonova-D` |
| `providerHomeUrl` | `AUTONOVA_WEB_BASE_URL` |
| `externalId` | `partId`, `wareId`, `id` |
| `brand` / `displayBrand` | `brand`, `brandName`, `producerName`, `manufacturer`, `wareManufacturer` |
| `article` | `article`, `articleId`, `wareArticle`, `code`, `partCode` |
| `title` | `name`, `wareName`, `partName`, `description` |
| `price` | direct price fields or minimum remains price |
| `quantity` | `null`; availability is represented by `remains` |
| `remains[]` | normalized detail rows, offers, stocks, warehouses, or rests |
| `providerUrl` | empty until a verified web product/search URL is known |
| `raw` | redacted source item |

Remains mapping:

| Normalized remains field | Autonova-D source candidates |
| --- | --- |
| `storageId` | `warehouseId`, `storeId` |
| `storageName` | `warehouseName`, `storeName`, `affiliateName`, `resultCategory` |
| `quantity` | `quantity`, `qnt`, `wareQnt`, `availableQuantity`, `stock` |
| `price` | `price`, `clientPrice`, `warePrice` |
| `currency` | `currency`, defaults to `UAH` |
| `supplierId` | `supplierId`, `supplierUid` |
| `deliveryType` | `deliveryType` |
| `deliveryDate` | `deliveryDate` |
| `resultCategory` | `resultCategory` |

## Notes

- The public instruction does not include exact response schemas, so the mapper
  accepts several likely field names from the documented terms.
- `FilterByResultCategory=1,2,3` requests local branch, other branches, and
  supplier offers according to the instruction.
- The provider does not place orders; order endpoints are documented for later.
