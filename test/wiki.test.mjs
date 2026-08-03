// Wiki pages are mostly navigation chrome by weight. The regression risk is a
// cleaner that gets greedy and eats the article along with the table of
// contents, edit links, and licence footer.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractNamuWikiData,
  cleanNamuWikiText,
  extractMediaWikiArticleData,
  cleanMediaWikiText,
  isNamuWikiUrl,
  isMediaWikiUrl,
  resolveSitePreset,
  fetchAndFormat,
} from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const NAMU_URL = "https://namu.wiki/w/서버리스";
const NAMU_RAW_REVISION_URL = "https://namu.wiki/raw/서버리스?rev=42";
const NAMU_READABLE_REVISION_URL = new URL("https://namu.wiki/w/서버리스?rev=42").toString();
const KWIKI_URL = "https://k-wiki.kr/wiki/엣지_컴퓨팅";
const WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/Anycast";
const NAMU_HTML = fixture("namu-article.html");
const KWIKI_HTML = fixture("mediawiki-article.html");
const WIKIPEDIA_HTML = fixture("wikipedia-article.html");

test("wiki: hosts route to their presets", () => {
  assert.equal(isNamuWikiUrl(NAMU_URL), true);
  assert.equal(isMediaWikiUrl(KWIKI_URL), true);
  assert.equal(isMediaWikiUrl("https://example.org/wiki/X"), false);
  assert.equal(resolveSitePreset(NAMU_URL, "auto"), "namu");
  assert.equal(resolveSitePreset(KWIKI_URL, "auto"), "mediawiki");
});

test("wiki: the MediaWiki registry covers the wikis it claims to", () => {
  for (const url of [
    "https://en.wikipedia.org/wiki/Anycast",
    "https://ko.wikipedia.org/wiki/애니캐스트",
    "https://commons.wikimedia.org/wiki/Main_Page",
    "https://en.wiktionary.org/wiki/anycast",
    "https://minecraft.fandom.com/wiki/Redstone",
    "https://terraria.wiki.gg/wiki/Boss",
    "https://librewiki.net/wiki/리브레_위키",
    "https://k-wiki.kr/wiki/엣지_컴퓨팅",
  ]) {
    assert.equal(resolveSitePreset(url, "auto"), "mediawiki", `${url} is not routed to the MediaWiki extractor`);
  }
  // Look-alikes must not be swept in.
  assert.equal(resolveSitePreset("https://namu.wiki/w/x", "auto"), "namu");
  assert.equal(resolveSitePreset("https://notwikipedia.org/wiki/x", "auto"), "auto");
  assert.equal(resolveSitePreset("https://example.com/wiki/x", "auto"), "auto");
});

test("namu: article body survives while notices and TOC are removed", () => {
  const article = extractNamuWikiData(NAMU_URL, NAMU_HTML, "balanced", {});
  assert.ok(article, "extractor returned null — the article body would be missing");

  assert.match(article.text, /코드 실행 단위로만 과금되는 실행 모델/);
  assert.match(article.text, /2014년 AWS 람다가 공개되면서/);
  assert.match(article.text, /실행 시간 제한과 벤더 종속이 단점/, "last section dropped — body was truncated");

  assert.doesNotMatch(article.text, /IP 우회 수단/, "VPN notice leaked into the body");
  assert.doesNotMatch(article.text, /\[편집\]/, "edit markers leaked into the body");
  assert.doesNotMatch(article.text, /최근 변경/, "navigation leaked into the body");
  assert.doesNotMatch(article.text, /이 저작물은/, "licence footer leaked into the body");

  assert.equal(article.structured.type, "namu_wiki_article");
  assert.equal(article.structured.title, "서버리스");
});

test("namu: cleaner drops TOC-shaped lines but keeps real headings", () => {
  const cleaned = cleanNamuWikiText(
    ["1 . 개요 2 . 역사 3 . 장단점 4 . 관련 문서 5 . 둘러보기", "1. 개요", "본문 문단입니다. 충분히 길게 작성된 문장이라 유지되어야 합니다."].join("\n")
  );
  assert.doesNotMatch(cleaned, /5 \. 둘러보기/, "TOC line survived");
  assert.match(cleaned, /^1\. 개요$/m, "real heading was removed");
  assert.match(cleaned, /본문 문단입니다/);
});

test("namu: raw revisions use the readable route and Perplexity-User UA directly", async () => {
  const stub = installFetch([{ url: NAMU_READABLE_REVISION_URL, body: NAMU_HTML }]);
  try {
    const { result, text } = await fetchAndFormat(NAMU_RAW_REVISION_URL, "", OFFLINE);
    assert.equal(result.status, 200);
    assert.equal(result.source, "direct");
    assert.equal(result.finalUrl, NAMU_READABLE_REVISION_URL);
    assert.equal(stub.calls.length, 1, "the first direct attempt should succeed");
    assert.equal(stub.calls[0].url, NAMU_READABLE_REVISION_URL);
    assert.match(stub.calls[0].headers.get("User-Agent"), /Perplexity-User\/1\.0/);
    assert.ok(result.warnings.some((warning) => /읽기 URL을 직접 확인/.test(warning)));
    assert.match(text, /코드 실행 단위로만 과금되는 실행 모델/);
  } finally {
    stub.restore();
  }
});

