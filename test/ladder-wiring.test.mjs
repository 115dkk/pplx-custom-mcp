// The site API paths only help if the fetch ladder actually reaches them, and
// reaches them before it spends time and money on routes known to be blocked.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchPageWithFallbacks, fetchAndFormat, extractHackerNewsItemData, TOOL_DEADLINE_MS } from "../src/index.js";
import { fixture, installFetch, OFFLINE } from "./helpers/harness.mjs";

const json = (url, body, status = 200) => ({ url, body, status, headers: { "content-type": "application/json" } });

test("wiring: a Hacker News item is served by the Algolia API without touching HN", async () => {
  const stub = installFetch([json("https://hn.algolia.com/api/v1/items/9007", fixture("hn-item.json"))]);
  try {
    const result = await fetchPageWithFallbacks("https://news.ycombinator.com/item?id=9007", "pplx-test", { ...OFFLINE, debug: true });
    assert.equal(result.ok, true);
    assert.equal(result.source, "hn-algolia");
    assert.equal(stub.matching("news.ycombinator.com").length, 0, "the blocked HTML route must not be tried first");
    assert.equal(stub.matching("api.perplexity.ai").length, 0);
  } finally {
    stub.restore();
  }
});

test("wiring: site_preset=none keeps the API paths out of the way", async () => {
  const stub = installFetch([
    { url: "https://news.ycombinator.com/item?id=9007", body: "<html><body><article><p>HN page body that is long enough to count as content.</p></article></body></html>" },
  ]);
  try {
    const result = await fetchPageWithFallbacks("https://news.ycombinator.com/item?id=9007", "", { ...OFFLINE, site_preset: "none" });
    assert.equal(result.source, "direct");
    assert.equal(stub.matching("hn.algolia.com").length, 0);
  } finally {
    stub.restore();
  }
});

test("wiring: a blocked Reddit post comes from the archive before any paid call", async () => {
  const blocked = "<html><body>You've been blocked by network security.</body></html>";
  const stub = installFetch([
    json("https://arctic-shift.photon-reddit.com/api/posts/ids", fixture("reddit-archive-post.json")),
    json("https://arctic-shift.photon-reddit.com/api/comments/tree", fixture("reddit-archive-comments.json")),
    { url: "https://www.reddit.com/", status: 403, body: blocked },
  ]);
  try {
    const result = await fetchPageWithFallbacks(
      "https://www.reddit.com/r/testing/comments/1fp5gut/archive_fixture/",
      "pplx-test",
      { ...OFFLINE, debug: true }
    );
    assert.equal(result.ok, true);
    assert.equal(result.source, "reddit-archive");
    assert.match(result.text, /Archive fixture post/);
    assert.equal(stub.matching("api.perplexity.ai").length, 0, "the archive must be tried before paid Perplexity calls");
    assert.ok(result.debugInfo.stages.some((stage) => stage.stage === "reddit-archive" && stage.ok));
  } finally {
    stub.restore();
  }
});

test("wiring: Hacker News paragraphs survive the bare <p> separators", () => {
  const page = extractHackerNewsItemData("https://news.ycombinator.com/item?id=1", {
    id: 1,
    type: "story",
    title: "Ask HN: paragraphs",
    author: "a",
    text: "First paragraph.<p>Second paragraph.",
    children: [],
  });
  assert.match(page.text, /First paragraph\.\n\nSecond paragraph\./);
});

test("wiring: the watchdog answers even when a request ignores its abort signal", async () => {
  const original = globalThis.fetch;
  // A fetch that never settles and never listens to its signal.
  globalThis.fetch = () => new Promise(() => {});
  try {
    const started = Date.now();
    const { result, text } = await fetchAndFormat("https://example.com/hangs", "", {
      use_cache: false,
      include_images: false,
      debug: true,
      // Short internal budgets so the abandoned fetch leaves no long timers.
      deadline_ms: 300,
      attempt_timeout_ms: 100,
      // Pretend the tool call began just under the deadline ago.
      tool_started_at: Date.now() - TOOL_DEADLINE_MS - 1_500,
    });
    assert.ok(Date.now() - started < 3_000, "the watchdog must answer within its margin");
    assert.equal(result.source, "timeout");
    assert.match(text, /응답이 끝나지 않아 중단/);
    assert.ok(result.debugInfo.stages.some((stage) => stage.stage === "watchdog"));
  } finally {
    globalThis.fetch = original;
  }
});
