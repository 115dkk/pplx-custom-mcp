// Site-agnostic fetch behaviour: body extraction, link preservation, cleaning
// modes, pagination, metadata triage, client-side redirects, and the fallbacks
// that keep a blocked or JS-only page from returning nothing at all.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FETCH_RESPONSE_MAX_BYTES,
  fetchAndFormat,
  fetchPageWithFallbacks,
  formatFetchResult,
  buildFetchStructured,
  extractMetadata,
  extractClientRedirect,
  extractLinksFromMarkdown,
  htmlToText,
  cleanText,
  paginateText,
  normalizeCleaningMode,
  isDocumentUrl,
  hasMeaningfulHtmlContent,
  fetchHeaders,
  fetchWithSafeRedirects,
  isSafeFetchUrl,
  readTextResponse,
  selectContentImageUrls,
} from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const URL_ARTICLE = "https://example.com/blog/no-headless";
const ARTICLE_HTML = fixture("generic-article.html");
const SPA_HTML = fixture("spa-shell.html");

const BODY_SENTENCE = /almost none of it reading the page/;

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

test("security: only public credential-free HTTP(S) targets are accepted", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://[::1]/admin",
    "http://[2001:0db8::1]/docs",
    "http://[fc00::1]/admin",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "https://user:secret@example.com/",
  ]) {
    assert.equal(isSafeFetchUrl(url), false, `${url} should be rejected`);
  }
  assert.equal(isSafeFetchUrl("https://example.com/article"), true);
  assert.equal(isSafeFetchUrl("http://1.1.1.1/"), true);
});

test("security: redirects cannot reach private targets or forward credentials cross-origin", async () => {
  const privateMock = installFetch([
    { url: "https://example.com/start", status: 302, headers: { location: "http://127.0.0.1/admin" } },
  ]);
  await assert.rejects(
    fetchWithSafeRedirects("https://example.com/start"),
    /Unsafe redirect target/
  );
  assert.equal(privateMock.calls.length, 1);
  privateMock.restore();

  const publicMock = installFetch([
    { url: "https://example.com/start", status: 302, headers: { location: "https://other.example/final" } },
    { url: "https://other.example/final", body: "ok" },
  ]);
  const response = await fetchWithSafeRedirects("https://example.com/start", {
    headers: {
      Authorization: "Bearer secret",
      Cookie: "session=secret",
      Origin: "https://example.com",
    },
  }, new Map([["session", "secret"]]), "https://example.com");
  assert.equal(await response.text(), "ok");
  const redirectedHeaders = new Headers(publicMock.calls[1].headers);
  assert.equal(redirectedHeaders.has("authorization"), false);
  assert.equal(redirectedHeaders.has("cookie"), false);
  assert.equal(redirectedHeaders.has("origin"), false);
  publicMock.restore();
});

test("security: private image references are never selected for network fetch", () => {
  const html = '<article><img src="http://169.254.169.254/latest/meta-data/"><img src="/public.png"></article>';
  assert.deepEqual(selectContentImageUrls(html, "https://example.com/post"), ["https://example.com/public.png"]);
});

test("images: lazy-load sources beat placeholders and srcset uses the largest candidate", () => {
  const html = `
    <article>
      <img src="/blank.gif" data-original="/photos/real.jpg">
      <img src="/tiny.jpg" srcset="/small.webp 320w, /large.webp 1280w">
    </article>`;
  assert.deepEqual(selectContentImageUrls(html, "https://example.com/post", { max_images: 4 }), [
    "https://example.com/photos/real.jpg",
    "https://example.com/large.webp",
  ]);
});

test("security: text responses are capped before extraction", async () => {
  const oversized = "x".repeat(FETCH_RESPONSE_MAX_BYTES + 1024);
  const text = await readTextResponse(
    new Response(oversized, { headers: { "content-type": "text/plain; charset=utf-8" } }),
    "text/plain; charset=utf-8"
  );
  assert.equal(new TextEncoder().encode(text).byteLength, FETCH_RESPONSE_MAX_BYTES);
});

test("headers: a browser UA is backed by the metadata that browser would send", () => {
  // Cloudflare-fronted sites answer 403 to a request claiming to be Chrome that
  // carries none of Chrome's fetch metadata or client hints. The mismatch is
  // the signal, not the User-Agent.
  const nav = fetchHeaders(CHROME_UA, new Map(), {}, "navigate");
  assert.equal(nav["Sec-Fetch-Dest"], "document");
  assert.equal(nav["Sec-Fetch-Mode"], "navigate");
  assert.equal(nav["Sec-Fetch-Site"], "none");
  assert.equal(nav["Upgrade-Insecure-Requests"], "1");
  assert.match(nav["sec-ch-ua"], /Chromium/);
  assert.equal(nav["sec-ch-ua-platform"], '"Windows"');
  assert.match(nav.Accept, /^text\/html,application\/xhtml\+xml/);
});

