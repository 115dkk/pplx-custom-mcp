import test from "node:test";
import assert from "node:assert/strict";

import {
  namuMirrorUrl,
  extractNamuMirrorData,
  fetchPageWithFallbacks,
} from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const ARTICLE_HTML = fixture("namu-mirror-article.html");
const MISSING_HTML = fixture("namu-mirror-missing.html");
const CHALLENGE_HTML = "<html><head><title>Just a moment...</title></head><body>Access denied</body></html>";
const PAGE_URL = "https://namu.wiki/w/%EA%B1%B0%EC%9A%B8%20%EC%8B%9C%ED%97%98";
const MIRROR_URL = "https://www.namu.moe/w/%EA%B1%B0%EC%9A%B8%20%EC%8B%9C%ED%97%98";
const WAYBACK_AVAILABILITY = "https://archive.org/wayback/available";
const SNAPSHOT_TS = "20261030112233";

function closest(originalUrl = PAGE_URL) {
  return {
    available: true,
    status: "200",
    timestamp: SNAPSHOT_TS,
    url: `http://web.archive.org/web/${SNAPSHOT_TS}/${originalUrl}`,
  };
}

function ladderStub({ mirrorStatus = 200, mirrorBody = ARTICLE_HTML, archive = null }) {
  const routes = [
    { url: MIRROR_URL, status: mirrorStatus, body: mirrorBody },
  ];
  if (archive) {
    routes.push(
      { url: WAYBACK_AVAILABILITY, body: JSON.stringify({ archived_snapshots: { closest: closest(archive.originalUrl) } }), headers: { "content-type": "application/json" } },
      { url: (url) => url.includes("id_/"), body: archive.body || fixture("namu-article.html") },
    );
  }
  routes.push({ url: (url) => url.startsWith("https://namu.wiki/"), status: 403, body: CHALLENGE_HTML });
  return installFetch(routes);
}

test("namu mirror URL mapper accepts only current Korean document URLs", () => {
  assert.equal(namuMirrorUrl(PAGE_URL), MIRROR_URL);
  assert.equal(namuMirrorUrl("https://www.namu.wiki/raw/%EA%B1%B0%EC%9A%B8%20%EC%8B%9C%ED%97%98"), MIRROR_URL);
  assert.equal(namuMirrorUrl(`${PAGE_URL}?rev=12`), null);
  assert.equal(namuMirrorUrl(`https://en.namu.wiki/w/title`), null);
  assert.equal(namuMirrorUrl("https://namu.wiki/history/%EA%B1%B0%EC%9A%B8"), null);
  assert.equal(namuMirrorUrl("https://namu.wiki/W/title"), null);
  assert.equal(namuMirrorUrl("https://namu.wiki/RAW/title"), null);
  assert.equal(namuMirrorUrl(`${PAGE_URL}?from=search#s-1`), MIRROR_URL);
  assert.equal(namuMirrorUrl("https://example.com/w/title"), null);
  const encoded = "https://namu.wiki/w/C%2B%2B%2F%ED%91%9C%EC%A4%80";
  assert.equal(namuMirrorUrl(encoded), "https://www.namu.moe/w/C%2B%2B%2F%ED%91%9C%EC%A4%80");
  assert.equal(
    namuMirrorUrl("https://namu.wiki/raw/%EA%B1%B0%EC%9A%B8%20%EC%8B%9C%ED%97%98?from=search#s-2"),
    MIRROR_URL,
  );
});

