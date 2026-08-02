// Live smoke: talk to the DEPLOYED Worker over MCP and pull real pages.
//
// The fixture suite proves the code still does what it did. This proves the
// sites still look the way the code expects. Site drift is not a regression, so
// this never gates a deploy — it runs on a schedule and on demand.
//
//   WORKER_URL=https://perplexity-mcp.<account>.workers.dev node scripts/live-smoke.mjs

import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.env.WORKER_URL || "").replace(/\/+$/, "");
if (!base) {
  console.error("WORKER_URL is not set.");
  process.exit(2);
}

const config = JSON.parse(readFileSync(new URL("../test/live-targets.json", import.meta.url), "utf8"));
const targets = [
  ...config.targets,
  ...config.optional.filter((t) => t.url && t.url.trim()),
];

const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

// 1. /health
try {
  const res = await fetch(`${base}/health`);
  const body = await res.json();
  check(res.ok && body.status === "ok", "/health", `status=${res.status} body=${JSON.stringify(body)}`);
} catch (err) {
  check(false, "/health", String(err));
}

// 2. MCP handshake + tool inventory
const client = new Client({ name: "live-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(
  ["perplexity_fetch", "perplexity_fetch_many", "perplexity_search", "perplexity_search_fetch"]
    .every((n) => names.includes(n)),
  "tools/list",
  names.join(", ")
);

// 3. Real fetches
for (const target of targets) {
  try {
    const result = await client.callTool({
      name: "perplexity_fetch",
      arguments: { url: target.url, use_cache: false, max_chars: 4000 },
    });
    const text = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const body = text.split("\n\n").slice(1).join("\n\n");

    check(
      body.length >= target.min_body_chars,
      `${target.name}: body length`,
      `${body.length} chars (need ${target.min_body_chars})`
    );
    for (const needle of target.must_contain || []) {
      check(text.includes(needle), `${target.name}: contains ${JSON.stringify(needle)}`);
    }
  } catch (err) {
    check(false, target.name, String(err).slice(0, 300));
  }
}

await client.close();

if (failures.length) {
  console.error(`\n${failures.length} live check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall live checks passed");