test("namu: Browser Run is the Workers-native fallback after direct 403s", async () => {
  const direct = installFetch([{ url: NAMU_READABLE_REVISION_URL, status: 403, body: "<title>Just a moment...</title>Access denied" }]);
  const calls = [];
  const browserBinding = {
    async quickAction(action, options) {
      calls.push({ action, options });
      return new Response(NAMU_HTML, { status: 200, headers: { "content-type": "text/html" } });
    },
  };
  try {
    const { result, text } = await fetchAndFormat(NAMU_RAW_REVISION_URL, "", { ...OFFLINE, browserBinding });
    assert.equal(result.source, "browser-run");
    assert.equal(result.status, 200);
    assert.equal(result.finalUrl, NAMU_READABLE_REVISION_URL);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "content");
    assert.equal(calls[0].options.url, NAMU_READABLE_REVISION_URL);
    assert.match(calls[0].options.userAgent, /Perplexity-User\/1\.0/);
    assert.match(text, /코드 실행 단위로만 과금되는 실행 모델/);
  } finally {
    direct.restore();
  }
});

test("mediawiki: mw-content-text body is extracted and chrome removed", () => {
  const article = extractMediaWikiArticleData(KWIKI_URL, KWIKI_HTML, "balanced", {});
  assert.ok(article, "extractor returned null — the article body would be missing");

  assert.match(article.text, /^# 엣지 컴퓨팅/);
  assert.match(article.text, /Site: K-Wiki/);
  assert.match(article.text, /지연 시간과 백홀 트래픽을 줄이는/);
  assert.match(article.text, /지역 거점의 노드가 캐싱과 전처리를 담당/);
  assert.match(article.text, /삼단 구조가 일반적이다/, "last section dropped — body was truncated");

  assert.doesNotMatch(article.text, /목차/, "table of contents leaked into the body");
  assert.doesNotMatch(article.text, /그림 1\./, "thumbnail caption leaked into the body");
  assert.doesNotMatch(article.text, /분류:네트워크/, "category links leaked into the body");

  assert.equal(article.structured.type, "mediawiki_article");
  assert.equal(article.structured.canonical, "https://k-wiki.kr/wiki/엣지_컴퓨팅");
});

test("mediawiki: line cleaner strips the TOC block and UI verbs", () => {
  const cleaned = cleanMediaWikiText(["목차", "1 개요", "1.1 배경", "읽기", "[편집]", "실제 본문 문장입니다."].join("\n"));
  assert.equal(cleaned, "실제 본문 문장입니다.");

  const english = cleanMediaWikiText(["Contents", "1 History", "2 Applications", "[edit]", "[edit | edit source]", "Jump to content", "A real body sentence."].join("\n"));
  assert.equal(english, "A real body sentence.");
});

test("mediawiki: chrome words that are also plausible headings are kept", () => {
  // "History", "Contents", "Tools" and "Search" are ordinary section titles.
  // Filtering them by text would silently delete article structure.
  const kept = cleanMediaWikiText(["History", "Tools", "Search", "Body sentence that must survive."].join("\n"));
  for (const heading of ["History", "Tools", "Search"]) {
    assert.match(kept, new RegExp(`^${heading}$`, "m"), `"${heading}" was treated as chrome`);
  }
});

test("wikipedia: article body, headings, and site name are extracted", () => {
  const article = extractMediaWikiArticleData(WIKIPEDIA_URL, WIKIPEDIA_HTML, "balanced", {});
  assert.ok(article, "extractor returned null — the article body would be missing");

  assert.match(article.text, /^# Anycast/);
  // Site name comes from the <title> suffix; Wikimedia emits no og:site_name.
  assert.match(article.text, /^Site: Wikipedia$/m, "site name was not derived from the page title");

  assert.match(article.text, /single destination IP address is shared/);
  assert.match(article.text, /topologically nearest member of the group/);
  assert.match(article.text, /^History$/m, "section heading was dropped");
  assert.match(article.text, /first formally described in 1993/);
  assert.match(article.text, /^Applications$/m, "section heading was dropped");
  assert.match(article.text, /absorb denial-of-service traffic/, "last section dropped — body was truncated");

  assert.doesNotMatch(article.text, /Jump to content/, "skin chrome leaked into the body");
  assert.doesNotMatch(article.text, /Figure 1\./, "thumbnail caption leaked into the body");
  assert.doesNotMatch(article.text, /Internet architecture/, "category links leaked into the body");
  assert.doesNotMatch(article.text, /Retrieved from/, "print footer leaked into the body");

  assert.equal(article.structured.type, "mediawiki_article");
  assert.equal(article.structured.canonical, WIKIPEDIA_URL);
});

test("wikipedia: nested mw-editsection markup leaves no stray 'edit' in the body", () => {
  // MediaWiki wraps the affordance as
  // <span class=mw-editsection><span>[</span><a><span>edit</span></a><span>]</span></span>.
  // A non-greedy span regex stops at the first inner </span> and orphans "edit"
  // next to every heading; only depth-aware removal handles it.
  const article = extractMediaWikiArticleData(WIKIPEDIA_URL, WIKIPEDIA_HTML, "balanced", { include_links: false });
  const strays = article.text.split("\n").filter((line) => /^edit$/i.test(line.trim()));
  assert.equal(strays.length, 0, `${strays.length} stray edit affordance(s) leaked into the body`);
  assert.doesNotMatch(article.text, /action=edit&amp;section=/, "edit link URL leaked into the body");
});

test("wiki: end-to-end fetches return non-empty bodies", async () => {
  for (const [url, html, needle] of [
    [NAMU_URL, NAMU_HTML, /코드 실행 단위로만 과금되는/],
    [KWIKI_URL, KWIKI_HTML, /지연 시간과 백홀 트래픽을 줄이는/],
  ]) {
    const stub = installFetch([{ url, body: html }]);
    try {
      const { result, text } = await fetchAndFormat(url, "", OFFLINE);
      assert.equal(result.ok, true, `${url} failed to fetch`);
      assert.match(text, needle, `article body missing from tool output for ${url}`);
    } finally {
      stub.restore();
    }
  }
});
