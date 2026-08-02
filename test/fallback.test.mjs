// The Perplexity fallback searches for a page instead of fetching it, so it can
// return a document that is not the one that was asked for. Returning the wrong
// page is worse than returning nothing: the caller cannot tell the difference.

import test from "node:test";
import assert from "node:assert/strict";

import { sameDocument, isOpaqueSlug, fetchViaPerplexity, fetchAndFormat } from "../src/index.js";
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
