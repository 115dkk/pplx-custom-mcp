// Cheap structural guards that do not need a fixture: version sync, the export
// surface the tests rely on, the site-preset registry, and the deploy entry
// point staying separate from the library module.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as lib from "../src/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const libSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("contract: VERSION matches package.json", () => {
  assert.equal(lib.VERSION, pkg.version, "bump VERSION in src/index.js and package.json together");
});

test("contract: the test surface is fully exported", () => {
  for (const name of [
    "createServer", "fetchAndFormat", "fetchPageWithFallbacks", "runSearch",
    "extractDcinsideArticleData", "fetchDcinsideComments", "formatDcinsideComments",
    "extractRedditPostData", "extractNamuWikiData", "extractMediaWikiArticleData",
    "extractSageArticleData", "extractSourceForgeAlluraData", "extractNewsArticleData",
    "extractSteamStoreData", "htmlToText", "extractMetadata", "paginateText",
  ]) {
    assert.equal(typeof lib[name], "function", `${name} is no longer exported`);
  }
});

test("contract: every site preset resolves for a representative URL", () => {
  const cases = [
    ["https://store.steampowered.com/app/440/", "steam"],
    ["https://www.reddit.com/r/programming/comments/1abcdef/x/", "reddit"],
    ["https://gall.dcinside.com/board/view/?id=programming&no=1", "dcinside"],
    ["https://namu.wiki/w/서버리스", "namu"],
    ["https://k-wiki.kr/wiki/엣지_컴퓨팅", "mediawiki"],
    ["https://journals.sagepub.com/doi/10.1177/0000000000000000", "sage"],
    ["https://sourceforge.net/p/proj/wiki/Home/", "sourceforge"],
    ["https://www.yna.co.kr/view/AKR1", "news"],
    ["https://www.youtube.com/watch?v=abc", "youtube"],
    ["https://github.com/cloudflare/workers-sdk", "github"],
    ["https://example.com/plain", "auto"], // unknown host: generic extraction
  ];
  for (const [url, expected] of cases) {
    assert.equal(lib.resolveSitePreset(url, "auto"), expected, `${url} routed to the wrong preset`);
  }
  // An explicit preset always wins over detection.
  assert.equal(lib.resolveSitePreset("https://example.com/plain", "reddit"), "reddit");
});

test("contract: news registry keeps its documented domains", () => {
  for (const host of ["yna.co.kr", "newsis.com", "news1.kr", "donga.com", "theguardian.com", "timesofindia.indiatimes.com"]) {
    assert.ok(lib.findNewsSourceByHost(host), `${host} fell out of the news registry`);
  }
});

test("contract: the deploy entry stays thin and the library stays Workers-free", () => {
  assert.match(workerSource, /export default \{/, "src/worker.js must export the fetch handler");
  assert.match(workerSource, /from "agents\/mcp"/, "src/worker.js should own the Workers-only import");
  assert.ok(workerSource.split("\n").length < 80, "src/worker.js should stay a thin entry point");

  assert.doesNotMatch(
    libSource,
    /from "agents\/mcp"/,
    "src/index.js must not import agents/mcp — it would pull cloudflare: and break plain-Node tests"
  );
});

test("contract: every registered site preset has an extractor, and vice versa", () => {
  // Guards refactor B's registry: a preset that resolveSitePreset can return
  // but SITE_EXTRACTORS does not know falls back to generic extraction, which
  // is the silent-degradation failure the registry exists to prevent.
  const withExtractors = ["reddit", "namu", "mediawiki", "sage", "news", "dcinside"];
  for (const preset of withExtractors) {
    assert.equal(typeof lib.SITE_EXTRACTORS[preset]?.extract, "function", `${preset} has no registered extractor`);
    assert.ok(lib.SITE_EXTRACTORS[preset].source, `${preset} has no source label`);
  }
  // steam/youtube/github route by preset but carry no text extractor by design.
  assert.deepEqual(Object.keys(lib.SITE_EXTRACTORS).sort(), [...withExtractors].sort());
});
