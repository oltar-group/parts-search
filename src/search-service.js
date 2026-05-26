import { providerErrorToResponse } from "./providers/provider-error.js";
import { redactSensitive } from "./redact.js";
import { logEvent } from "./logger.js";

export function validateSearchInput(query) {
  const article = String(query.q || query.article || "").trim();
  const brand = String(query.brand || "").trim();

  if (!article) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "empty_query",
        message: "Article query is required"
      }
    };
  }

  if (article.length > 80 || brand.length > 80) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_query",
        message: "Article and brand must be 80 characters or less"
      }
    };
  }

  if (!/[0-9]/.test(article) && !brand) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "article_too_broad",
        message:
          "Search by article number, not by brand only. Example: WL7129-12 or OC90."
      }
    };
  }

  return { ok: true, article, brand };
}

export async function searchParts({
  query,
  providers,
  includeImages = true,
  logLevel = "off"
}) {
  const validation = validateSearchInput(query);
  if (!validation.ok) {
    return {
      status: validation.status,
      body: {
        query: {
          article: String(query.q || query.article || "").trim(),
          brand: String(query.brand || "").trim()
        },
        results: [],
        errors: [validation.error],
        providers: [],
        meta: { durationMs: 0, partial: false }
      }
    };
  }

  const startedAt = Date.now();
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const results = await provider.search({
        article: validation.article,
        brand: validation.brand,
        includeImages
      });

      return { provider, results };
    })
  );

  const results = [];
  const errors = [];
  const providerStates = [];

  for (let index = 0; index < settled.length; index += 1) {
    const provider = providers[index];
    const entry = settled[index];

    if (entry.status === "fulfilled") {
      results.push(...redactSensitive(entry.value.results));
      providerStates.push({
        id: provider.id,
        name: provider.name,
        ok: true,
        count: entry.value.results.length
      });
    } else {
      errors.push(providerErrorToResponse(entry.reason, provider));
      providerStates.push({
        id: provider.id,
        name: provider.name,
        ok: false
      });
    }
  }

  const body = {
    query: { article: validation.article, brand: validation.brand },
    results,
    errors,
    providers: providerStates,
    meta: {
      durationMs: Date.now() - startedAt,
      partial: results.length > 0 && errors.length > 0
    }
  };

  if (logLevel === "summary" || logLevel === "raw") {
    logEvent({
          event: "parts.search_response",
          query: body.query,
          resultCount: body.results.length,
          errors: body.errors,
          providers: body.providers,
          durationMs: body.meta.durationMs
        });
  }

  return {
    status: 200,
    body
  };
}
