import test from "node:test";
import assert from "node:assert/strict";

import {
  isHackerNewsUrl,
  extractHackerNewsItemData,
  extractHackerNewsFrontPageData,
  stackExchangeQuestionTarget,
  extractStackExchangeQuestionData,
  trySiteApiFirst,
  redditPostIdFromUrl,
  buildRedditArchiveListing,
  fetchRedditArchive,
  tryRedditArchive,
  extractRedditPostData,
} from "../src/index.js";
import { fixture, fixtureJson, installFetch } from "./helpers/harness.mjs";

const HN_ITEM_URL = "https://news.ycombinator.com/item?id=9007";
const SE_URL = "https://stackoverflow.com/questions/100/example";
const REDDIT_URL = "https://www.reddit.com/r/testing/comments/1fp5gut/archive_fixture/";

const jsonRoute = (url, body, status = 200) => ({ url, body, status, headers: { "content-type": "application/json" } });

test("Hacker News item formats metadata, comments, and story link", () => {
  assert.equal(isHackerNewsUrl(HN_ITEM_URL), true);
  assert.equal(isHackerNewsUrl("https://example.com/item?id=9007"), false);
  const page = extractHackerNewsItemData(HN_ITEM_URL, fixtureJson("hn-item.json"), { include_links: true });
  assert.match(page.text, /^# Comment by vlad/);
  assert.match(page.text, /Author: vlad/);
  assert.match(page.text, /Points: 12/);
  assert.match(page.text, /Story: https:\/\/news\.ycombinator\.com\/item\?id=8863/);
  assert.match(page.text, /^\[C1\] alice/m);
  assert.match(page.text, /^  \[C2\] bob/m);
  assert.match(page.text, /\n  second line/);
  assert.doesNotMatch(page.text, /deleted/);
  assert.equal(page.structured.num_comments, 3, "full descendant count includes a deleted node");
  assert.equal(page.structured.comments_shown, 2);
  assert.equal(page.structured.comments, undefined, "the comment tree is the body; structured data must not repeat it");
});

test("Hacker News front page preserves order and can omit all URLs", () => {
  const page = extractHackerNewsFrontPageData("https://news.ycombinator.com/news", fixtureJson("hn-front.json"), { include_links: false });
  assert.ok(page.text.indexOf("1. First story") < page.text.indexOf("2. Second story"));
  assert.doesNotMatch(page.text, /https?:\/\//);
  assert.deepEqual(page.structured.items.map((item) => item.id), ["101", "102"]);
});

test("Stack Exchange target routing and question extraction", () => {
  assert.deepEqual(stackExchangeQuestionTarget(SE_URL), { site: "stackoverflow.com", questionId: "100" });
  assert.deepEqual(stackExchangeQuestionTarget("https://unix.stackexchange.com/q/100"), { site: "unix.stackexchange.com", questionId: "100" });
  assert.deepEqual(stackExchangeQuestionTarget("https://stackoverflow.com/a/202"), { site: "stackoverflow.com", answerId: "202" });
  assert.equal(stackExchangeQuestionTarget("https://example.com/questions/100"), null);

  const question = fixtureJson("stackexchange-question.json");
  const answers = fixtureJson("stackexchange-answers.json");
  const page = extractStackExchangeQuestionData(SE_URL, question, answers, {});
  assert.match(page.text, /^# How to use <example>\?/);
  assert.match(page.text, /\[A1\] \(accepted\) score 20/);
  assert.ok(page.text.indexOf("score 20") < page.text.indexOf("score 5"));
  assert.equal(page.structured.quota_remaining, 299);
  assert.equal(extractStackExchangeQuestionData(SE_URL, { error_id: 502, error_name: "throttle_violation" }, answers, {}), null);
});

test("trySiteApiFirst is disabled by explicit preset and warns on failure", async () => {
  const noNetwork = installFetch([]);
  try {
    const result = await trySiteApiFirst(HN_ITEM_URL, { site_preset: "none" }, undefined, [], { attempts: [] });
    assert.equal(result, null);
    assert.equal(noNetwork.calls.length, 0);
  } finally {
    noNetwork.restore();
  }

  const failed = installFetch([jsonRoute("https://hn.algolia.com/api/v1/items/9007", "nope", 500)]);
  try {
    const warnings = [];
    const result = await trySiteApiFirst(HN_ITEM_URL, { site_preset: "auto" }, undefined, warnings, { attempts: [] });
    assert.equal(result, null);
    assert.ok(warnings.length > 0);
  } finally {
    failed.restore();
  }
});

test("trySiteApiFirst fetches HN and marks a linked Stack Exchange answer first", async () => {
  const question = fixture("stackexchange-question.json");
  const answerFixture = fixtureJson("stackexchange-answers.json");
  const answers = JSON.stringify({ ...answerFixture, items: answerFixture.items.filter((answer) => answer.answer_id !== 202) });
  const stub = installFetch([
    jsonRoute("https://hn.algolia.com/api/v1/items/9007", fixture("hn-item.json")),
    jsonRoute("https://api.stackexchange.com/2.3/answers/202?site=stackoverflow.com&filter=withbody", JSON.stringify({ items: [{ answer_id: 202, question_id: 100, owner: { display_name: "Linked User" }, score: 5, creation_date: 1700000200, body: "<p>Linked answer outside the top ten.</p>" }] })),
    jsonRoute("https://api.stackexchange.com/2.3/questions/100?", question),
    jsonRoute("https://api.stackexchange.com/2.3/questions/100/answers?", answers),
  ]);
  try {
    const debugInfo = { attempts: [] };
    const hn = await trySiteApiFirst(HN_ITEM_URL, { site_preset: "auto" }, undefined, [], debugInfo);
    assert.equal(hn.source, "hn-algolia");
    assert.equal(debugInfo.attempts[0].urlKind, "hn-algolia");

    const se = await trySiteApiFirst("https://stackoverflow.com/a/202", { site_preset: "auto" }, undefined, [], { attempts: [] });
    assert.equal(se.source, "stackexchange-api");
    assert.match(se.text, /\[A1\] \(linked\) score 5/);
    assert.match(se.text, /Linked answer outside the top ten\./);
  } finally {
    stub.restore();
  }
});

test("Reddit archive helpers build a listing consumed by the existing extractor", () => {
  const post = fixtureJson("reddit-archive-post.json").data[0];
  const comments = fixtureJson("reddit-archive-comments.json").data;
  assert.equal(redditPostIdFromUrl(REDDIT_URL), "1fp5gut");
  assert.equal(redditPostIdFromUrl("https://www.reddit.com/r/comments/comments/abc123/title/"), "abc123");
  assert.equal(redditPostIdFromUrl("https://www.reddit.com/prefix/comments/wrong/path"), "");
  assert.equal(redditPostIdFromUrl("https://www.reddit.com/r/testing/"), "");
  const page = extractRedditPostData(REDDIT_URL, JSON.stringify(buildRedditArchiveListing(post, comments)), {});
  assert.match(page.text, /^# Archive fixture post/);
  assert.match(page.text, /Archived comment/);
  assert.match(page.text, /Nested archive reply/);
});

test("fetchRedditArchive tolerates comment failure, but requires a post", async () => {
  const postsUrl = "https://arctic-shift.photon-reddit.com/api/posts/ids?ids=1fp5gut";
  const commentsUrl = "https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=1fp5gut&limit=200";
  let stub = installFetch([
    jsonRoute(postsUrl, fixture("reddit-archive-post.json")),
    jsonRoute(commentsUrl, "failed", 500),
  ]);
  try {
    const page = await fetchRedditArchive(REDDIT_URL, {});
    assert.match(page.text, /Archive fixture post/);
    assert.doesNotMatch(page.text, /Top comments:/);
    assert.equal(page.archivedAt, "2024-09-27T03:35:12.000Z");
  } finally {
    stub.restore();
  }

  stub = installFetch([
    jsonRoute(postsUrl, JSON.stringify({ data: [] })),
    jsonRoute(commentsUrl, fixture("reddit-archive-comments.json")),
  ]);
  try {
    assert.equal(await fetchRedditArchive(REDDIT_URL, {}), null);
  } finally {
    stub.restore();
  }

  const wrongPost = fixtureJson("reddit-archive-post.json");
  wrongPost.data[0].id = "different";
  stub = installFetch([
    jsonRoute(postsUrl, JSON.stringify(wrongPost)),
    jsonRoute(commentsUrl, fixture("reddit-archive-comments.json")),
  ]);
  try {
    assert.equal(await fetchRedditArchive(REDDIT_URL, {}), null);
  } finally {
    stub.restore();
  }
});

test("tryRedditArchive observes deadline and returns archive metadata", async () => {
  let stub = installFetch([]);
  try {
    const result = await tryRedditArchive(REDDIT_URL, { site_preset: "reddit" }, [], 2, { remaining: () => 2999 });
    assert.equal(result, null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }

  stub = installFetch([
    jsonRoute("https://arctic-shift.photon-reddit.com/api/posts/ids?ids=1fp5gut", fixture("reddit-archive-post.json")),
    jsonRoute("https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=1fp5gut&limit=200", fixture("reddit-archive-comments.json")),
  ]);
  try {
    const warnings = [];
    const result = await tryRedditArchive(REDDIT_URL, { site_preset: "reddit" }, warnings, 2);
    assert.equal(result.source, "reddit-archive");
    assert.equal(result.attempt, 3);
    assert.equal(result.structured.archived_source, "arctic-shift");
    assert.match(warnings[0], /Arctic Shift/);
  } finally {
    stub.restore();
  }
});

test("Stack Exchange feed is reshaped into the API's question and answers", async () => {
  const { stackExchangeFeedToApiShape } = await import("../src/index.js");
  const shaped = stackExchangeFeedToApiShape(fixture("stackexchange-feed.xml"));
  const question = shaped.question.items[0];
  assert.equal(question.question_id, 11227809);
  assert.equal(question.score, 27546);
  assert.ok(question.tags.includes("c++"), "tag entities are decoded");
  assert.match(question.body, /^<p>In this C\+\+ code/);
  assert.ok(question.body.includes("#include &lt;algorithm&gt;"), "code samples keep exactly one level of escaping");
  assert.deepEqual(shaped.answers.items.map((answer) => answer.score), [35296, 39], "answers are ordered by score");
  assert.equal(shaped.truncated, false);
  assert.equal(stackExchangeFeedToApiShape("<feed></feed>"), null);
});

test("trySiteApiFirst falls back to the question feed when the API is throttled", async () => {
  const throttled = JSON.stringify({ error_id: 502, error_name: "throttle_violation", error_message: "too many requests from this IP" });
  const stub = installFetch([
    jsonRoute("https://api.stackexchange.com/2.3/questions/11227809", throttled, 400),
    { url: "https://stackoverflow.com/feeds/question/11227809", body: fixture("stackexchange-feed.xml"), headers: { "content-type": "application/atom+xml" } },
  ]);
  const warnings = [];
  try {
    const page = await trySiteApiFirst(
      "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster",
      { site_preset: "auto", include_links: true },
      undefined,
      warnings,
      { attempts: [] }
    );
    assert.equal(page.source, "stackexchange-feed");
    assert.match(page.text, /^# Why is conditional processing of a sorted array faster/);
    assert.match(page.text, /\[A1\] score 35296/);
    assert.match(page.text, /Branch prediction/);
    assert.ok(page.text.includes("#include <algorithm>"), "code samples survive as text, not as stripped tags");
    assert.doesNotMatch(page.text, /Views:/, "the feed has no view count, so none is invented");
    assert.ok(warnings.some((warning) => warning.includes("throttle_violation")));
  } finally {
    stub.restore();
  }
});

test("Reddit archive retries with a second identity and reports a refused request", async () => {
  const postsUrl = "https://arctic-shift.photon-reddit.com/api/posts/ids?ids=1fp5gut";
  const commentsUrl = "https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=1fp5gut&limit=200";
  let firstIdentityRefused = 0;
  let stub = installFetch([
    {
      url: postsUrl,
      status: 200,
      headers: { "content-type": "application/json" },
      body: (url, init) => {
        if (String(init.headers?.["User-Agent"] || "").startsWith("perplexity-mcp/")) {
          firstIdentityRefused++;
          return "__refuse__";
        }
        return fixture("reddit-archive-post.json");
      },
    },
    jsonRoute(commentsUrl, fixture("reddit-archive-comments.json")),
  ]);
  // installFetch cannot vary the status per call, so wrap it.
  const routed = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await routed(input, init);
    const text = await res.clone().text();
    return text === "__refuse__" ? new Response("blocked", { status: 403 }) : res;
  };
  try {
    const page = await fetchRedditArchive(REDDIT_URL, {});
    assert.match(page.text, /Archive fixture post/);
    assert.equal(firstIdentityRefused, 1);
  } finally {
    globalThis.fetch = routed;
    stub.restore();
  }

  stub = installFetch([
    jsonRoute(postsUrl, "blocked", 403),
    jsonRoute(commentsUrl, "blocked", 403),
  ]);
  const warnings = [];
  try {
    const result = await tryRedditArchive(REDDIT_URL, { site_preset: "reddit" }, warnings, 3);
    assert.equal(result, null);
    assert.ok(warnings.some((warning) => warning.includes("HTTP 403")), warnings.join(" | "));
  } finally {
    stub.restore();
  }
});
