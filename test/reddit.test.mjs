// Reddit serves a bot-check page to plain fetches. The recovery path is the
// public .json endpoint; if that regresses, the tool returns a verification
// screen instead of the post and its comments.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractRedditPostData,
  buildRedditJsonUrl,
  looksBlocked,
  resolveSitePreset,
  fetchAndFormat,
} from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const POST_URL = "https://www.reddit.com/r/programming/comments/1abcdef/i_replaced_a_headless_browser/";
const POST_JSON = fixture("reddit-post.json");
const BLOCKED_HTML = fixture("reddit-blocked.html");

test("reddit: post URLs map to the public JSON endpoint", () => {
  assert.equal(resolveSitePreset(POST_URL, "auto"), "reddit");
  assert.equal(
    buildRedditJsonUrl(POST_URL),
    "https://www.reddit.com/r/programming/comments/1abcdef/i_replaced_a_headless_browser.json?raw_json=1"
  );
  assert.equal(buildRedditJsonUrl("https://www.reddit.com/r/programming/"), "", "subreddit listings have no JSON post view");
  assert.equal(buildRedditJsonUrl("https://example.com/x"), "");
});

test("reddit: the verification interstitial is recognised as blocked", () => {
  assert.equal(looksBlocked(200, BLOCKED_HTML, POST_URL), true);
  assert.equal(looksBlocked(403, "", POST_URL), true);
  assert.equal(looksBlocked(200, "<html><p>ordinary page</p></html>", POST_URL), false);

  // A real Cloudflare interstitial keeps its markers in visible markup.
  assert.equal(
    looksBlocked(200, '<html><head><title>Just a moment...</title></head><body><div class="cf-turnstile" data-sitekey="abc"></div></body></html>', "https://example.com/"),
    true
  );
});

test("block detection: a captcha named in an inline config blob is not a block", () => {
  // Wikipedia ships "wgConfirmEditCaptchaNeededForGenericEdit":"hcaptcha" in a
  // <script> in its <head>. Matching that discarded every Wikipedia page as
  // bot-blocked and then paid for the Perplexity fallback to fetch it again.
  const page = [
    "<html><head><script>",
    'var RLCONF = {"wgConfirmEditCaptchaNeededForGenericEdit":"hcaptcha","wgConfirmEditHCaptchaSiteKey":"5d0c670e"};',
    "</script></head><body><article><p>",
    "This page has real prose in it and must not be mistaken for a challenge screen. ".repeat(4),
    "</p></article></body></html>",
  ].join("");
  assert.equal(looksBlocked(200, page, "https://en.wikipedia.org/wiki/Anycast"), false);
});

test("reddit: post JSON yields title, self text, and threaded comments", () => {
  const post = extractRedditPostData(POST_URL, POST_JSON, {});
  assert.ok(post, "extractor returned null — the post would be missing");

  assert.match(post.text, /^# I replaced a headless browser with 400 lines of fetch logic/);
  assert.match(post.text, /Subreddit: r\/programming/);
  assert.match(post.text, /Score: 1842/);
  assert.match(post.text, /Comments: 233/);
  assert.match(post.text, /cut our p95 from 9s to 380ms/, "self text missing");

  assert.match(post.text, /Top comments:/, "comment section missing");
  assert.match(post.text, /\[C1\] u\/netgazer \(311\): This works until the site rotates/);
  assert.match(post.text, /\[C2\] u\/quietcompiler \(128\): Fair\./, "nested reply missing");
  assert.doesNotMatch(post.text, /\[deleted\]/, "deleted comment leaked into output");

  assert.equal(post.structured.type, "reddit_post");
  assert.equal(post.structured.id, "1abcdef");
  assert.equal(post.structured.num_comments, 233);
  assert.equal(post.structured.comments.length, 2);
});

test("reddit: markdown links in the body are preserved by default and droppable", () => {
  const withLinks = extractRedditPostData(POST_URL, POST_JSON, { include_links: true });
  assert.match(withLinks.text, /\[writeup\]\(https:\/\/example\.com\/writeup\)/);

  const withoutLinks = extractRedditPostData(POST_URL, POST_JSON, { include_links: false });
  assert.doesNotMatch(withoutLinks.text, /https:\/\/example\.com\/writeup/);
  assert.match(withoutLinks.text, /writeup/, "link text should survive even when the URL is dropped");
});

test("reddit: end-to-end fetch falls back from the blocked page to JSON", async () => {
  const stub = installFetch([
    { url: /\.json\?raw_json=1$/, body: POST_JSON, headers: { "content-type": "application/json; charset=utf-8" } },
    { url: POST_URL, status: 200, body: BLOCKED_HTML },
  ]);
  try {
    const { result, text } = await fetchAndFormat(POST_URL, "", OFFLINE);

    assert.equal(result.ok, true);
    assert.equal(result.source, "reddit-json");
    assert.match(text, /cut our p95 from 9s to 380ms/, "post body missing from tool output");
    assert.match(text, /\[C1\] u\/netgazer/, "comments missing from tool output");
    assert.doesNotMatch(text, /Please wait for verification/, "verification page leaked into output");

    assert.ok(stub.matching("raw_json=1").length >= 1, "the JSON endpoint was never tried");
  } finally {
    stub.restore();
  }
});
