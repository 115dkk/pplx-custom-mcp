import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  __setSleepForTests,
  createServer,
  degradationCause,
  fetchPageWithFallbacks,
  fetchRemoteBody,
  looksBlocked,
  makeApiRequest,
} from "../src/index.js";
import { fixture, installFetch } from "./helpers/harness.mjs";

const ARTICLE_HTML = fixture("generic-article.html");

async function connect() {
  const server = createServer("pplx-test");
  const client = new Client({ name: "budget-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, async close() { await client.close(); await server.close(); } };
}

test("budget: an attempt timeout stops UA rotation", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_input, init = {}) => new Promise((_resolve, reject) => {
    calls++;
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  try {
    const result = await fetchPageWithFallbacks("https://example.com/hang", "", {
      use_cache: false,
      debug: true,
      attempt_timeout_ms: 20,
      deadline_ms: 100,
    });
    assert.equal(calls, 1);
    assert.equal(result.debugInfo.attempts.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("budget: insufficient time skips Perplexity fetch_url", async () => {
  const stub = installFetch([
    { url: "https://example.com/blocked", status: 403, body: "Access denied" },
  ]);
  try {
    const result = await fetchPageWithFallbacks("https://example.com/blocked", "pplx-test", {
      use_cache: false,
      deadline_ms: 50,
    });
    assert.equal(stub.matching("/v1/agent").length, 0);
    assert.ok(result.warnings.includes("시간 예산 부족으로 Perplexity fetch_url 생략"));
  } finally {
    stub.restore();
  }
});

test("api: 429 is retried and can recover", async () => {
  let calls = 0;
  const stub = installFetch([{
    url: "https://api.perplexity.ai/search",
    method: "POST",
    body: () => ++calls === 1 ? "rate limited" : JSON.stringify({ results: [] }),
    status: 200,
    headers: { "content-type": "application/json" },
  }]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    return response;
  };
  __setSleepForTests(async () => {});
  try {
    const response = await makeApiRequest("search", { query: "x" }, "pplx-test", 10_000);
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    __setSleepForTests();
    stub.restore();
  }
});

test("api: response body remains inside the request timeout", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => {
    let timer;
    const stream = new ReadableStream({
      start(controller) {
        timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('{"results":[]}'));
          controller.close();
        }, 500);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
      cancel() {
        clearTimeout(timer);
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  };
  const started = Date.now();
  try {
    await assert.rejects(
      makeApiRequest("search", { query: "x" }, "pplx-test", 30),
      /Perplexity API timeout \(30 ms\)\./
    );
    assert.ok(Date.now() - started < 250, "body timeout did not abort promptly");
  } finally {
    globalThis.fetch = original;
  }
});

test("api: persistent 429 stops after one retry", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response("rate limited", { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "0" } });
  };
  __setSleepForTests(async () => {});
  try {
    await assert.rejects(
      makeApiRequest("search", { query: "x" }, "pplx-test", 10_000),
      /Perplexity API error: 429 Too Many Requests/
    );
    assert.equal(calls, 2);
  } finally {
    __setSleepForTests();
    globalThis.fetch = original;
  }
});

test("budget: Agent timeout leaves one search fallback attempt", async () => {
  const original = globalThis.fetch;
  let searches = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/v1/agent")) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    if (url.endsWith("/search")) {
      searches++;
      return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unstubbed fetch: ${url}`);
  };
  try {
    const deadline = {
      end: Date.now() + 15_000,
      remaining() { return Math.max(0, this.end - Date.now()); },
      agent_limit_ms: 50,
      agent_min_ms: 1,
    };
    await fetchRemoteBody("https://example.com/article", 4_000, "pplx-test", [], deadline);
    assert.equal(searches, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("blocking status and timeout degradation priorities", () => {
  assert.equal(looksBlocked(419, "x"), true);
  assert.equal(looksBlocked(430, "x"), true);
  assert.equal(degradationCause({ timedOut: true }), "timeout");
  assert.equal(degradationCause({ timedOut: true, blocked: true }), "blocked");
});

test("mcp: fetch_many limits Perplexity API concurrency to two", async () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/blocked-${i + 1}`);
  const original = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  let apiCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.perplexity.ai/")) {
      apiCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      if (url.endsWith("/v1/agent")) {
        return new Response(JSON.stringify({ output: [{ type: "fetch_url_results", contents: [] }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://archive.org/wayback/available")) {
      return new Response(JSON.stringify({ archived_snapshots: {} }), { headers: { "content-type": "application/json" } });
    }
    if (urls.includes(url)) return new Response("Access denied", { status: 403 });
    throw new Error(`unstubbed fetch: ${url}`);
  };
  const { client, close } = await connect();
  try {
    const result = await client.callTool({
      name: "perplexity_fetch_many",
      arguments: { urls, use_cache: false },
    });
    assert.equal(result.structuredContent.items.length, 5);
    assert.ok(apiCalls >= 10, `expected Agent and search calls, got ${apiCalls}`);
    assert.ok(maxActive <= 2, `Perplexity concurrency reached ${maxActive}`);
  } finally {
    await close();
    globalThis.fetch = original;
  }
});

test("mcp: fetch_many runs concurrently and preserves input order", async () => {
  const urls = ["https://example.com/slow-one", "https://example.com/slow-two"];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!urls.includes(url)) throw new Error(`unstubbed fetch: ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const marker = url.endsWith("one") ? "FIRST MARKER" : "SECOND MARKER";
    return new Response(ARTICLE_HTML.replace("almost none of it reading", `${marker} while reading`), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  const { client, close } = await connect();
  try {
    const started = Date.now();
    const result = await client.callTool({
      name: "perplexity_fetch_many",
      arguments: { urls, use_cache: false },
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 260, `expected parallel completion, got ${elapsed}ms`);
    assert.deepEqual(result.structuredContent.items.map((item) => item.url), urls);
    assert.match(result.structuredContent.items[0].text, /FIRST MARKER/);
    assert.match(result.structuredContent.items[1].text, /SECOND MARKER/);
  } finally {
    await close();
    globalThis.fetch = original;
  }
});
