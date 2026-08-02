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
const KWIKI_URL = "https://k-wiki.kr/wiki/엣지_컴퓨팅";
const NAMU_HTML = fixture("namu-article.html");
const KWIKI_HTML = fixture("mediawiki-article.html");

test("wiki: hosts route to their presets", () => {
  assert.equal(isNamuWikiUrl(NAMU_URL), true);
  assert.equal(isMediaWikiUrl(KWIKI_URL), true);
  assert.equal(isMediaWikiUrl("https://example.org/wiki/X"), false);
  assert.equal(resolveSitePreset(NAMU_URL, "auto"), "namu");
  assert.equal(resolveSitePreset(KWIKI_URL, "auto"), "mediawiki");
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