test("headers: fetch metadata matches the request kind", () => {
  const xhr = fetchHeaders(CHROME_UA, new Map(), {}, "xhr");
  assert.equal(xhr["Sec-Fetch-Dest"], "empty");
  assert.equal(xhr["Sec-Fetch-Mode"], "cors");
  assert.equal(xhr["Sec-Fetch-Site"], "same-origin");
  assert.equal(xhr["Sec-Fetch-User"], undefined, "an XHR is not a user-initiated navigation");
  assert.equal(xhr["Upgrade-Insecure-Requests"], undefined);

  const form = fetchHeaders(CHROME_UA, new Map(), {}, "form");
  assert.equal(form["Sec-Fetch-Site"], "same-origin", "a challenge form posts back to its own origin");
  assert.equal(form["Sec-Fetch-Mode"], "navigate");
});

test("headers: non-Chromium and crawler agents do not claim Chromium hints", () => {
  const safari = fetchHeaders(IPHONE_UA, new Map(), {}, "navigate");
  assert.equal(safari["Sec-Fetch-Dest"], "document", "Safari does send fetch metadata");
  assert.equal(safari["sec-ch-ua"], undefined, "client hints are Chromium-only");

  for (const ua of [GOOGLEBOT_UA, "dcinside.app"]) {
    const bot = fetchHeaders(ua, new Map(), {}, "navigate");
    assert.equal(bot["Sec-Fetch-Dest"], undefined, `${ua} must not send fetch metadata`);
    assert.equal(bot["sec-ch-ua"], undefined, `${ua} must not send client hints`);
    assert.equal(bot["User-Agent"], ua);
  }
});

test("headers: explicit per-call headers still win", () => {
  const h = fetchHeaders(CHROME_UA, new Map(), { Accept: "application/json", "Sec-Fetch-Site": "cross-site" }, "xhr");
  assert.equal(h.Accept, "application/json");
  assert.equal(h["Sec-Fetch-Site"], "cross-site");
});

test("core: metadata is lifted from head tags", () => {
  const meta = extractMetadata(ARTICLE_HTML);
  assert.equal(meta.title, "Why we stopped shipping a headless browser");
  assert.match(meta.description, /replacing Puppeteer/);
  assert.equal(meta.canonical, "https://example.com/blog/no-headless");
  assert.equal(meta.author, "J. Rivera");
  assert.equal(meta.published, "2026-06-18T10:00:00Z");
  assert.equal(meta.siteName, "Example Engineering");
});

test("core: cleaning modes are normalised and strict removes more chrome", () => {
  assert.equal(normalizeCleaningMode(undefined), "balanced");
  assert.equal(normalizeCleaningMode("nonsense"), "balanced");
  assert.equal(normalizeCleaningMode("strict"), "strict");

  const noisy = "Accept all cookies\nSubscribe to our newsletter\nThis paragraph is the actual article content and must always survive cleaning.";
  const strict = cleanText(noisy, "strict");
  assert.match(strict, /actual article content/);
  assert.ok(strict.length < noisy.length, "strict mode removed nothing");
});

test("security: script and style blocks with spaced closing tags stay out of extracted text", () => {
  const text = htmlToText(
    "<main><p>Keep this sentence.</p><script>steal()</script ><style>.secret{}</style ><p>Keep this too.</p></main>",
    "balanced"
  );
  assert.match(text, /Keep this sentence/);
  assert.match(text, /Keep this too/);
  assert.doesNotMatch(text, /steal|secret/);
});

test("core: body text is extracted and interface noise is dropped", () => {
  const text = htmlToText(ARTICLE_HTML, "balanced", { include_links: true, base_url: URL_ARTICLE });
  assert.match(text, BODY_SENTENCE);
  assert.match(text, /one documented XHR away/);
  assert.doesNotMatch(text, /We use cookies/, "cookie banner leaked into the body");
});

test("core: links are preserved as markdown and resolved against the base URL", () => {
  const text = htmlToText(ARTICLE_HTML, "balanced", { include_links: true, base_url: URL_ARTICLE });

  // Regression: tag stripping used to swallow the angle-bracketed href and
  // leave `[label]( )`, silently dropping every URL on every HTML page.
  assert.doesNotMatch(text, /\]\(\s*\)/, "link href was stripped out of the markdown");
  assert.match(text, /\[migration writeup\]\(<https:\/\/example\.com\/blog\/migration-notes>\)/);

  const links = extractLinksFromMarkdown(text, URL_ARTICLE);
  const urls = new Set(links.map((l) => l.url));
  assert.ok(urls.has("https://example.com/blog/migration-notes"), "absolute link lost");
  assert.ok(urls.has("https://example.com/repo"), "relative link was not resolved");
});

test("core: include_links=false drops URLs but keeps the sentence", () => {
  const text = htmlToText(ARTICLE_HTML, "balanced", { include_links: false, base_url: URL_ARTICLE });
  assert.deepEqual(extractLinksFromMarkdown(text, URL_ARTICLE), []);
  assert.match(text, /migration writeup/, "link label should remain in the prose");
});

