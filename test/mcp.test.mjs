// Protocol level: drive the real McpServer over an in-memory transport, the way
// a Claude connector would. Catches tool renames, schema drift, and handlers
// that return an empty body or lose structuredContent.

import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, VERSION } from "../src/index.js";
import { fixture, installFetch } from "./helpers/harness.mjs";

const ARTICLE_URL = "https://example.com/blog/no-headless";
const ARTICLE_HTML = fixture("generic-article.html");
const SEARCH_JSON = fixture("perplexity-search.json");
const DC_URL = "https://gall.dcinside.com/board/view/?id=programming&no=1234567";

const EXPECTED_TOOLS = ["perplexity_search", "perplexity_fetch", "perplexity_fetch_many", "perplexity_search_fetch"];

async function connect() {
  const server = createServer("pplx-test");
  const client = new Client({ name: "regression-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, async close() { await client.close(); await server.close(); } };
}

function textOf(result) {
  return (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

test("mcp: all four tools are advertised with input and output schemas", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());

    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 40, `${tool.name} has no usable description`);
      assert.ok(tool.inputSchema, `${tool.name} has no inputSchema`);
      assert.ok(tool.outputSchema, `${tool.name} has no outputSchema`);
    }

    const fetchTool = tools.find((t) => t.name === "perplexity_fetch");
    assert.ok(fetchTool.inputSchema.required.includes("url"));
    const manyTool = tools.find((t) => t.name === "perplexity_fetch_many");
    assert.ok(manyTool.inputSchema.required.includes("urls"));
  } finally {
    await close();
  }
});

test("mcp: server identifies itself with the package version", async () => {
  const { client, close } = await connect();
  try {
    assert.equal(client.getServerVersion().version, VERSION);
    assert.ok(client.getInstructions().length > 200, "server instructions are missing");
  } finally {
    await close();
  }
});

test("mcp: perplexity_fetch returns body text and structuredContent", async () => {
  const stub = installFetch([{ url: ARTICLE_URL, body: ARTICLE_HTML }]);
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "perplexity_fetch", arguments: { url: ARTICLE_URL, use_cache: false } });
    assert.notEqual(result.isError, true, textOf(result));

    const text = textOf(result);
    assert.match(text, /almost none of it reading the page/, "article body missing from the tool response");
    assert.ok(result.structuredContent, "structuredContent is missing");
    assert.match(result.structuredContent.result.text, /almost none of it reading the page/, "structuredContent body is empty");
    assert.equal(result.structuredContent.result.status, 200);
  } finally {
    await close();
    stub.restore();
  }
});

test("mcp: perplexity_fetch on DCinside returns body and comments together", async () => {
  const stub = installFetch([
    {
      url: "https://gall.dcinside.com/board/comment/",
      method: "POST",
      body: (url, init) =>
        (Number(new URLSearchParams(String(init.body || "")).get("comment_page")) === 1
          ? fixture("dcinside-comments.json")
          : '{"total_cnt":4,"comments":[]}'),
      headers: { "content-type": "application/json" },
    },
    { url: "https://gall.dcinside.com/board/view/", body: fixture("dcinside-view.html") },
  ]);
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "perplexity_fetch", arguments: { url: DC_URL, use_cache: false } });
    const text = textOf(result);
    assert.match(text, /무료 티어로도 충분히 돌아간다/, "본문 missing from the tool response");
    assert.match(text, /## 댓글 \(4\)/, "댓글 missing from the tool response");
    assert.equal(result.structuredContent.result.structured_data.comment_count, 4);
  } finally {
    await close();
    stub.restore();
  }
});

test("mcp: perplexity_search returns indexed results and structuredContent", async () => {
  const stub = installFetch([
    { url: "https://api.perplexity.ai/search", method: "POST", body: SEARCH_JSON, headers: { "content-type": "application/json" } },
  ]);
  const { client, close } = await connect();
  try {
    const result = await client.callTool({
      name: "perplexity_search",
      arguments: { query: "headless browser replacement", auto_source_profile: false },
    });
    const text = textOf(result);
    assert.match(text, /\[1\] \*\*I replaced a headless browser/);
    assert.equal(result.structuredContent.result_count, 3);
    assert.equal(result.structuredContent.raw_count, 4);
    assert.equal(result.structuredContent.dropped_duplicates, 1);
    assert.equal(result.structuredContent.results[0].index, 1);
  } finally {
    await close();
    stub.restore();
  }
});

test("mcp: perplexity_fetch_many returns one section per URL", async () => {
  const SECOND = "https://example.com/second";
  const stub = installFetch([
    { url: SECOND, body: ARTICLE_HTML.replace("almost none of it reading", "SECOND PAGE MARKER while reading") },
    { url: ARTICLE_URL, body: ARTICLE_HTML },
  ]);
  const { client, close } = await connect();
  try {
    const result = await client.callTool({
      name: "perplexity_fetch_many",
      arguments: { urls: [ARTICLE_URL, SECOND], use_cache: false },
    });
    const text = textOf(result);
    assert.match(text, /almost none of it reading the page/);
    assert.match(text, /SECOND PAGE MARKER/);
    assert.equal(result.structuredContent.count, 2);
    assert.equal(result.structuredContent.items.length, 2);
  } finally {
    await close();
    stub.restore();
  }
});

test("mcp: perplexity_search_fetch searches then fetches the top results", async () => {
  const stub = installFetch([
    { url: "https://api.perplexity.ai/search", method: "POST", body: SEARCH_JSON, headers: { "content-type": "application/json" } },
    { url: "https://www.reddit.com", status: 404, body: "not found" },
    { url: "https://reddit.com", status: 404, body: "not found" },
    { url: ARTICLE_URL, body: ARTICLE_HTML },
    { url: "https://example.org/note", body: "<html><body><article><p>A short but real note body that is long enough to count as content.</p></article></body></html>" },
  ]);
  const { client, close } = await connect();
  try {
    const result = await client.callTool({
      name: "perplexity_search_fetch",
      arguments: { query: "headless browser replacement", fetch_top_k: 3, auto_source_profile: false, use_cache: false },
    });
    const text = textOf(result);
    assert.match(text, /Found 3 results/);
    assert.match(text, /almost none of it reading the page/, "no fetched body in the evidence pack");
    assert.equal(result.structuredContent.fetched_count, 3);
  } finally {
    await close();
    stub.restore();
  }
});

test("mcp: invalid arguments are reported as tool errors, not silently coerced", async () => {
  const { client, close } = await connect();
  try {
    for (const [name, args, label] of [
      ["perplexity_search", { max_results: 5 }, "missing required query"],
      ["perplexity_search", { query: "x", max_results: 999 }, "max_results above the documented ceiling"],
      ["perplexity_search", { query: "x", search_after_date_filter: "2026-01-01" }, "date filter in the wrong format"],
      ["perplexity_fetch", {}, "missing required url"],
      ["perplexity_fetch", { url: "https://example.com", cleaning_mode: "nope" }, "unknown cleaning_mode"],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${label} was accepted by ${name}`);
    }
  } finally {
    await close();
  }
});
