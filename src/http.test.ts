import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithRetry } from "./http.js";

test("fetchWithRetry retries GitHub rate limits when retry-after is immediate", async (t) => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await fetchWithRetry("https://api.github.com/test", {}, "rate-limit-test", {
    maxRetries: 1,
    maxRateLimitWaitMs: 1,
  });

  assert.equal(callCount, 2);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("fetchWithRetry returns the original rate-limited response when reset window exceeds cap", async (t) => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response("rate limited", {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor((Date.now() + 5 * 60 * 1000) / 1000)),
      },
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await fetchWithRetry("https://api.github.com/test", {}, "rate-limit-cap-test", {
    maxRetries: 2,
    maxRateLimitWaitMs: 10,
  });

  assert.equal(callCount, 1);
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "rate limited");
});