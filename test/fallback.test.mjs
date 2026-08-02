// The Perplexity fallback searches for a page instead of fetching it, so it can
// return a document that is not the one that was asked for. Returning the wrong
// page is worse than returning nothing: the caller cannot tell the difference.

import test from "node:test";
import assert from "node:assert/strict";

import { sameDocument, isOpaqueSlug, fetchViaPerplexity, fetchRemoteBody, fetchAndFormat } from "../src/index.js";
import { installFetch, OFFLINE } from "./helpers/harness.mjs";

const API = "https://api.perplexity.ai/search";
const THREAD_URL = "https://namu.wiki/thread/FunnySulkySpuriousGate";
const ARTICLE_URL = "https://namu.wiki/w/나무위키";

function searchStub(results) {
  return installFetch([
    { url: API, method: "POST", body: JSON.stringify({ results }), headers: { "content-type": "application/json" } },
    { url: "https://namu.wiki/", status: 403, body: "<html><head><title>Just a moment...</title></head><body>Access denied</body></html>" },
  ]);
}

test("fallback: a different document on the same domain is not the requested page", () => {
  assert.equal(sameDocument(THREAD_URL, "https://en.namu.wiki/w/%ED%8C%80%20%ED%8F%AC%ED%8A%B8%EB%A6%AC%EC%8A%A4%202"), false);
  assert.equal(sameDocument(ARTICLE_URL, "https://namu.wiki/w/서버리스"), false);
  assert.equal(sameDocument("https://example.com/a", "https://evil.com/a"), false, "host must match");
});

test("fallback: language variants and trailing slashes are still the same document", () => {
  assert.equal(sameDocument(ARTICLE_URL, "https://namu.wiki/w/나무위키"), true);
  assert.equal(sameDocument(ARTICLE_URL, "https://en.namu.wiki/w/%EB%82%98%EB%AC%B4%EC%9C%84%ED%82%A4"), true);
  assert.equal(sameDocument("https://example.com/a/", "https://example.com/a"), true);
});

test("fallback: identity carried in the query string has to match too", () => {
  const post = "https://gall.dcinside.com/board/view/?id=programming&no=1";
  assert.equal(sameDocument(post, "https://gall.dcinside.com/board/view/?id=programming&no=2"), false);
  assert.equal(sameDocument(post, "https://gall.dcinside.com/board/view/?id=programming&no=1&page=2"), true);
});

test("fallback: opaque identifiers are recognised as unsearchable", () => {
  for (const slug of ["FunnySulkySpuriousGate", "deadbeefdeadbeef01", "3f6a1b2c-9d4e-4a1b-8c2d-1e2f3a4b5c6d"]) {
    assert.equal(isOpaqueSlug(slug), true, `${slug} should be treated as an opaque id`);
  }
  for (const slug of ["나무위키", "no headless browser", "Anycast", "Team Fortress"]) {
    assert.equal(isOpaqueSlug(slug), false, `${slug} is a real title and must stay searchable`);
  }
});

test("fallback: an unrelated search hit is rejected rather than returned", async () => {
  const stub = searchStub([
    { title: "Team Fortress 2/Freak", url: "https://en.namu.wiki/w/%ED%8C%80%20%ED%8F%AC%ED%8A%B8%EB%A6%AC%EC%8A%A4%202/%ED%94%84%EB%A6%AC%ED%81%AC", snippet: "Freaks are strange creatures." },
  ]);
  try {
    const out = await fetchViaPerplexity(ARTICLE_URL, 8000, "pplx-test");
    assert.equal(out, null, "an unrelated document must never stand in for the requested page");
  } finally {
    stub.restore();
  }
});

