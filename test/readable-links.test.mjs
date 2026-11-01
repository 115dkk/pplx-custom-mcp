import test from "node:test";
import assert from "node:assert/strict";

import { readableUrl, htmlToText, extractLinksFromMarkdown, extractNamuMirrorData, cleanMarkdownText } from "../src/index.js";
import { fixture } from "./helpers/harness.mjs";

// Links are shown with percent-encoded UTF-8 decoded, so a Korean title reads
// as itself and costs a fraction of its %XX form. Only display changes: the
// URL parser re-encodes the same bytes, so the readable link opens the same page.

test("readable links: percent-encoded UTF-8 is shown as the characters themselves", () => {
  assert.equal(
    readableUrl("https://namu.wiki/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD"),
    "https://namu.wiki/w/대한민국",
  );
  assert.equal(readableUrl("https://namu.wiki/w/%eb%8c%80%ed%95%9c"), "https://namu.wiki/w/대한", "lowercase hex decodes too");
  assert.equal(
    readableUrl("https://ko.wikipedia.org/wiki/%EC%84%9C%EC%9A%B8?action=history#%EA%B0%9C%EC%9A%94"),
    "https://ko.wikipedia.org/wiki/서울?action=history#개요",
  );
});

test("readable links: ASCII escapes keep their meaning", () => {
  // %20 space, %2F slash inside a title, %3F ?, %23 #, %25 %, %2B + must not
  // turn into path separators, a query, a fragment or a new escape.
  const url = "https://namu.wiki/w/%EB%82%98%EB%AC%B4%20%EC%9C%84%ED%82%A4%2F%EB%AF%B8%EB%9F%AC%3Fa%23b%25c%2B";
  assert.equal(readableUrl(url), "https://namu.wiki/w/나무%20위키%2F미러%3Fa%23b%25c%2B");
});

test("readable links: escapes that are not UTF-8 or would hide what the link is stay encoded", () => {
  // EUC-KR "한글" is not valid UTF-8.
  assert.equal(readableUrl("https://news.example.kr/search?q=%C7%D1%B1%DB"), "https://news.example.kr/search?q=%C7%D1%B1%DB");
  // Right-to-left override, zero-width space, no-break space, ideographic space.
  for (const escape of ["%E2%80%AE", "%E2%80%8B", "%C2%A0", "%E3%80%80"]) {
    const url = `https://example.com/w/%EA%B0%80${escape}%EB%82%98`;
    assert.equal(readableUrl(url), url, `${escape} must not be decoded`);
  }
  assert.equal(readableUrl(""), "");
  assert.equal(readableUrl("https://example.com/plain/path"), "https://example.com/plain/path");
});

test("readable links: rendered Markdown and structured links use the readable form and round-trip", () => {
  const html = '<p>본문 <a href="/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD">대한민국</a> 그리고 <a href="/w/나무위키 미러">미러</a></p>';
  const text = htmlToText(html, "balanced", { include_links: true, base_url: "https://namu.wiki/w/start" });
  assert.match(text, /\[대한민국\]\(<https:\/\/namu\.wiki\/w\/대한민국>\)/);
  assert.match(text, /\[미러\]\(<https:\/\/namu\.wiki\/w\/나무위키%20미러>\)/);
  assert.doesNotMatch(text, /%EB/);

  const links = extractLinksFromMarkdown(text, "https://namu.wiki/w/start");
  assert.deepEqual(links.map((link) => link.url), ["https://namu.wiki/w/대한민국", "https://namu.wiki/w/나무위키%20미러"]);
  // Fetching a readable link requests exactly the original bytes.
  assert.equal(new URL(links[0].url).href, "https://namu.wiki/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD");
  assert.equal(new URL(links[1].url).href, "https://namu.wiki/w/%EB%82%98%EB%AC%B4%EC%9C%84%ED%82%A4%20%EB%AF%B8%EB%9F%AC");
});

test("readable links: NamuWiki mirror pages link to readable namu.wiki titles", () => {
  const out = extractNamuMirrorData(fixture("namu-mirror-article.html"), "https://namu.wiki/w/%EA%B1%B0%EC%9A%B8%20%EC%8B%9C%ED%97%98", "balanced", { include_links: true });
  assert.match(out.text, /\[내부 문서\]\(<https:\/\/namu\.wiki\/w\/내부%20문서>\)/);
});

test("readable links: an anchor whose text is its own encoded URL shows the readable URL", () => {
  const html = '<p><a href="/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD"></a> <a href="/w/%EC%84%9C%EC%9A%B8">https://namu.wiki/w/%EC%84%9C%EC%9A%B8</a></p>';
  const text = htmlToText(html, "raw-ish", { include_links: true, base_url: "https://namu.wiki/w/start" });
  assert.match(text, /\[https:\/\/namu\.wiki\/w\/대한민국\]\(<https:\/\/namu\.wiki\/w\/대한민국>\)/);
  assert.match(text, /\[https:\/\/namu\.wiki\/w\/서울\]\(<https:\/\/namu\.wiki\/w\/서울>\)/);
  assert.doesNotMatch(text, /%E[A-D]/);
});

// NamuWiki titles often carry parentheses ("미러(웹사이트)"). The <...> form
// of a Markdown destination may contain them; it must not be cut at the first ')'.
test("readable links: a destination with parentheses is extracted whole, once", () => {
  const md = "참고 [APL](<https://namu.wiki/w/APL(프로그래밍%20언어)>) 와 [미러](<https://namu.wiki/w/미러(웹사이트)>) 끝 https://example.com/bare";
  assert.deepEqual(extractLinksFromMarkdown(md), [
    { text: "APL", url: "https://namu.wiki/w/APL(프로그래밍%20언어)" },
    { text: "미러", url: "https://namu.wiki/w/미러(웹사이트)" },
    { text: "https://example.com/bare", url: "https://example.com/bare" },
  ]);
});

test("readable links: stripping links leaves only the label, even with parentheses in the destination", () => {
  const md = "참고 [APL](<https://namu.wiki/w/APL(프로그래밍%20언어)>) 와 [plain](https://example.com/a) 끝";
  assert.equal(cleanMarkdownText(md, "balanced", { include_links: false }), "참고 APL 와 plain 끝");
});

test("readable links: structured links from relative Markdown destinations are readable too", () => {
  const links = extractLinksFromMarkdown("[대한민국](/w/대한민국)", "https://namu.wiki/w/start");
  assert.deepEqual(links, [{ text: "대한민국", url: "https://namu.wiki/w/대한민국" }]);
});
