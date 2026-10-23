import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanText,
  htmlToText,
  extractBalancedJson,
  extractYouTubeVideoData,
  extractSitePage,
  chromeSecChUa,
  CHROME_MAJOR,
} from "../src/index.js";
import { fixture } from "./helpers/harness.mjs";

test("HTML cleaning handles quoted greater-than signs, comments, CRLF, Markdown URLs, and <3", () => {
  const html = '<div class="[&>:first-child]:h-full" data-x="a>b">Hello\r\n\r\n\r\nworld <!-- hidden --></div> [label](<https://x>) a <3 b';
  const text = htmlToText(html, "balanced", { include_links: true });
  assert.doesNotMatch(text, /first-child|data-x|hidden/);
  assert.doesNotMatch(text, /\r/);
  assert.doesNotMatch(text, /\n{3,}/);
  assert.match(text, /\[label\]\(<https:\/\/x>\)/);
  assert.match(text, /a <3 b/);
  assert.equal(cleanText("one\r\n\r\n\r\ntwo"), "one\n\ntwo");
});

test("balanced JSON scanner survives braces, escaped quotes, and }; in strings", () => {
  const source = 'prefix {"description":"{x} \\"quoted\\" }; text","nested":{"ok":true}}; suffix';
  const parsed = extractBalancedJson(source, source.indexOf("{"));
  assert.equal(parsed.description, '{x} "quoted" }; text');
  assert.equal(parsed.nested.ok, true);
  assert.equal(extractBalancedJson("{}", 1), null);
});

test("YouTube player response yields video body and structured fields", () => {
  const page = extractYouTubeVideoData("https://www.youtube.com/watch?v=abc123", fixture("youtube-player.html"), "balanced", { include_links: false });
  assert.match(page.text, /^# Fixture Video/);
  assert.match(page.text, /Channel: Fixture Channel/);
  assert.match(page.text, /Published: 2026-10-20/);
  assert.match(page.text, /Length: 3:32/);
  assert.match(page.text, /Views: 12345/);
  assert.match(page.text, /Keywords: one, two, three/);
  // Description URLs are prose and must survive include_links=false. Compared
  // whole: CodeQL reads a substring check for a URL as URL sanitization.
  assert.equal(page.meta.description, 'Description with { braces }, an escaped quote: "yes", and literal }; plus https://example.com/video');
  assert.equal(page.structured.video_id, "abc123");
  assert.equal(page.structured.length_seconds, 212);
  assert.equal(page.structured.view_count, 12345);
  assert.equal(page.meta.canonical, "https://www.youtube.com/watch?v=abc123");

  const registered = extractSitePage("https://youtu.be/abc123", fixture("youtube-player.html"), "youtube", "balanced", {});
  assert.equal(registered.source, "direct");
  assert.equal(extractYouTubeVideoData("https://www.youtube.com/channel/UCfixture", fixture("youtube-player.html")), null);
});

test("YouTube duration includes hours", () => {
  const html = fixture("youtube-player.html").replace('"lengthSeconds":"212"', '"lengthSeconds":"3725"');
  const page = extractYouTubeVideoData("https://youtube.com/shorts/abc123", html);
  assert.match(page.text, /Length: 1:02:05/);
});

test("Chromium client hints follow GREASE ordering", () => {
  assert.equal(CHROME_MAJOR, 157);
  assert.equal(chromeSecChUa(120), '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"');
  assert.equal(chromeSecChUa(124), '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"');
  assert.equal(chromeSecChUa(157), '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"');
});

test("cleaning: anchor attributes containing '>' stay out of the link label", () => {
  // Brunch: data-tiara-action-name="본문 하단 > 키워드 클릭" on keyword links.
  const html = `<p>keyword <a href="/keyword/x" data-tiara-action-name="본문 하단 > 키워드 클릭" data-tiara-layer="bottom">브런치</a></p>`;
  const out = htmlToText(html, "balanced", { include_links: true, base_url: "https://brunch.co.kr/" });
  assert.ok(out.includes("[브런치](<https://brunch.co.kr/keyword/x>)"), out);
  assert.doesNotMatch(out, /data-tiara|키워드 클릭/);
});

test("cleaning: anchor conversion stays linear on unclosed anchors", () => {
  const started = performance.now();
  htmlToText("<a href=x>".repeat(100000), "balanced", { include_links: true });
  htmlToText("<a \"".repeat(100000), "balanced", { include_links: true });
  assert.ok(performance.now() - started < 1000, "anchor scanning must not go quadratic");
});
