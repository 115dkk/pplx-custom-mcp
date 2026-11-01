// The Perplexity fallback searches for a page instead of fetching it, so it can
// return a document that is not the one that was asked for. Returning the wrong
// page is worse than returning nothing: the caller cannot tell the difference.

import test from "node:test";
import assert from "node:assert/strict";

import { sameDocument, isOpaqueSlug, fetchViaPerplexity, fetchRemoteBody, fetchAndFormat, namuReadableDocumentUrl, namuRemoteDocumentUrls } from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const API = "https://api.perplexity.ai/search";
const THREAD_URL = "https://namu.wiki/thread/FunnySulkySpuriousGate";
const ARTICLE_URL = "https://namu.wiki/w/나무위키";
const RAW_ARTICLE_URL = "https://namu.wiki/raw/나무위키";
const RAW_REVISION_URL = `${RAW_ARTICLE_URL}?rev=5161`;
const REVISION_URL = `${ARTICLE_URL}?rev=5161`;
const EN_REVISION_URL = "https://en.namu.wiki/w/나무위키?rev=5161";

test("namu: raw URLs have an equivalent readable document URL for remote fallbacks", () => {
  const normalizedArticleUrl = new URL(ARTICLE_URL).toString();
  assert.equal(namuReadableDocumentUrl(RAW_ARTICLE_URL), normalizedArticleUrl);
  assert.equal(namuReadableDocumentUrl(`${RAW_ARTICLE_URL}?rev=123`), `${normalizedArticleUrl}?rev=123`);
  assert.equal(namuReadableDocumentUrl(ARTICLE_URL), normalizedArticleUrl);
  assert.equal(namuReadableDocumentUrl("https://example.com/raw/나무위키"), "https://example.com/raw/%EB%82%98%EB%AC%B4%EC%9C%84%ED%82%A4");
});

test("namu: historical remote candidates preserve the exact revision", () => {
  assert.deepEqual(namuRemoteDocumentUrls(RAW_REVISION_URL), [
    new URL(REVISION_URL).toString(),
    new URL(EN_REVISION_URL).toString(),
  ]);
  assert.deepEqual(namuRemoteDocumentUrls(RAW_ARTICLE_URL), [new URL(ARTICLE_URL).toString()]);
});

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