test("core: pagination splits a long body and advertises the next page", () => {
  const body = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the long document body.`).join("\n\n");
  const first = paginateText(body, 400, 1);
  assert.equal(first.page, 1);
  assert.ok(first.totalPages > 1, "long body was not split");
  assert.equal(first.hasNext, true);
  assert.ok(first.text.length <= 400);

  const second = paginateText(body, 400, 2);
  assert.equal(second.page, 2);
  assert.notEqual(second.text, first.text, "page 2 repeated page 1");

  const beyond = paginateText(body, 400, 999);
  assert.equal(beyond.outOfRange, true);
});

test("core: end-to-end fetch returns body, header, and links block", async () => {
  const stub = installFetch([{ url: URL_ARTICLE, body: ARTICLE_HTML }]);
  try {
    const { result, text } = await fetchAndFormat(URL_ARTICLE, "", OFFLINE);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.match(text, BODY_SENTENCE, "article body missing from tool output");
    assert.match(text, /^URL: https:\/\/example\.com\/blog\/no-headless$/m);
    assert.match(text, /Title: Why we stopped shipping a headless browser/);
    assert.match(text, /Links found \(\d+/);
    assert.match(text, /Citation rule:/);

    const structured = buildFetchStructured(URL_ARTICLE, result, text, OFFLINE);
    assert.match(structured.result.text, BODY_SENTENCE, "structuredContent body is empty");
    assert.equal(structured.result.status, 200);
    assert.ok(structured.result.links.length >= 2);
  } finally {
    stub.restore();
  }
});

test("core: metadata_only returns metadata without the body", async () => {
  const stub = installFetch([{ url: URL_ARTICLE, body: ARTICLE_HTML }]);
  try {
    const result = await fetchPageWithFallbacks(URL_ARTICLE, "", OFFLINE);
    const text = formatFetchResult(URL_ARTICLE, result, { ...OFFLINE, metadata_only: true });
    assert.match(text, /Metadata:/);
    assert.match(text, /Why we stopped shipping a headless browser/);
    assert.doesNotMatch(text, BODY_SENTENCE, "metadata_only should not include the body");

    const structured = buildFetchStructured(URL_ARTICLE, result, text, { ...OFFLINE, metadata_only: true });
    assert.equal(structured.result.text, "");
  } finally {
    stub.restore();
  }
});

test("core: client-side meta refresh redirects are detected and followed", async () => {
  const HOP = "https://example.com/go?to=blog";
  const redirectHtml = `<html><head><meta http-equiv="refresh" content="0; url=https://example.com/blog/no-headless"></head><body>redirecting</body></html>`;

  assert.deepEqual(extractClientRedirect(HOP, redirectHtml), { url: URL_ARTICLE, kind: "meta-refresh" });

  const stub = installFetch([
    { url: URL_ARTICLE, body: ARTICLE_HTML },
    { url: HOP, body: redirectHtml },
  ]);
  try {
    const { result, text } = await fetchAndFormat(HOP, "", OFFLINE);
    assert.equal(result.ok, true);
    assert.match(text, BODY_SENTENCE, "redirect target body missing from tool output");
    assert.equal(result.finalUrl, URL_ARTICLE);
  } finally {
    stub.restore();
  }
});

test("core: a JS-only shell degrades to metadata instead of returning nothing", async () => {
  const SPA_URL = "https://spa.example.com/report";
  const stub = installFetch([{ url: SPA_URL, body: SPA_HTML }]);
  try {
    // No API key, so the Perplexity fallback is skipped and metadata is the floor.
    const { result, text } = await fetchAndFormat(SPA_URL, "", OFFLINE);
    assert.equal(result.ok, true);
    assert.match(text, /Quarterly platform report/);
    assert.match(text, /Latency dropped 42 percent/, "og:description fallback missing");
    assert.match(text, /메타데이터만 추출/, "the degraded-extraction warning should be visible");
  } finally {
    stub.restore();
  }
});

test("core: SPA shells are recognised, real articles are not", () => {
  assert.equal(hasMeaningfulHtmlContent(SPA_HTML, htmlToText(SPA_HTML)), false);
  assert.equal(hasMeaningfulHtmlContent(ARTICLE_HTML, htmlToText(ARTICLE_HTML)), true);
});

test("core: document URLs are flagged rather than returned as garbled text", async () => {
  const PDF_URL = "https://example.com/papers/report.pdf";
  assert.equal(isDocumentUrl(PDF_URL), true);
  assert.equal(isDocumentUrl(URL_ARTICLE), false);

  const stub = installFetch([
    { url: PDF_URL, body: "%PDF-1.7 binary", headers: { "content-type": "application/pdf" } },
  ]);
  try {
    const { result, text } = await fetchAndFormat(PDF_URL, "", OFFLINE);
    assert.equal(result.source, "document");
    assert.match(text, /Document URL detected/);
  } finally {
    stub.restore();
  }
});

test("core: an unreachable host fails loudly instead of returning a fake body", async () => {
  const DEAD = "https://dead.example.com/page";
  const stub = installFetch([
    { url: DEAD, body: () => { throw new Error("ECONNREFUSED"); } },
  ]);
  try {
    const { result } = await fetchAndFormat(DEAD, "", OFFLINE);
    assert.equal(result.ok, false);
    assert.ok((result.warnings || []).length > 0, "failure should be reported in warnings");
  } finally {
    stub.restore();
  }
});
