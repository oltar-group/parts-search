## ADDED Requirements

### Requirement: Search form accepts spare part query
The system SHALL provide a user-facing search form that accepts a spare part article as the required query and an optional brand filter.

#### Scenario: User searches by article
- **WHEN** the user submits a non-empty article query
- **THEN** the system sends a search request for that article and displays a loading state until results or an error are available

#### Scenario: User searches by article and brand
- **WHEN** the user submits an article query with a brand value
- **THEN** the system sends the search request with both article and brand filters

#### Scenario: User submits empty query
- **WHEN** the user submits the search form without an article query
- **THEN** the system prevents the supplier request and displays a validation message

#### Scenario: User submits brand-only query
- **WHEN** the user submits a query that looks like a brand name without an article number and without a brand filter
- **THEN** the system rejects the request before calling providers and asks for a more exact article number

### Requirement: Supplier credentials stay server-side
The system SHALL keep supplier API credentials, JWT tokens, and refresh tokens on the server and SHALL NOT expose them to browser code.

#### Scenario: Browser performs search
- **WHEN** the browser submits a search
- **THEN** it calls the application backend search endpoint instead of calling supplier APIs directly

#### Scenario: Backend authenticates with UniqTrade
- **WHEN** the backend needs a UniqTrade token
- **THEN** it authenticates using server-side configuration and stores the resulting token only in server memory or a server-controlled cache

### Requirement: UniqTrade provider search
The system SHALL integrate UniqTrade as the first search provider using API v2 authentication and article search.

#### Scenario: Search without brand
- **WHEN** the backend receives a search request with only an article query
- **THEN** the UniqTrade provider calls `GET /api/search/{article}?info=1`

#### Scenario: Search with brand
- **WHEN** the backend receives a search request with article and brand
- **THEN** the UniqTrade provider calls `GET /api/search/{article}?brand={brand}&info=1`

#### Scenario: Token expired
- **WHEN** UniqTrade rejects a search because the JWT token expired
- **THEN** the backend refreshes the token and retries the search once

### Requirement: Results use normalized model
The system SHALL return supplier results in a normalized response model that is stable across current and future providers.

#### Scenario: UniqTrade returns offers
- **WHEN** UniqTrade returns matching parts
- **THEN** the backend returns results containing provider identity, brand, article, title, price, quantity, remains, image metadata, provider link, and API detail URL where available

#### Scenario: Future provider is added
- **WHEN** another supplier provider is configured later
- **THEN** its results can be merged into the same normalized response without changing the browser search contract

#### Scenario: S-LINE returns offers
- **WHEN** S-LINE returns `Parts[].Offers[]`
- **THEN** the backend maps offers to remains and uses the minimum offer price as the result price without aggregating offer quantities into result quantity

#### Scenario: S-LINE displays availability
- **WHEN** the UI displays an S-LINE result
- **THEN** it omits the top-level Quantity field and shows offer quantities only in Remains

#### Scenario: Provider returns empty remains
- **WHEN** a provider returns an explicit empty remains list
- **THEN** the backend preserves the empty remains list and does not infer stock from quantity

### Requirement: Result UI displays part details and images
The system SHALL display search results with enough detail for a user to compare spare parts, including image handling.

#### Scenario: Result has supplier image
- **WHEN** a result includes a thumbnail image
- **THEN** the UI displays the thumbnail and provides access to the full image when a full image URL is available

#### Scenario: Result has no image
- **WHEN** a result has no image data
- **THEN** the UI displays a placeholder while still showing the text, price, and stock information

#### Scenario: Multiple providers return results
- **WHEN** more than one provider returns results for the same search
- **THEN** the UI identifies the source provider for each result

#### Scenario: Provider returns no matches while another provider has results
- **WHEN** one provider returns zero matches and another provider returns results
- **THEN** the UI displays the successful results and indicates which provider had no matches

#### Scenario: Result has provider action link
- **WHEN** a result includes a direct provider URL or enough data to build a provider search URL
- **THEN** the UI displays an action that opens the result or corresponding provider search page

#### Scenario: Result provider label has home link
- **WHEN** a result includes provider home URL
- **THEN** the UI displays the provider label as a link to the provider home page

#### Scenario: S-LINE result has provider action link
- **WHEN** S-LINE returns a result without a direct product URL
- **THEN** the UI displays an action link to `https://s-line.ua/Home/Index?search={article}`

#### Scenario: Result has remains
- **WHEN** a result includes warehouse remains
- **THEN** the UI displays the remains separately from quantity

#### Scenario: Result action layout is consistent
- **WHEN** any provider result includes a provider action link
- **THEN** the UI displays the provider action before remains in the same card location for every provider

#### Scenario: Result has no remains
- **WHEN** a result includes an explicit empty remains list
- **THEN** the UI displays a clear no-stock-remains state instead of using quantity as a substitute

### Requirement: Search failure states are explicit
The system SHALL show clear states for no results, provider errors, authentication failures, and partial multi-provider failures.

#### Scenario: No matching results
- **WHEN** all configured providers return no matches
- **THEN** the UI displays a no-results state without treating the search as a technical failure

#### Scenario: Provider unavailable
- **WHEN** a provider request times out or fails
- **THEN** the backend returns provider error metadata and the UI shows that the provider failed

#### Scenario: Provider timeout
- **WHEN** a provider request exceeds the configured timeout
- **THEN** the backend returns timeout metadata and the UI suggests trying a more exact article number

#### Scenario: One provider fails and another succeeds
- **WHEN** at least one provider returns results and another provider fails
- **THEN** the UI displays the successful results and indicates the failed provider separately

### Requirement: Search diagnostics are available
The system SHALL provide optional server-side search logging for debugging supplier responses and availability mismatches.

#### Scenario: Summary logging is enabled
- **WHEN** `SEARCH_LOG_LEVEL=summary`
- **THEN** the server logs query, provider state, result count, quantity, remains summary, price, provider URL, and API detail URL

#### Scenario: Raw logging is enabled
- **WHEN** `SEARCH_LOG_LEVEL=raw`
- **THEN** the server logs the redacted raw supplier response in addition to the summary

#### Scenario: Sensitive fields are logged
- **WHEN** logged data includes token, password, secret, or credential fields
- **THEN** the system redacts those fields before writing logs

### Requirement: Alternative access channels reuse search backend
The system SHALL make the same backend search operation reusable by non-web channels.

#### Scenario: Chat bot channel searches parts
- **WHEN** a future chat bot sends an article query to the backend search endpoint
- **THEN** it receives the same normalized result data used by the web UI

#### Scenario: Spreadsheet import searches many parts
- **WHEN** a future batch workflow submits multiple article queries
- **THEN** it uses provider adapters through the backend instead of implementing separate supplier API calls