test("namu mirror extractor keeps article content while removing mirror residue", () => {
  const out = extractNamuMirrorData(ARTICLE_HTML, PAGE_URL, "balanced", { include_links: true });
  assert.ok(out);
  assert.equal(out.missing, false);
  assert.equal(out.title, "거울 시험");
  assert.equal(out.lastModified, "2026-10-31 12:34:56");
  assert.match(out.text, /^# 거울 시험/);
  assert.match(out.text, /최근 수정 시각: 2026-10-31 12:34:56 \(KST\)/);
  assert.match(out.text, /거울 본문의 독특한 시작 문장/);
  assert.match(out.text, /위키 블록에서 보존되는 한 줄/);
  assert.match(out.text, /int main\(\) \{\n  const markers = "\[\[code\|must stay\]\] \}\}\}";\n\}/);
  assert.match(out.text, /인라인 지시문 뒤 보존문/);
  assert.match(out.text, /표시 이름/);
  assert.match(out.text, /단일 링크/);
  assert.match(out.text, /굵은 말/);
  assert.match(out.text, /기울인 말/);
  assert.match(out.text, /\[내부 문서\]\(<https:\/\/namu\.wiki\/w\/[^>]+>\)/);
  assert.match(out.text, /거울 각주의 독특한 설명/);
  assert.doesNotMatch(out.text, /목차에만 있는 독특한 문구/);
  assert.doesNotMatch(out.text, /절대 남으면 안 되는 조건부 본문|#!if|#!wiki/);
  assert.doesNotMatch(out.text, /나오면 안 되는 분류|나오면 안 되는 라이선스/);
});

test("namu mirror extractor reports a missing fixture", () => {
  assert.deepEqual(extractNamuMirrorData(MISSING_HTML, PAGE_URL), {
    text: "",
    title: "없는 문서",
    lastModified: "",
    missing: true,
  });
});

test("fallback ladder uses the live mirror before archives or paid retrieval", async () => {
  const stub = ladderStub({});
  try {
    const result = await fetchPageWithFallbacks(PAGE_URL, "pplx-test", OFFLINE);
    assert.equal(result.source, "namu-mirror");
    assert.equal(result.partial, false);
    assert.match(result.text, /^\[나무위키가 직접 접근을 차단 → 실시간 미러 namu\.moe 본문 사용/);
    assert.match(result.text, /2026-10-31 12:34:56/);
    assert.equal(stub.matching("archive.org").length, 0);
    assert.equal(stub.matching("api.perplexity.ai").length, 0);
  } finally {
    stub.restore();
  }
});

test("fallback ladder reaches Wayback after mirror 404", async () => {
  const stub = ladderStub({ mirrorStatus: 404, mirrorBody: MISSING_HTML, archive: { originalUrl: PAGE_URL } });
  try {
    const result = await fetchPageWithFallbacks(PAGE_URL, "", OFFLINE);
    assert.equal(result.source, "wayback");
    assert.equal(stub.matching("namu.moe").length, 1);
    assert.equal(stub.matching("archive.org/wayback/available").length, 1);
  } finally {
    stub.restore();
  }
});

test("fallback ladder rejects a mirror challenge and reaches Wayback", async () => {
  const stub = ladderStub({ mirrorBody: CHALLENGE_HTML, archive: { originalUrl: PAGE_URL } });
  try {
    const result = await fetchPageWithFallbacks(PAGE_URL, "", OFFLINE);
    assert.equal(result.source, "wayback");
    assert.ok(result.warnings.some((warning) => /미러가 차단 페이지/.test(warning)));
  } finally {
    stub.restore();
  }
});

test("historical revision URLs skip the live mirror", async () => {
  const revisionUrl = `${PAGE_URL}?rev=77`;
  const stub = installFetch([
    { url: WAYBACK_AVAILABILITY, body: JSON.stringify({ archived_snapshots: { closest: closest(revisionUrl) } }), headers: { "content-type": "application/json" } },
    { url: (url) => url.includes("id_/"), body: fixture("namu-article.html") },
    { url: (url) => url.startsWith("https://namu.wiki/"), status: 403, body: CHALLENGE_HTML },
  ]);
  try {
    const result = await fetchPageWithFallbacks(revisionUrl, "", OFFLINE);
    assert.equal(result.source, "wayback");
    assert.equal(stub.matching("namu.moe").length, 0);
  } finally {
    stub.restore();
  }
});

test("mirror title mismatch without from is rejected", async () => {
  const mismatch = ARTICLE_HTML.replaceAll("거울 시험", "다른 문서");
  const stub = ladderStub({ mirrorBody: mismatch, archive: { originalUrl: PAGE_URL } });
  try {
    const result = await fetchPageWithFallbacks(PAGE_URL, "", OFFLINE);
    assert.equal(result.source, "wayback");
    assert.ok(result.warnings.some((warning) => /제목이 달라/.test(warning)));
  } finally {
    stub.restore();
  }
});

test("mirror redirect accepts a double-encoded target title carried with from", async () => {
  const targetTitle = "넘겨주기 대상";
  const targetPath = encodeURIComponent(targetTitle);
  const doubleEncodedPath = targetPath.replaceAll("%", "%25");
  const targetBody = ARTICLE_HTML.replaceAll("거울 시험", targetTitle);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://namu.wiki/")) {
      return new Response(CHALLENGE_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url === MIRROR_URL) {
      return new Response("", {
        status: 302,
        headers: { location: `/w/${doubleEncodedPath}?from=${encodeURIComponent("거울 시험")}` },
      });
    }
    if (url.includes(`/w/${doubleEncodedPath}?from=`)) {
      const response = new Response(targetBody, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    throw new Error(`unstubbed fetch: ${init.method || "GET"} ${url}`);
  };
  try {
    const result = await fetchPageWithFallbacks(PAGE_URL, "", OFFLINE);
    assert.equal(result.source, "namu-mirror");
    assert.equal(result.structured.title, targetTitle);
    assert.ok(result.warnings.includes(`나무위키 넘겨주기: 거울 시험 → ${targetTitle}`));
    assert.equal(calls.some((url) => url.includes("archive.org")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Real mirror pages (e.g. the C++ article) render whole template bodies as
// directive code blocks. Their parameters are already lost, so the logic, the
// CSS and the presentation markup are noise; the prose around them must stay.
test("namu mirror extractor drops unexpanded template bodies, CSS and table attributes", () => {
  const templateHeavy = ARTICLE_HTML.replace(
    "<p>거울 본문의 독특한 시작 문장이다.</p>",
    [
      "<p>거울 본문의 독특한 시작 문장이다.</p>",
      "<pre><code>#!wiki class=&quot;keyword&quot;\n{{{#!if template_p0 != null\n남으면 안 되는 틀 매개변수}}}</code></pre>",
      "<pre><code>#!folding [ 펼치기 · 접기 ]\n##=== 틀 주석\n남으면 안 되는 접기 틀</code></pre>",
      "<pre><code>#!style\n.keyword { display: inline; }</code></pre>",
      "<pre><code>#!syntax cpp\nstd::vector&lt;int&gt; kept;</code></pre>",
      "<p>&lt;tablewidth=100%&gt;&lt;colbgcolor=#00a495,#2d2f34&gt;&lt;nopad&gt;&lt;-2&gt; 표 머리 {{{#fff,#000 색 글자}}} {{{+1 큰 글자}}}</p>",
    ].join("\n"),
  );
  const out = extractNamuMirrorData(templateHeavy, PAGE_URL, "balanced", { include_links: false });
  assert.match(out.text, /거울 본문의 독특한 시작 문장/);
  assert.doesNotMatch(out.text, /틀 매개변수|접기 틀|template_p0|display: inline|#!style|틀 주석/);
  assert.match(out.text, /std::vector<int> kept;/);
  assert.doesNotMatch(out.text, /#!syntax/);
  // The exact line proves the colour/size wrappers and their closing braces are
  // gone; the genuine code sample elsewhere legitimately keeps its own "}}}".
  assert.match(out.text, /^ ?표 머리 색 글자 큰 글자$/m);
  assert.doesNotMatch(out.text, /tablewidth|colbgcolor|nopad|<-2>|\{\{\{/);
});

test("a long mirror article is not truncated to one fetch page", async () => {
  const longParagraph = `<p>${"긴 문서 본문 문장. ".repeat(4_000)}</p><p>문서 끝의 독특한 문장.</p>`;
  const longBody = ARTICLE_HTML.replace("<p>거울 본문의 독특한 시작 문장이다.</p>", longParagraph);
  const stub = ladderStub({ mirrorBody: longBody });
  try {
    const result = await fetchPageWithFallbacks(PAGE_URL, "", OFFLINE);
    assert.equal(result.source, "namu-mirror");
    assert.ok(result.text.length > 40_000, `expected the whole article, got ${result.text.length} chars`);
    assert.match(result.text, /문서 끝의 독특한 문장/);
  } finally {
    stub.restore();
  }
});
