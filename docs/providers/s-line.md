# S-LINE Provider API

This document captures the S-LINE API behavior used by the prototype. The original [S-LINE Postman collection](s-line.postman.json) documents endpoints but does not include response examples, so the response contract below is based on observed raw API output.

## Configuration

Environment variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SLINE_API_KEY` | yes | empty | API key passed as `apikey` query parameter. Enables the provider when set. |
| `SLINE_API_BASE_URL` | no | `https://s-line.ua/api/v1` | API base URL. |
| `SLINE_WEB_BASE_URL` | no | `https://s-line.ua` | Provider web/cabinet base URL. |
| `SLINE_CURRENCY` | no | `UAH` | Search currency query parameter. |
| `SLINE_STORAGE_ID` | no | empty | Optional storage filter. |
| `SLINE_SEND_BRAND_FLAG` | no | `false` | Sends empty `brand` query flag when true. Not needed for current search. |
| `SLINE_TIMEOUT_MS` | no | `20000` | Provider request timeout. |

## Search Parts

```http
GET https://s-line.ua/api/v1/parts/search?apikey=<key>&number=<article>&manufacturer=<brand>&currency=UAH
```

Query parameters:

| Name | Required | Notes |
| --- | --- | --- |
| `apikey` | yes | S-LINE API key. |
| `number` | yes | Spare part article number, for example `0451103079`. |
| `manufacturer` | no | Brand/manufacturer, for example `BOSCH`. |
| `currency` | no | Currency code. The prototype sends `UAH` by default. |
| `storageId` | no | Optional storage filter. |
| `brand` | no | Present in Postman as an empty flag, but disabled by default in this prototype. |

## Search Response

Observed shape:

```json
{
  "Status": 1,
  "StatusDescription": "success",
  "Currency": "UAH",
  "Parts": [
    {
      "Id": 186304,
      "Manufacturer": "BOSCH",
      "Number": "0451103079",
      "Name": "ФІЛЬТР ОЛИВИ",
      "Weight": 361.5,
      "Offers": [
        {
          "StorageId": 522,
          "PurchaseReturns": false,
          "ReturnsDaysLimit": null,
          "Region": "Україна",
          "StorageName": "TRLK",
          "Quantity": 12,
          "Price": 114.92,
          "Logistic": {
            "Status": 1,
            "DeliveryType": "Авто",
            "ShippingDate": "2026-05-25T14:00:00",
            "DeliveryAmount": 0,
            "Message": ""
          }
        }
      ]
    }
  ]
}
```

## Field Meaning

`Parts[]` is the product-level result list.

`Parts[].Offers[]` is the availability/offer list. Each offer is tied to a storage and contains its own quantity, price, return policy, region, and delivery information.

Important interpretation:

- `Parts[].Offers[].Quantity` is per-offer/per-storage availability.
- The prototype MUST NOT sum `Offers[].Quantity` into the top-level result `Quantity`.
- S-LINE result-level `Quantity` is omitted in the UI unless S-LINE returns a separate part-level quantity field.
- S-LINE `Offers[]` are displayed as `Remains`.
- The result-level price is the minimum `Offers[].Price`.
- The provider action link uses the S-LINE cabinet search route: `https://s-line.ua/Home/Index?search=<article>`.

## Normalized Mapping

| Normalized field | S-LINE source |
| --- | --- |
| `providerId` | `sline` |
| `providerName` | `S-LINE` |
| `providerHomeUrl` | `SLINE_WEB_BASE_URL` |
| `externalId` | `Parts[].Id` |
| `brand`, `displayBrand` | `Parts[].Manufacturer` |
| `article` | `Parts[].Number` |
| `title` | `Parts[].Name` |
| `price.value` | minimum `Parts[].Offers[].Price` |
| `price.currency` | response `Currency`, fallback `UAH` |
| `quantity` | separate part-level quantity only; not aggregated from offers |
| `remains[]` | normalized `Parts[].Offers[]` |
| `providerUrl` | direct URL if present, otherwise `/Home/Index?search=<article>` |
| `raw` | redacted original part object |

Offer/remains mapping:

| Normalized remains field | S-LINE offer source |
| --- | --- |
| `storageId` | `StorageId` |
| `storageName` | `StorageName` |
| `region` | `Region` |
| `quantity` | `Quantity` |
| `price` | `Price` |
| `purchaseReturns` | `PurchaseReturns` |
| `returnsDaysLimit` | `ReturnsDaysLimit` |
| `logistic` | `Logistic` |

## Related Endpoints From Postman Collection

The collection also lists these endpoints, but they are not used by the current search prototype:

| Endpoint | Purpose |
| --- | --- |
| `GET /info/StorageList` | Storage dictionary. |
| `GET /info/DeliveryProfileList` | Delivery profile dictionary. |
| `GET /info/CustomerInfo` | Customer/account info. |
| `GET /orders/basket` | Read basket. |
| `POST /orders/ToBasket` | Add items to basket. Requires `storageId`, `PartId`, `DeliveryProfileId`, `Quantity`. |
| `GET /orders/ClearBasket` | Clear basket. |
| `GET /orders/DeleteBasketItem` | Remove basket item. |
| `GET /orders/OrderById` | Read one order. |
| `GET /orders/OrdersByPeriod` | Read orders by period. |
| `GET /price/DownloadPrice` | Download price list. |

## Open Questions

- Does `SearchParts` ever return direct product URLs?
- Does `SearchParts` ever return part-level quantity outside `Offers[]`?
- Which `DeliveryProfileId` should be selected for `ToBasket` when multiple offers are shown?
- Does `StorageList` provide human-friendly names beyond `StorageName` in offers?
