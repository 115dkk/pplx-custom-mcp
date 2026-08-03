import { createMcpHandler } from "agents/mcp";
import { createServer, VERSION } from "./index.js";

// ── Workers fetch handler ───────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isMcpPath = url.pathname === "/mcp" || url.pathname === "/mcp/";

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", service: "perplexity-mcp-server", version: VERSION }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version",
          "Access-Control-Expose-Headers": "Mcp-Session-Id, mcp-protocol-version",
        },
      });
    }

    if (!isMcpPath) return new Response("Not found", { status: 404 });
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST, DELETE, OPTIONS" } });
    }

    if (env.MCP_RATE_LIMITER?.limit) {
      const clientKey = request.headers.get("cf-connecting-ip") || "unknown-client";
      const { success } = await env.MCP_RATE_LIMITER.limit({ key: clientKey });
      if (!success) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32029, message: "Rate limit exceeded. Retry in 60 seconds." },
            id: null,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "60",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    const apiKey = env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "PERPLEXITY_API_KEY secret is not configured" },
          id: null,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const server = createServer(apiKey, { browserBinding: env.BROWSER });
    const handler = createMcpHandler(server);
    const response = await handler(request, env, ctx);

    const corsResponse = new Response(response.body, response);
    corsResponse.headers.set("Access-Control-Allow-Origin", "*");
    corsResponse.headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, mcp-protocol-version");
    return corsResponse;
  },
};
