// Search: the request body actually sent to Perplexity, and the shaping applied
// to the response (dedupe, rerank, auto source profiles, indexed rendering).

import test from "node:test";
import assert from "node:assert/strict";

import {
  runSearch,
  formatSearchResults,
  buildSearchStructured,
  dedupeSearchResults,
  scoreSearchResult,
  detectAutoSearchSourcePreset,
  applyAutoSearchSourcePreset,
  applySearchProfile,
  searchAppliedFilters,
  suggestSearchAlternatives,
  validateSearchArgs,
} from "../src/index.js";
import { fixture, installFetch } from "./helpers/harness.mjs";

const SEARCH_JSON = fixture("perplexity-search.json");
const API = "https://api.perplexity.ai/search";

function searchStub(body = SEARCH_JSON, status = 200) {
  return installFetch([
    { url: API, method: "POST", status, body, headers: { "content-type": "application/json" } },
  ]);
}

function sentBody(stub) {
  return JSON.parse(String(stub.matching("api.perplexity.ai")[0].body));
}

test("search: the outgoing request carries query and paging options", async () => {
  const stub = searchStub();
  try {
    await runSearch({ query: "serverless scraping", max_results: 5, max_tokens_per_page: 512, auto_source_profile: false }, "pplx-test");
    const call = stub.matching("api.perplexity.ai")[0];
    assert.equal(call.method, "POST");
    assert.equal(call.headers.Authorization, "Bearer pplx-test");

    const body = sentBody(stub);
    assert.equal(body.query, "serverless scraping");
    assert.equal(body.max_results, 5);
    assert.equal(body.max_tokens_per_page, 512);
  } finally {
    stub.restore();
  }
});

test("search: canonical-equivalent URLs are deduplicated", () => {
  const { results, dropped } = dedupeSearchResults([
    { url: "https://www.reddit.com/r/x/comments/1/title/" },
    { url: "https://reddit.com/r/x/comments/1/title" },
    { url: "https://example.com/a" },
  ]);
  assert.equal(results.length, 2);
  assert.equal(dropped, 1);
});

test("search: results are deduped and rendered with stable [N] indexes", async () => {
  const stub = searchStub();
  try {
    const search = await runSearch({ query: "headless browser replacement", auto_source_profile: false }, "pplx-test");
    assert.equal(search.rawCount, 4);
    assert.equal(search.dropped, 1, "the mirrored Reddit URL should have been dropped");
    assert.equal(search.results.length, 3);

    const text = formatSearchResults(search, {});
    assert.match(text, /^Found 3 results/);
    assert.match(text, /Deduplication: dropped 1 duplicate/);
    assert.match(text, /\[1\] \*\*I replaced a headless browser/);
    assert.match(text, /\[3\] \*\*Short note/);
    assert.match(text, /Next step: call perplexity_fetch/);

    const structured = buildSearchStructured(search, text);
    assert.equal(structured.results.length, 3);
    assert.equal(structured.results[0].index, 1);
    assert.equal(structured.result_count, 3);
  } finally {
    stub.restore();
  }
});

test("search: rerank promotes query-matching, dated results", async () => {
  const stub = searchStub();
  try {
    const search = await runSearch({ query: "headless browser fetch logic", rerank: true, auto_source_profile: false }, "pplx-test");
    assert.match(search.results[0].title, /I replaced a headless browser/, "best-matching result was not promoted");
  } finally {
    stub.restore();
  }
  assert.ok(
    scoreSearchResult({ title: "headless browser fetch logic", snippet: "x".repeat(200), date: "2026-01-01" }, "headless browser fetch logic")
      > scoreSearchResult({ title: "unrelated" }, "headless browser fetch logic")
  );
});

test("search: named sources in the query select a matching profile", () => {
  assert.equal(detectAutoSearchSourcePreset("reddit thoughts on wrangler")?.name, "reddit");
  assert.equal(detectAutoSearchSourcePreset("디시 워커 후기")?.name, "dcinside");
  assert.equal(detectAutoSearchSourcePreset("나무위키 서버리스")?.name, "namu");
  assert.equal(detectAutoSearchSourcePreset("just a plain question"), null);

  const { opts, notes } = applyAutoSearchSourcePreset({ query: "reddit thoughts on wrangler" });
  assert.equal(opts.auto_source_preset, "reddit");
  assert.deepEqual(opts.search_domain_filter, ["reddit.com"]);
  assert.ok(notes.length > 0);
});

test("search: explicit filters are never overridden by the auto profile", () => {
  const { opts, notes } = applyAutoSearchSourcePreset({
    query: "reddit thoughts on wrangler",
    search_domain_filter: ["example.com"],
  });
  assert.deepEqual(opts.search_domain_filter, ["example.com"]);
  assert.ok(notes.some((n) => /did not override/.test(n)));

  const disabled = applyAutoSearchSourcePreset({ query: "reddit thoughts", auto_source_profile: false });
  assert.equal(disabled.opts.auto_source_preset, undefined);
});

test("search: source_profile presets supply language and domain defaults", () => {
  const { opts } = applySearchProfile({ query: "논문", source_profile: "academic", auto_source_profile: false });
  assert.ok((opts.search_domain_filter || []).length > 0, "academic profile added no domains");
  assert.ok(searchAppliedFilters(opts).some((f) => f.startsWith("profile=academic")));
});

test("search: an empty result set returns actionable suggestions instead of silence", async () => {
  const stub = searchStub('{"results":[]}');
  try {
    const search = await runSearch({ query: "짧은질의", auto_source_profile: false }, "pplx-test");
    const text = formatSearchResults(search, {});
    assert.match(text, /No search results found/);
    assert.match(text, /Try next:/);
  } finally {
    stub.restore();
  }
  assert.ok(suggestSearchAlternatives({ query: "한국어 최신 소식" }).length > 0);
});

test("search: API errors surface rather than being swallowed", async () => {
  const stub = searchStub("rate limited", 429);
  try {
    await assert.rejects(
      () => runSearch({ query: "x", auto_source_profile: false }, "pplx-test"),
      /Perplexity API error: 429/
    );
  } finally {
    stub.restore();
  }
});

test("search: contradictory argument combinations are rejected up front", () => {
  // validateSearchArgs returns "" when valid, otherwise the message shown to the caller.
  assert.match(
    validateSearchArgs({ query: "x", search_recency_filter: "week", search_after_date_filter: "01/01/2026" }),
    /mutually exclusive/i
  );
  assert.match(
    validateSearchArgs({ query: "x", search_domain_filter: ["example.com", "-spam.example"] }),
    /allowlist entries or all denylist entries/i
  );
  assert.equal(validateSearchArgs({ query: "x", search_recency_filter: "week", auto_source_profile: false }), "");
  assert.equal(validateSearchArgs({ query: "x", search_domain_filter: ["-spam.example"], auto_source_profile: false }), "");
});
