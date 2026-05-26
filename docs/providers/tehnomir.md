# Tehnomir Provider Notes

Source contract: [tehnomir.openapi.json](tehnomir.openapi.json)

## API Style

Tehnomir API is an action-based JSON API, closer to RPC-over-HTTP than REST:

- all documented endpoints use `POST`;
- endpoint paths are actions, for example `/price/search`, `/basket/add`, `/order/create`;
- request parameters are sent in JSON body;
- authentication uses `apiToken` in the JSON body, not an `Authorization` header;
- responses use a common envelope with `success` and `data`.

The API token must be generated in the Tehnomir personal cabinet under API management.
The OpenAPI document does not expose a login/password authentication endpoint.

## Prototype Configuration

```env
TEHNOMIR_API_BASE_URL=https://api.tehnomir.com.ua
TEHNOMIR_WEB_BASE_URL=https://tehnomir.com.ua
TEHNOMIR_API_TOKEN=
TEHNOMIR_CURRENCY=UAH
TEHNOMIR_SHOW_ANALOGS=
TEHNOMIR_TIMEOUT_MS=20000
```

The provider is enabled only when `TEHNOMIR_API_TOKEN` is set.

## Search

Endpoint:

```http
POST /price/search
Content-Type: application/json
Accept: application/json
```

Request:

```json
{
  "apiToken": "...",
  "code": "0451103079",
  "currency": "UAH"
}
```

Optional fields:

| Field | Meaning |
| --- | --- |
| `brandId` | Tehnomir manufacturer ID. The prototype does not send this from free-text brand input yet. |
| `isShowAnalogs` | Enables analog/cross search when configured. |
| `currency` | Price currency. Defaults to `UAH` in the prototype. |

Response shape:

```json
{
  "success": true,
  "data": [
    {
      "productId": 4106,
      "brandId": 7,
      "brand": "BOSCH",
      "code": "0451103079",
      "descriptionRus": "Фильтр масляный",
      "descriptionUa": "Фільтр оливи",
      "weight": 0.3,
      "isOriginal": false,
      "isExistProductInfo": true,
      "rests": [
        {
          "priceLogo": "ABCD",
          "price": 112.79,
          "currency": "UAH",
          "quantity": 20,
          "quantityType": "MORE",
          "multiplicity": 1,
          "deliveryType": "Авто",
          "deliveryTime": 1,
          "deliveryDate": "2026-05-27T10:00:00",
          "deliveryPercent": 98,
          "isReturn": 1,
          "isPriceFinal": 1
        }
      ]
    }
  ]
}
```

## Normalized Mapping

| Normalized field | Tehnomir source |
| --- | --- |
| `providerId` | `tehnomir` |
| `providerName` | `Tehnomir` |
| `providerHomeUrl` | `TEHNOMIR_WEB_BASE_URL` |
| `externalId` | `data[].productId` |
| `brand` / `displayBrand` | `data[].brand` |
| `article` | `data[].code` |
| `title` | `descriptionUa`, then `descriptionRus` |
| `price` | minimum `rests[].price` |
| `quantity` | `null`; stock is represented by `remains` |
| `remains[]` | normalized `data[].rests[]` |
| `multiplicity` | first available `rests[].multiplicity` |
| `images[]` | `images[].image` when product details include it |
| `providerUrl` | Tehnomir web search URL built from article |
| `raw` | redacted source item |

Remains mapping:

| Normalized remains field | Tehnomir source |
| --- | --- |
| `storageId` | `priceLogo` |
| `storageName` | `priceLogo` |
| `quantity` | `quantity`, formatted as `> N` when `quantityType=MORE` |
| `quantityType` | `quantityType` |
| `price` | `price` |
| `currency` | `currency` |
| `multiplicity` | `multiplicity` |
| `deliveryType` | `deliveryType` |
| `deliveryTime` | `deliveryTime` |
| `deliveryDate` | `deliveryDate` |
| `deliveryPercent` | `deliveryPercent` |
| `isReturn` | `isReturn` |
| `isPriceFinal` | `isPriceFinal` |

## Product Details

`POST /info/getProductInfo` can return product images and extra properties, but it requires `brandId` and `code`.
The prototype does not call it yet during search to avoid a second request per result until the need is confirmed.

## Notes

- `rests[].quantity` is stock availability, but it can be exact or lower-bound depending on `quantityType`.
- `quantityType=MORE` means the displayed stock should be `> quantity`.
- The provider-level `quantity` field is intentionally left empty to avoid confusing aggregate stock with an order quantity.
- Basket and order APIs exist in the contract, but the prototype currently performs search only.
