// Cloudflare Worker entry point. Runs the same search code as src/server.js;
// static files come from the ASSETS binding and search counters from the
// optional STATS KV binding, because Workers have no persistent file system.
import pkg from "../package.json" with { type: "json" };
import { readConfig } from "./config.js";
import { createProviders } from "./providers/index.js";
import { searchParts } from "./search-service.js";
import { summarizeStats } from "./search-stats.js";

const STATS_KEY = "search-stats";
const JWKS_TTL_MS = 60 * 60 * 1000;

// Kept per isolate so supplier login tokens are reused between requests.
let runtime = null;
let jwks = null;

export default {
  async fetch(request, env, ctx) {
    try {
      if (!(await isAuthorized(request, env))) {
        return json(403, {
          error: { code: "access_denied", message: "Cloudflare Access login required" }
        });
      }

      const url = new URL(request.url);
      const { config, providers } = getRuntime(env);

      if (url.pathname === "/api/health") {
        return json(200, {
          ok: true,
          build: config.build,
          providers: providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            configured:
              typeof provider.isConfigured === "function"
                ? provider.isConfigured()
                : true
          }))
        });
      }

      if (url.pathname === "/api/search-stats") {
        return json(200, summarizeStats(await readStats(env.STATS)));
      }

      if (url.pathname === "/api/parts/search") {
        const result = await searchParts({
          query: Object.fromEntries(url.searchParams),
          providers,
          includeImages: config.includeSupplierImages,
          logLevel: config.searchLogLevel
        });
        if (result.status === 200 && env.STATS) {
          ctx.waitUntil(recordSearch(env.STATS));
        }
        return json(result.status, result.body);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json(500, {
        error: {
          code: "server_error",
          message: error?.message || "Unexpected server error"
        }
      });
    }
  }
};

function getRuntime(env) {
  if (!runtime) {
    const config = readConfig({
      ...env,
      BUILD_VERSION: env.BUILD_VERSION || pkg.version
    });
    // Providers call this.fetchImpl(), and Workers reject fetch invoked as a
    // method of another object ("Illegal invocation").
    const fetchImpl = (...args) => fetch(...args);
    for (const section of ["uniqtrade", "sline", "tehnomir", "autonova", "optionauto"]) {
      config[section].fetchImpl = fetchImpl;
    }
    runtime ={ config, providers: createProviders(config) };
  }
  return runtime;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function readStats(kv) {
  const stored = kv ? await kv.get(STATS_KEY, "json") : null;
  return stored || { totalSearches: 0, firstSearchAt: "", lastSearchAt: "", daily: {} };
}

async function recordSearch(kv) {
  try {
    const data = await readStats(kv);
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    data.totalSearches += 1;
    data.daily[day] = (data.daily[day] || 0) + 1;
    data.firstSearchAt ||= now;
    data.lastSearchAt = now;
    await kv.put(STATS_KEY, JSON.stringify(data));
  } catch (error) {
    console.error(`Failed to record search stats: ${error.message}`);
  }
}

// Fails closed: without a valid Cloudflare Access token nothing is served, so
// a deploy made before Access is configured cannot expose supplier accounts.
// Production traffic never has a localhost hostname; only local runs started
// with `wrangler dev --local-upstream 127.0.0.1:8787` do.
async function isAuthorized(request, env) {
  const { hostname } = new URL(request.url);
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return false;
  }

  try {
    return await verifyAccessToken(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  } catch {
    return false;
  }
}

async function verifyAccessToken(token, teamDomain, audience) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  if (header.alg !== "RS256") {
    return false;
  }

  const jwk = await findSigningKey(teamDomain, header.kid);
  if (!jwk) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  if (!signatureValid) {
    return false;
  }

  const nowSeconds = Date.now() / 1000;
  const audiences = [payload.aud].flat();
  return (
    payload.iss === `https://${teamDomain}` &&
    audiences.includes(audience) &&
    Number.isFinite(payload.exp) &&
    payload.exp > nowSeconds &&
    (payload.nbf === undefined || payload.nbf <= nowSeconds)
  );
}

async function findSigningKey(teamDomain, kid) {
  const fresh =
    jwks && jwks.teamDomain === teamDomain && Date.now() - jwks.fetchedAt < JWKS_TTL_MS;
  const cached = fresh ? jwks.keys.find((key) => key.kid === kid) : null;
  if (cached) {
    return cached;
  }

  // An unknown kid can mean Cloudflare rotated its keys, so refetch.
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) {
    return null;
  }
  const { keys } = await response.json();
  jwks = { teamDomain, keys, fetchedAt: Date.now() };
  return keys.find((key) => key.kid === kid) || null;
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function decodeBase64Url(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