test("agent: a blocked NamuWiki raw URL is fetched through the equivalent /w/ document", async () => {
  const stub = agentStub({
    agent: agentHit(ARTICLE_URL, "나무위키는 한국어 위키위키 사이트이다. ".repeat(8)),
    search: [{ title: "should not be used", url: ARTICLE_URL, snippet: "search fallback" }],
  });
  const warnings = [];
  try {
    const out = await fetchRemoteBody(RAW_ARTICLE_URL, 8000, "pplx-test", warnings);
    assert.ok(out, "the readable document URL was not used");
    assert.equal(out.source, "agent-fetch-url");
    const request = JSON.parse(String(stub.matching("/v1/agent")[0].body));
    assert.match(request.input, new RegExp(encodeURI(ARTICLE_URL)));
    assert.doesNotMatch(request.input, /\/raw\//);
    assert.ok(warnings.some((warning) => /정규 \/w\/ URL/.test(warning)));
    assert.equal(stub.matching("/search").length, 0, "search should not be billed after the canonical fetch succeeds");
  } finally {
    stub.restore();
  }
});

test("agent: a historical NamuWiki raw URL accepts only the exact rev from either frontend", async () => {
  const exactEnglishRevision = new URL(EN_REVISION_URL).toString();
  const stub = agentStub({
    agent: {
      output: [{
        type: "fetch_url_results",
        contents: [
          { url: new URL(`${ARTICLE_URL}?rev=5162`).toString(), title: "wrong revision", snippet: "현재판이 섞이면 안 됩니다." },
          { url: exactEnglishRevision, title: "r5161", snippet: "정확한 과거판 본문입니다. ".repeat(8) },
        ],
      }],
    },
    search: [],
  });
  const warnings = [];
  try {
    const out = await fetchRemoteBody(RAW_REVISION_URL, 8000, "pplx-test", warnings);
    assert.ok(out, "the exact language-frontend revision was not used");
    assert.match(out.text, /정확한 과거판 본문입니다/);
    assert.doesNotMatch(out.text, /현재판이 섞이면/);
    const request = JSON.parse(String(stub.matching("/v1/agent")[0].body));
    assert.equal(request.preset, "pro-search");
    assert.equal(request.model, undefined);
    assert.equal(request.max_steps, 1);
    assert.equal(request.max_output_tokens, 32);
    assert.equal(request.tools[0].max_urls, 1);
    assert.ok(!request.input.includes(new URL(REVISION_URL).toString()));
    assert.ok(request.input.includes(exactEnglishRevision));
    assert.ok(warnings.some((warning) => /같은 rev의 영어/.test(warning)));
    assert.equal(stub.matching("/search").length, 0);
  } finally {
    stub.restore();
  }
});

test("agent: a historical NamuWiki result without the requested rev is rejected", async () => {
  const stub = agentStub({
    agent: agentHit(ARTICLE_URL, "이것은 현재판이므로 과거판 대신 반환되면 안 됩니다."),
    search: [],
  });
  try {
    assert.equal(await fetchRemoteBody(RAW_REVISION_URL, 8000, "pplx-test", []), null);
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

test("agent: a skipped fetch_url call is reported explicitly", async () => {
  const stub = agentStub({ agent: { output: [{ type: "message" }] }, search: [] });
  const warnings = [];
  try {
    assert.equal(await fetchRemoteBody(ARTICLE_URL, 8000, "pplx-test", warnings), null);
    assert.ok(warnings.some((warning) => /tool_not_called \(message\)/.test(warning)));
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

// ── Wayback Machine snapshot fallback ───────────────────────────────
// namu.wiki's WAF blocks Workers egress and Perplexity's fetcher alike, but
// web.archive.org keeps full server-rendered captures and stays reachable.
// The archive must serve the FULL page for free before any paid call for
// NamuWiki, and act as the backstop after paid retrieval elsewhere.

const WAYBACK_AVAILABILITY = "https://archive.org/wayback/available";
const CHALLENGE_HTML = "<html><head><title>Just a moment...</title></head><body>Access denied</body></html>";
const NAMU_ARTICLE_HTML = fixture("namu-article.html");
const NAMU_SNAPSHOT_TS = "20260611142531";
const NAMU_PAGE_URL = "https://namu.wiki/w/서버리스";

function waybackClosest(originalUrl, timestamp = NAMU_SNAPSHOT_TS) {
  return { available: true, status: "200", timestamp, url: `http://web.archive.org/web/${timestamp}/${originalUrl}` };
}

function waybackStub({ closest, snapshotBody = "", extraRoutes = [] }) {
  return installFetch([
    { url: "https://www.namu.moe/", status: 404, body: fixture("namu-mirror-missing.html") },
    { url: WAYBACK_AVAILABILITY, body: JSON.stringify({ archived_snapshots: closest ? { closest } : {} }), headers: { "content-type": "application/json" } },
    { url: (u) => u.includes("id_/"), body: snapshotBody },
    ...extraRoutes,
    { url: (u) => u.startsWith("https://namu.wiki/") || u.startsWith("https://en.namu.wiki/"), status: 403, body: CHALLENGE_HTML },
  ]);
}

test("wayback: a blocked NamuWiki page is served in full from the archive without a paid call", async () => {
  const stub = waybackStub({
    closest: waybackClosest(NAMU_PAGE_URL),
    snapshotBody: NAMU_ARTICLE_HTML,
  });
  try {
    const { result, text } = await fetchAndFormat(NAMU_PAGE_URL, "pplx-test", OFFLINE);
    assert.equal(result.ok, true);
    assert.equal(result.source, "wayback");
    assert.match(text, /Wayback Machine 스냅샷/);
    assert.match(text, /2026-06-11/, "the capture date must be visible to the caller");
    assert.match(text, /코드 실행 단위로만 과금되는 실행 모델/, "the full article body should be present, not a snippet");
    assert.doesNotMatch(text, /IP 우회 수단/, "the namu extractor must run on the archived markup");
    assert.equal(result.structured.archived_at, "2026-06-11");
    assert.equal(stub.matching("api.perplexity.ai").length, 0, "the free archive hit must pre-empt every paid call");
    assert.ok(result.warnings.some((warning) => /Wayback Machine 스냅샷/.test(warning)));
  } finally {
    stub.restore();
  }
});

test("wayback: no usable capture falls through to the Perplexity ladder", async () => {
  const stub = installFetch([
    { url: WAYBACK_AVAILABILITY, body: JSON.stringify({ archived_snapshots: {} }), headers: { "content-type": "application/json" } },
    { url: AGENT_API, method: "POST", body: JSON.stringify({ output: [] }), headers: { "content-type": "application/json" } },
    { url: API, method: "POST", body: JSON.stringify({ results: [{ title: "나무위키", url: ARTICLE_URL, snippet: "한국어 위키위키 사이트이다." }] }), headers: { "content-type": "application/json" } },
    { url: (u) => u.startsWith("https://namu.wiki/"), status: 403, body: CHALLENGE_HTML },
  ]);
  try {
    const { result, text } = await fetchAndFormat(ARTICLE_URL, "pplx-test", OFFLINE);
    assert.equal(result.source, "perplexity");
    assert.match(text, /한국어 위키위키 사이트이다/);
    assert.equal(stub.calls.filter((call) => call.url.startsWith(WAYBACK_AVAILABILITY)).length, 1, "the archive should have been consulted before paying");
  } finally {
    stub.restore();
  }
});

test("wayback: an archived challenge page is discarded, not presented as content", async () => {
  const stub = waybackStub({
    closest: waybackClosest(NAMU_PAGE_URL),
    snapshotBody: CHALLENGE_HTML,
  });
  try {
    const { result } = await fetchAndFormat(NAMU_PAGE_URL, "", OFFLINE);
    assert.notEqual(result.source, "wayback", "an archived WAF page proves nothing and must be rejected");
    assert.equal(result.source, "metadata");
  } finally {
    stub.restore();
  }
});

test("wayback: a capture of a different document is rejected before it is fetched", async () => {
  const stub = waybackStub({
    closest: waybackClosest("https://namu.wiki/w/나무위키"),
    snapshotBody: NAMU_ARTICLE_HTML,
  });
  try {
    const { result } = await fetchAndFormat(NAMU_PAGE_URL, "", OFFLINE);
    assert.notEqual(result.source, "wayback");
    assert.equal(stub.matching("id_/").length, 0, "the near-miss snapshot must not even be fetched");
  } finally {
    stub.restore();
  }
});

test("wayback: for non-Namu sites the archive is the backstop after paid retrieval fails", async () => {
  const PAGE_URL = "https://example.com/blog/no-headless";
  const stub = installFetch([
    { url: WAYBACK_AVAILABILITY, body: JSON.stringify({ archived_snapshots: { closest: waybackClosest(PAGE_URL, "20260618100000") } }), headers: { "content-type": "application/json" } },
    { url: (u) => u.includes("id_/"), body: fixture("generic-article.html") },
    { url: AGENT_API, method: "POST", body: JSON.stringify({ output: [] }), headers: { "content-type": "application/json" } },
    { url: API, method: "POST", body: JSON.stringify({ results: [] }), headers: { "content-type": "application/json" } },
    { url: "https://example.com/", status: 403, body: CHALLENGE_HTML },
  ]);
  try {
    const { result, text } = await fetchAndFormat(PAGE_URL, "pplx-test", OFFLINE);
    assert.equal(result.source, "wayback");
    assert.match(text, /headless browser/);
    const firstArchiveCall = stub.calls.findIndex((call) => call.url.startsWith(WAYBACK_AVAILABILITY));
    const firstPaidCall = stub.calls.findIndex((call) => call.url.startsWith("https://api.perplexity.ai/"));
    assert.ok(firstPaidCall !== -1, "paid retrieval should have been attempted");
    assert.ok(firstArchiveCall > firstPaidCall, "paid retrieval keeps priority for non-Namu sites");
  } finally {
    stub.restore();
  }
});