test("fallback: the requested document is accepted even when ranked below others", async () => {
  const stub = searchStub([
    { title: "서버리스", url: "https://namu.wiki/w/서버리스", snippet: "wrong page" },
    { title: "나무위키", url: "https://namu.wiki/w/나무위키", snippet: "한국어 위키위키 사이트이다." },
  ]);
  try {
    const out = await fetchViaPerplexity(ARTICLE_URL, 8000, "pplx-test");
    assert.ok(out, "the matching document was not found");
    assert.match(out, /# 나무위키/);
    assert.match(out, /한국어 위키위키 사이트이다/);
    assert.doesNotMatch(out, /wrong page/);
  } finally {
    stub.restore();
  }
});

test("fallback: an opaque slug does not trigger a paid search at all", async () => {
  const stub = searchStub([{ title: "anything", url: "https://namu.wiki/w/anything", snippet: "x" }]);
  try {
    const out = await fetchViaPerplexity(THREAD_URL, 8000, "pplx-test");
    assert.equal(out, null);
    assert.equal(stub.matching("api.perplexity.ai").length, 0, "no Perplexity call should be billed for an opaque id");
  } finally {
    stub.restore();
  }
});

test("fallback: a blocked page with an opaque slug reports failure, not a wrong page", async () => {
  const stub = searchStub([
    { title: "Team Fortress 2/Freak", url: "https://en.namu.wiki/w/%ED%8C%80", snippet: "Freaks are strange creatures." },
  ]);
  try {
    const { result, text } = await fetchAndFormat(THREAD_URL, "pplx-test", OFFLINE);
    assert.notEqual(result.source, "perplexity", "the fallback must not claim success here");
    assert.doesNotMatch(text, /Team Fortress/, "an unrelated document leaked into the tool output");
    assert.match(text, /경고/, "the failure should be stated plainly");
  } finally {
    stub.restore();
  }
});

// ── Agent API fetch_url fallback ────────────────────────────────────
// Measured 2026-08-02: $0.0025 (2 KB page) to $0.0073 (33 KB page) per call,
// against $0.005 for one Search API request. It retrieves the requested page
// instead of searching for it, and returns full text rather than a snippet.

const AGENT_API = "https://api.perplexity.ai/v1/agent";

function agentStub({ agent, search = [] }) {
  return installFetch([
    { url: AGENT_API, method: "POST", body: JSON.stringify(agent), headers: { "content-type": "application/json" } },
    { url: API, method: "POST", body: JSON.stringify({ results: search }), headers: { "content-type": "application/json" } },
    { url: "https://namu.wiki/", status: 403, body: "<html><head><title>Just a moment...</title></head><body>Access denied</body></html>" },
  ]);
}

const agentHit = (url, snippet, title = "제목") => ({
  output: [
    { type: "fetch_url_results", contents: [{ url, title, snippet }] },
    { type: "message" },
  ],
});

test("agent: a successful fetch_url is preferred and skips the paid search", async () => {
  const stub = agentStub({
    agent: agentHit(ARTICLE_URL, "나무위키는 한국어 위키위키 사이트이다. ".repeat(8)),
    search: [{ title: "should not be used", url: ARTICLE_URL, snippet: "search fallback" }],
  });
  try {
    const out = await fetchRemoteBody(ARTICLE_URL, 8000, "pplx-test", []);
    assert.ok(out, "fetch_url result was not used");
    assert.equal(out.source, "agent-fetch-url");
    assert.match(out.text, /한국어 위키위키 사이트이다/);
    assert.equal(stub.matching("/search").length, 0, "the search fallback should not have been billed");
  } finally {
    stub.restore();
  }
});

test("agent: a robots refusal falls through to the search fallback", async () => {
  const stub = agentStub({
    agent: agentHit(THREAD_URL, "[fetch_url: no content could be retrieved for " + THREAD_URL + " — disallow_by_robots. Do not infer values for this source.]"),
    search: [{ title: "나무위키", url: ARTICLE_URL, snippet: "한국어 위키위키 사이트이다." }],
  });
  const warnings = [];
  try {
    const out = await fetchRemoteBody(ARTICLE_URL, 8000, "pplx-test", warnings);
    assert.ok(out, "search fallback did not run after the refusal");
    assert.equal(out.source, "perplexity");
    assert.ok(warnings.some((w) => /disallow_by_robots/.test(w)), `refusal reason should be reported, got ${JSON.stringify(warnings)}`);
  } finally {
    stub.restore();
  }
});

test("agent: content fetched from a different URL is rejected", async () => {
  const stub = agentStub({
    agent: agentHit("https://namu.wiki/w/전혀다른문서", "다른 문서의 본문입니다."),
    search: [],
  });
  try {
    const out = await fetchRemoteBody(ARTICLE_URL, 8000, "pplx-test", []);
    assert.equal(out, null, "a redirected document must not stand in for the requested page");
  } finally {
    stub.restore();
  }
});

test("agent: an empty contents array is a failure, not an empty page", async () => {
  const stub = agentStub({ agent: { output: [{ type: "fetch_url_results", contents: null }] }, search: [] });
  try {
    assert.equal(await fetchRemoteBody(ARTICLE_URL, 8000, "pplx-test", []), null);
  } finally {
    stub.restore();
  }
});

test("agent: no API key means neither paid fallback is attempted", async () => {
  const stub = agentStub({ agent: agentHit(ARTICLE_URL, "x".repeat(200)), search: [] });
  try {
    assert.equal(await fetchRemoteBody(ARTICLE_URL, 8000, "", []), null);
    assert.equal(stub.calls.length, 0, "no billable call may happen without a key");
  } finally {
    stub.restore();
  }
});

test("agent: our own search fallback still runs after a fetch_url timeout", async () => {
  // fetch_url is an extra step in front of the existing fallback, never a
  // replacement. A hang, an error, or a refusal must not consume its turn.
  for (const failure of [
    { url: AGENT_API, method: "POST", body: () => { throw new Error("Perplexity API timeout (20000 ms)."); } },
    { url: AGENT_API, method: "POST", status: 500, body: "upstream exploded" },
    { url: AGENT_API, method: "POST", body: JSON.stringify({ output: [] }), headers: { "content-type": "application/json" } },
  ]) {
    const stub = installFetch([
      failure,
      { url: API, method: "POST", body: JSON.stringify({ results: [{ title: "나무위키", url: ARTICLE_URL, snippet: "한국어 위키위키 사이트이다." }] }), headers: { "content-type": "application/json" } },
    ]);
    const warnings = [];
    try {
      const out = await fetchRemoteBody(ARTICLE_URL, 8000, "pplx-test", warnings);
      assert.ok(out, "the search fallback was skipped after a fetch_url failure");
      assert.equal(out.source, "perplexity");
      assert.match(out.text, /한국어 위키위키 사이트이다/);
      assert.equal(stub.matching("/search").length, 1, "the search fallback should have been attempted exactly once");
    } finally {
      stub.restore();
    }
  }
});
