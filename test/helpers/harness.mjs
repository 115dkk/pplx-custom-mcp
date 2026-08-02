// Shared test harness: fixture loading and a routed globalThis.fetch stub.
//
// Every network-touching test drives the real code path (fetchPageWithFallbacks,
// fetchDcinsideComments, runSearch, …) against recorded fixtures instead of the
// live internet, so the suite is deterministic and needs no API key.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixture(name) {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

export function fixtureJson(name) {
  return JSON.parse(fixture(name));
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input.url === "string") return input.url;
  return String(input);
}

function routeMatches(route, url, init) {
  if (route.method && (init.method || "GET").toUpperCase() !== route.method.toUpperCase()) return false;
  const target = route.url;
  if (typeof target === "function") return !!target(url, init);
  if (target instanceof RegExp) return target.test(url);
  if (typeof target === "string") return url === target || url.startsWith(target);
  return false;
}

/**
 * Install a routed fetch stub.
 *
 * Each route is `{ url, method?, status?, headers?, body }` where `url` is a
 * string prefix, a RegExp, or a predicate, and `body` is a string or a
 * `(url, init) => string` function. An unmatched request throws, so a test that
 * silently starts hitting a new endpoint fails loudly instead of hanging.
 */
export function installFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = (init.method || "GET").toUpperCase();
    const call = { url, method, body: init.body ?? null, headers: init.headers || {} };
    calls.push(call);

    for (const route of routes) {
      if (!routeMatches(route, url, init)) continue;
      const body = typeof route.body === "function" ? route.body(url, init) : route.body;
      const headers = { "content-type": "text/html; charset=utf-8", ...(route.headers || {}) };
      return new Response(body ?? "", { status: route.status ?? 200, headers });
    }

    throw new Error(`unstubbed fetch: ${method} ${url}`);
  };

  return {
    calls,
    /** Calls whose URL contains `needle`. */
    matching(needle) {
      return calls.filter((c) => c.url.includes(needle));
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Parse an `application/x-www-form-urlencoded` request body captured by the stub. */
export function formBody(call) {
  return Object.fromEntries(new URLSearchParams(String(call.body || "")));
}

/** Options that keep a fetch under test hermetic and cheap. */
export const OFFLINE = { use_cache: false, include_images: false };
