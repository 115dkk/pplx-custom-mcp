// News: the body has to survive both extraction paths (JSON-LD and raw HTML)
// while share widgets, ad slots, related-article rails, and copyright footers
// get dropped. An empty body here means the tool returns metadata only.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractNewsArticleData,
  cleanNewsText,
  dedupeNewsBodyAgainstTitle,
  stripNewsBoilerplateHtml,
  findNewsSourceByHost,
  isNewsUrl,
  resolveSitePreset,
  fetchAndFormat,
} from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const YNA_URL = "https://www.yna.co.kr/view/AKR20260730000100001";
const KHAN_URL = "https://www.khan.co.kr/article/202607291830001";
const YNA_HTML = fixture("news-jsonld.html");
const KHAN_HTML = fixture("news-htmlbody.html");

test("news: registered domains route to the news preset", () => {
  assert.equal(isNewsUrl(YNA_URL), true);
  assert.equal(isNewsUrl(KHAN_URL), true);
  assert.equal(isNewsUrl("https://example.com/article/1"), false);
  assert.equal(resolveSitePreset(YNA_URL, "auto"), "news");
  assert.equal(findNewsSourceByHost("yna.co.kr")?.site, "Yonhap News Agency");
  assert.equal(findNewsSourceByHost("theguardian.com")?.site, "The Guardian");
});

test("news: JSON-LD article body is extracted with its metadata", () => {
  const article = extractNewsArticleData(YNA_URL, YNA_HTML, "balanced", {});
  assert.ok(article, "extractor returned null — the article body would be missing");

  assert.match(article.text, /클라우드 보안인증\(CSAP\) 제도를 등급제로 개편/);
  assert.match(article.text, /논리적 망분리가 허용돼/);
  assert.match(article.text, /등급 산정 기준이 모호해/, "third paragraph dropped — body was truncated");

  assert.match(article.text, /^# 정부, 클라우드 보안인증 개편안 발표/);
  assert.match(article.text, /Author: 홍길동/);
  assert.match(article.text, /Published: 2026-07-30T09:00:00\+09:00/);

  assert.equal(article.structured.type, "news_article");
  assert.equal(article.structured.site, "연합뉴스");
  assert.equal(article.structured.section, "경제");
  assert.equal(article.meta.canonical, "https://www.yna.co.kr/view/AKR20260730000100001");
});

test("news: HTML-only article body is extracted and chrome is stripped", () => {
  const article = extractNewsArticleData(KHAN_URL, KHAN_HTML, "balanced", {});
  assert.ok(article, "extractor returned null — the article body would be missing");

  assert.match(article.text, /심야 연장운행을 다시 시작한다/);
  assert.match(article.text, /평일 기준 자정에서 새벽 1시까지/);
  assert.match(article.text, /코로나 이전 수준을 회복했다/);

  assert.doesNotMatch(article.text, /공유하기/, "share widget leaked into the body");
  assert.doesNotMatch(article.text, /관련기사/, "related-article rail leaked into the body");
  assert.doesNotMatch(article.text, /무단전재/, "copyright footer leaked into the body");
});

test("news: boilerplate removal is not capped part-way through a heavy page", () => {
  // The stripper used to restart its scan from index 0 after each removal and
  // bail out after ~80 passes, so an ad-heavy page kept the remainder in its
  // body. Scanning forward removes every match regardless of count.
  const html = [
    '<div class="article-body">',
    ...Array.from({ length: 150 }, (_, i) => `<div class="ad_wrap">AD${i}</div>`),
    "<p>실제 기사 본문 문장입니다.</p>",
    "</div>",
  ].join("");

  const stripped = stripNewsBoilerplateHtml(html);
  assert.equal((stripped.match(/AD\d+/g) || []).length, 0, "boilerplate survived past the old removal cap");
  assert.match(stripped, /실제 기사 본문 문장입니다/, "the body must survive the sweep");
});

test("news: boilerplate line filter drops chrome but keeps prose", () => {
  const cleaned = cleanNewsText(
    ["공유하기", "광고", "구독", "많이 본 뉴스", "저작권자 ⓒ 연합뉴스 무단전재 및 재배포 금지",
      "정부는 이번 개편이 공공 클라우드 시장의 경쟁을 촉진할 것으로 기대한다고 밝혔다."].join("\n")
  );
  assert.match(cleaned, /공공 클라우드 시장의 경쟁을 촉진/);
  for (const noise of ["공유하기", "광고", "구독", "많이 본 뉴스", "무단전재"]) {
    assert.doesNotMatch(cleaned, new RegExp(noise), `"${noise}" survived the filter`);
  }
});

test("news: a headline repeated as the first body line is removed once", () => {
  const title = "정부, 클라우드 보안인증 개편안 발표";
  const body = [title, "정부가 30일 클라우드 보안인증 제도를 등급제로 개편하는 방안을 발표했다."].join("\n");
  const deduped = dedupeNewsBodyAgainstTitle(body, title);
  assert.doesNotMatch(deduped.split("\n\n")[0], new RegExp(`^${title}$`));
  assert.match(deduped, /등급제로 개편하는 방안을 발표했다/);
});

test("news: end-to-end fetch returns a non-empty body", async () => {
  const stub = installFetch([{ url: YNA_URL, body: YNA_HTML }]);
  try {
    const { result, text } = await fetchAndFormat(YNA_URL, "", OFFLINE);
    assert.equal(result.ok, true);
    assert.equal(result.source, "news");
    assert.match(text, /논리적 망분리가 허용돼/, "article body missing from tool output");
    assert.match(text, /Title: 정부, 클라우드 보안인증 개편안 발표/);
    assert.ok(result.text.length > 200, `body suspiciously short: ${result.text.length} chars`);
  } finally {
    stub.restore();
  }
});
