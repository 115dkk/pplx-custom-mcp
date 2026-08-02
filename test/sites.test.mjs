// Steam and SourceForge both need a non-obvious recovery step: an age gate that
// must be auto-submitted, and an HTML page that is bot-blocked so the Allura
// REST endpoint has to stand in for it.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractSteamStoreData,
  looksSteamAgeGate,
  buildSteamAgeSubmission,
  extractMetadata,
  htmlToText,
  buildSourceForgeRestUrl,
  isSourceForgeUrl,
  extractSourceForgeAlluraData,
  fetchSourceForgeAllura,
  resolveSitePreset,
  fetchAndFormat,
} from "../src/index.js";
import { fixture, fixtureJson, installFetch, OFFLINE } from "./helpers/harness.mjs";

const STEAM_URL = "https://store.steampowered.com/app/2200310/Deep_Signal/";
const STEAM_HTML = fixture("steam-app.html");
const STEAM_GATE_HTML = fixture("steam-agecheck.html");

const SF_URL = "https://sourceforge.net/p/exampleproj/wiki/Home/";
const SF_JSON = fixture("sourceforge-wiki.json");

test("steam: store pages route to the steam preset", () => {
  assert.equal(resolveSitePreset(STEAM_URL, "auto"), "steam");
});

test("steam: structured store data is extracted", () => {
  const meta = extractMetadata(STEAM_HTML);
  const data = extractSteamStoreData(STEAM_URL, STEAM_HTML, htmlToText(STEAM_HTML), meta);
  assert.ok(data, "extractor returned null");

  assert.equal(data.type, "steam_store");
  assert.equal(data.app_id, "2200310");
  assert.equal(data.name, "Deep Signal");
  assert.equal(data.release_date, "14 Mar, 2026");
  assert.equal(data.price, "$13.99");
  assert.equal(data.discount, "-30%");
  assert.equal(data.all_reviews, "Very Positive");
  assert.equal(data.recent_reviews, "Overwhelmingly Positive");
  assert.deepEqual(data.tags, ["Mystery", "Puzzle", "Sci-fi"]);
});

test("steam: the age gate is detected and answered with an adult birth date", () => {
  assert.equal(looksSteamAgeGate(STEAM_URL, STEAM_GATE_HTML), true);
  assert.equal(looksSteamAgeGate(STEAM_URL, STEAM_HTML), false);
  assert.equal(looksSteamAgeGate("https://example.com/x", STEAM_GATE_HTML), false, "only Steam URLs may be treated as age gates");

  const submission = buildSteamAgeSubmission(STEAM_URL, STEAM_GATE_HTML);
  assert.ok(submission, "no submission built — the age gate would never be passed");
  assert.equal(submission.method, "POST");
  assert.equal(submission.target.toString(), "https://store.steampowered.com/agecheckset/app/2200310/");
  assert.equal(submission.params.get("sessionid"), "abc123session", "hidden form fields must be carried over");
  assert.equal(submission.params.get("ageYear"), "1988");
  assert.equal(submission.params.get("ageMonth"), "January");
  assert.equal(submission.params.get("ageDay"), "1");
});

test("steam: end-to-end fetch walks through the age gate to the store page", async () => {
  const stub = installFetch([
    { url: "https://store.steampowered.com/agecheckset/", method: "POST", body: STEAM_HTML },
    { url: STEAM_URL, body: (url, init) => ((new Headers(init.headers).get("cookie") || "").includes("wants_mature_content") ? STEAM_HTML : STEAM_GATE_HTML) },
  ]);
  try {
    const { result, text } = await fetchAndFormat(STEAM_URL, "", OFFLINE);
    assert.equal(result.ok, true);
    assert.match(text, /last operator of a decommissioned listening post/, "store description missing from tool output");
    assert.doesNotMatch(text, /Please enter your birth date/, "age gate leaked into output");
    assert.equal(result.structured.app_id, "2200310");
    assert.equal(result.structured.name, "Deep Signal");
  } finally {
    stub.restore();
  }
});

test("sourceforge: wiki URLs map to the Allura REST endpoint", () => {
  assert.equal(isSourceForgeUrl(SF_URL), true);
  assert.equal(resolveSitePreset(SF_URL, "auto"), "sourceforge");
  assert.equal(buildSourceForgeRestUrl(SF_URL), "https://sourceforge.net/rest/p/exampleproj/wiki/Home/");
  assert.equal(buildSourceForgeRestUrl("https://sourceforge.net/projects/exampleproj/"), "", "non-wiki paths have no REST equivalent");
});

test("sourceforge: Allura JSON becomes a readable wiki body", () => {
  const page = extractSourceForgeAlluraData(SF_URL, JSON.parse(SF_JSON), "balanced", {});
  assert.ok(page, "extractor returned null — the wiki body would be missing");

  assert.match(page.text, /^# Home/);
  assert.match(page.text, /Source: SourceForge Allura REST API/);
  assert.match(page.text, /minimal cross-compiler toolchain wrapper/);
  assert.match(page.text, /Parallel builds above/, "last section dropped — body was truncated");
  assert.doesNotMatch(page.text, /\[TOC\]/, "TOC macro leaked into the body");

  assert.equal(page.structured.type, "sourceforge_wiki_page");
  assert.deepEqual(page.structured.labels, ["toolchain", "windows"]);
});

test("sourceforge: REST fetch returns a page when the endpoint answers JSON", async () => {
  const stub = installFetch([
    { url: "https://sourceforge.net/rest/p/exampleproj/wiki/Home/", body: SF_JSON, headers: { "content-type": "application/json" } },
  ]);
  try {
    const page = await fetchSourceForgeAllura(SF_URL, "balanced", undefined, {});
    assert.ok(page, "REST fetch returned null");
    assert.equal(page.status, 200);
    assert.match(page.text, /minimal cross-compiler toolchain wrapper/);
  } finally {
    stub.restore();
  }
});

test("sourceforge: end-to-end fetch bypasses the blocked HTML page", async () => {
  const stub = installFetch([
    { url: "https://sourceforge.net/rest/", body: SF_JSON, headers: { "content-type": "application/json" } },
    { url: SF_URL, status: 403, body: "Access denied" },
  ]);
  try {
    const { result, text } = await fetchAndFormat(SF_URL, "", OFFLINE);
    assert.equal(result.ok, true);
    assert.match(text, /minimal cross-compiler toolchain wrapper/, "wiki body missing from tool output");
    assert.ok(
      (result.warnings || []).some((w) => /Allura REST/.test(w)),
      "the REST fallback should be reported in warnings"
    );
  } finally {
    stub.restore();
  }
});

test("sourceforge: a page list is rendered when the wiki has no text body", () => {
  const page = extractSourceForgeAlluraData(SF_URL, { title: "Home", pages: ["Home", "Installation", "FAQ"] }, "balanced", {});
  assert.ok(page, "page-list rendering returned null");
  assert.match(page.text, /Installation/);
  assert.equal(page.structured.page_count, 3);
});

test("fixtures: sourceforge JSON stays valid", () => {
  assert.equal(fixtureJson("sourceforge-wiki.json").title, "Home");
});
