import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import worker from "../src/worker.js";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-1";
const PUBLIC_URL = "https://parts.example.com";
const LOCAL_URL = "http://localhost:8787";

const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256"
};

let trusted;
let untrusted;
let trustedJwk;

const env = () => ({
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ASSETS: { fetch: async () => new Response("static-file") }
});
const ctx = () => {
  const pending = [];
  return { pending, waitUntil: (promise) => pending.push(promise) };
};

const base64Url = (bytes) =>
  Buffer.from(bytes).toString("base64url");

async function makeToken(privateKey, overrides = {}) {
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const payload = base64Url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}`,
      exp: Math.floor(Date.now() / 1000) + 600,
      ...overrides
    })
  );
  const signature = await crypto.subtle.sign(
    algorithm.name,
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

function publicRequest(token, path = "/api/health") {
  return new Request(`${PUBLIC_URL}${path}`, {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {}
  });
}

before(async () => {
  trusted = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  untrusted = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  trustedJwk = { ...(await crypto.subtle.exportKey("jwk", trusted.publicKey)), kid: "k1" };
});

beforeEach(() => {
  globalThis.fetch = async (url) => {
    if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [trustedJwk] });
    }
    throw new Error(`Unexpected network call: ${url}`);
  };
});

test("public host without a token is refused", async () => {
  const response = await worker.fetch(publicRequest(), env(), ctx());
  assert.equal(response.status, 403);
});

test("public host is refused while Access is not configured", async () => {
  const token = await makeToken(trusted.privateKey);
  const response = await worker.fetch(
    publicRequest(token),
    { ASSETS: env().ASSETS, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
    ctx()
  );
  assert.equal(response.status, 403);
});

test("valid Access token reaches the API and static files", async () => {
  const token = await makeToken(trusted.privateKey);
  const api = await worker.fetch(publicRequest(token), env(), ctx());
  assert.equal(api.status, 200);
  assert.equal((await api.json()).ok, true);

  const file = await worker.fetch(publicRequest(token, "/index.html"), env(), ctx());
  assert.equal(await file.text(), "static-file");
});

for (const [name, overrides] of [
  ["wrong audience", { aud: ["other"] }],
  ["wrong issuer", { iss: "https://evil.cloudflareaccess.com" }],
  ["expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
  ["future nbf", { nbf: Math.floor(Date.now() / 1000) + 600 }]
]) {
  test(`${name} is refused`, async () => {
    const token = await makeToken(trusted.privateKey, overrides);
    const response = await worker.fetch(publicRequest(token), env(), ctx());
    assert.equal(response.status, 403);
  });
}

test("token signed by another key is refused", async () => {
  const token = await makeToken(untrusted.privateKey);
  const response = await worker.fetch(publicRequest(token), env(), ctx());
  assert.equal(response.status, 403);
});

test("malformed token is refused", async () => {
  const response = await worker.fetch(publicRequest("not-a-jwt"), env(), ctx());
  assert.equal(response.status, 403);
});

test("localhost skips Access and validates the search query", async () => {
  const response = await worker.fetch(
    new Request(`${LOCAL_URL}/api/parts/search`),
    env(),
    ctx()
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).errors[0].code, "empty_query");
});

test("successful searches are counted in KV", async () => {
  const store = new Map();
  const STATS = {
    get: async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null),
    put: async (key, value) => store.set(key, value)
  };
  const context = ctx();

  const search = await worker.fetch(
    new Request(`${LOCAL_URL}/api/parts/search?q=OC90`),
    { ...env(), STATS },
    context
  );
  assert.equal(search.status, 200);
  await Promise.all(context.pending);

  const stats = await worker.fetch(
    new Request(`${LOCAL_URL}/api/search-stats`),
    { ...env(), STATS },
    ctx()
  );
  const body = await stats.json();
  assert.equal(body.totalSearches, 1);
  assert.equal(body.todaySearches, 1);
});

test("providers call fetch without a receiver, as Workers require", async () => {
  // A fresh module instance, because the runtime is cached per isolate.
  const { default: freshWorker } = await import("../src/worker.js?fetch-receiver");
  let calls = 0;
  globalThis.fetch = function () {
    calls += 1;
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(Response.json({}));
  };

  const response = await freshWorker.fetch(
    new Request(`${LOCAL_URL}/api/parts/search?q=OC90`),
    { ...env(), SLINE_API_KEY: "test-key" },
    ctx()
  );
  const body = await response.json();

  assert.ok(calls > 0);
  assert.equal(body.errors.find((error) => error.providerId === "sline"), undefined);
});

test("stats are empty without a KV binding", async () => {
  const response = await worker.fetch(
    new Request(`${LOCAL_URL}/api/search-stats`),
    env(),
    ctx()
  );
  assert.equal((await response.json()).totalSearches, 0);
});
