# Parts Search Prototype

Small full-stack prototype for searching spare parts through supplier APIs. The first provider is UniqTrade API v2; the code is structured so another provider can be added without changing the browser contract.

## What It Does

- Serves a web UI with article and optional brand search.
- Exposes `GET /api/parts/search?q=<article>&brand=<brand>`.
- Keeps UniqTrade credentials and JWT tokens on the server.
- Enables S-LINE as a second provider when `SLINE_API_KEY` is configured.
- Enables Tehnomir as another provider when `TEHNOMIR_API_TOKEN` is configured.
- Enables Autonova-D when `AUTONOVA_LOGIN`, `AUTONOVA_PASSWORD`, and `AUTONOVA_CLIENT_ID` are configured.
- Enables OptionAuto when `OPTIONAUTO_API_KEY` and `OPTIONAUTO_CLIENT_ID` are configured.
- Calls UniqTrade search with `info=1` so supplier image metadata can be shown.
- Normalizes provider responses into one result model.
- Handles loading, empty results, provider errors, auth errors, and missing images.

## Requirements

- Node.js 20 or newer.
- UniqTrade API login/password.

No npm packages are required for the prototype.

For server deployment, Docker Compose is the recommended runtime. See
[Deploy on Ubuntu](docs/deploy-ubuntu.md) for the full Git-based deployment
runbook.

## Setup

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in:

- `UNIQTRADE_EMAIL`
- `UNIQTRADE_PASSWORD`
- `UNIQTRADE_BROWSER_FINGERPRINT`
- `UNIQTRADE_WEB_BASE_URL` if the provider shop URL differs from `https://order24.utr.ua`
- `SLINE_API_KEY` to enable S-LINE search
- `TEHNOMIR_API_TOKEN` to enable Tehnomir search
- `AUTONOVA_LOGIN`, `AUTONOVA_PASSWORD`, and `AUTONOVA_CLIENT_ID` to enable Autonova-D search
- `OPTIONAUTO_API_KEY` and `OPTIONAUTO_CLIENT_ID` to enable OptionAuto search

Then run:

```bash
npm start
```

Open `http://localhost:3000`.

Set `HOST=127.0.0.1` if your machine blocks binding to all interfaces.

The same `npm start`, `npm test`, and `npm run check` commands work on Windows,
macOS, and Linux.

## Docker

Docker is the recommended server runtime when you want one repeatable setup with
Node.js, environment variables, port mapping, restart policy, and log volume
handled outside the host OS.

For a clean Ubuntu server, use the step-by-step deployment runbook:
[Deploy on Ubuntu](docs/deploy-ubuntu.md).

Before using the default external port, check whether `3000` is already busy:

```bash
sudo ss -ltnp | grep ':3000'
```

If it is busy, set another external port such as `8080` in `.env`:

```env
HOST_PORT=8080
```

Keep `PORT=3000`; that is the internal application port inside the container.

After creating `.env`, run with Docker Compose:

```bash
docker compose up -d --build
```

Open `http://localhost:3000`, or `http://localhost:8080` if `HOST_PORT=8080`.

The Compose file forces `HOST=0.0.0.0` inside the container so published ports
work even if `.env` contains `HOST=127.0.0.1`. Search logs are written to the
host `./logs` directory. The container entrypoint fixes `/app/logs` ownership at
startup and then runs the Node.js process as the non-root `node` user, so a fresh
checkout with no existing `logs/` directory still works on Linux.

Without Compose on macOS/Linux:

```bash
docker build -t parts-search-prototype .
docker run -d --name parts-search \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 3000:3000 \
  -v "$(pwd)/logs:/app/logs" \
  parts-search-prototype
```

Use `-p 8080:3000` instead if host port `3000` is busy.

Without Compose on Windows PowerShell:

```powershell
docker build -t parts-search-prototype .
docker run -d --name parts-search `
  --env-file .env `
  -e HOST=0.0.0.0 `
  -p 3000:3000 `
  -v "${PWD}/logs:/app/logs" `
  parts-search-prototype
```

Use `-p 8080:3000` instead if host port `3000` is busy.

## Build Version

Production deployments can expose the deployed build through environment
variables:

```env
BUILD_VERSION=0.1.0
BUILD_COMMIT=85c2dc2
BUILD_TIME=2026-05-27T10:00:00Z
```

The values are returned by `GET /api/health` and shown at the bottom of the web
UI. If `BUILD_VERSION` is not set, the app falls back to `package.json` version.

## Test

```bash
npm test
npm run check
```

## Specification

OpenSpec files are included in this repository:

- [Current parts search spec](openspec/specs/parts-search/spec.md)
- [Archived proposal](openspec/changes/archive/2026-05-27-prototype-parts-search/proposal.md)
- [Archived design](openspec/changes/archive/2026-05-27-prototype-parts-search/design.md)
- [Archived implementation tasks](openspec/changes/archive/2026-05-27-prototype-parts-search/tasks.md)

OpenSpec CLI can validate the specs from the repository root:

```bash
openspec validate --all
```

## Search Logging

Set `SEARCH_LOG_LEVEL=summary` to log supplier result summaries. Use
`SEARCH_LOG_LEVEL=raw` to also log redacted raw supplier responses. The server
console prints compact one-line events; `SEARCH_LOG_FILE` keeps the full
formatted JSON payloads for investigation.

File logging rotates by size. By default it keeps 5 files total: `logs/search.log` plus `logs/search.log.1` through `logs/search.log.4`.

```env
SEARCH_LOG_FILE=logs/search.log
SEARCH_LOG_MAX_BYTES=1048576
SEARCH_LOG_MAX_FILES=5
```

Useful when a result appears in API search but cannot be bought in the provider shop: check `quantity`, `remains`, price, provider URL, and any raw availability fields.

## Provider API Docs

- [S-LINE provider notes](docs/providers/s-line.md)
- [S-LINE OpenAPI contract](docs/providers/s-line.openapi.yaml)
- [S-LINE Postman collection](docs/providers/s-line.postman.json)
- [Tehnomir provider notes](docs/providers/tehnomir.md)
- [Tehnomir OpenAPI contract](docs/providers/tehnomir.openapi.json)
- [Autonova-D provider notes](docs/providers/autonova.md)
- [Autonova-D API instruction](docs/providers/autonova-api.md)
- [OptionAuto provider notes](docs/providers/optionauto.md)
- [OptionAuto Vortex API DOCX](docs/providers/optionauto-api.docx)
- [OptionAuto redacted PHP client example](docs/providers/optionauto-client-example.php)

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
