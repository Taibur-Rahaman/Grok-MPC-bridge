import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";

const MAX_FETCH_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 10_000;

function isPrivateOrLocalIp(ip: string): boolean {
    if (ip === "::1" || ip === "0.0.0.0") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;

  const v4 = ip.includes(".") ? ip : null;
    if (!v4) return false;

  const parts = v4.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

async function assertPublicHttpsUrl(raw: string): Promise<URL> {
    let url: URL;
    try {
          url = new URL(raw);
    } catch {
          throw new Error("Invalid URL.");
    }
    if (url.protocol !== "https:") {
          throw new Error("Only https:// URLs are allowed.");
    }
    if (url.username || url.password) {
          throw new Error("URLs with credentials are not allowed.");
    }
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
          throw new Error("Local hosts are not allowed.");
    }
    if (host === "metadata.google.internal") {
          throw new Error("That host is not allowed.");
    }

  const literal = isIP(host);
    if (literal) {
          if (isPrivateOrLocalIp(host)) {
                  throw new Error("Private or local IP addresses are not allowed.");
          }
    } else {
          const records = await lookup(host, { all: true, verbatim: true });
          if (!records.length) throw new Error("Could not resolve host.");
          for (const record of records) {
                  if (isPrivateOrLocalIp(record.address)) {
                            throw new Error("Host resolves to a private or local address.");
                  }
          }
    }
    return url;
}

function buildServer() {
    const server = new McpServer({
          name: "grok-mcp-bridge",
          version: "0.2.0"
    });

  server.registerTool(
        "bridge_status",
    {
            title: "Bridge Status",
            description:
                      "Check that this custom MCP connector is reachable. Does not call the xAI API and needs no API key.",
            inputSchema: {}
    },
        async () => ({
                content: [
                  {
                              type: "text",
                              text: JSON.stringify(
                                {
                                                bridge: "ok",
                                                mode: "grok-custom-connector",
                                                xai_api_required: false,
                                                tools: ["bridge_status", "world_clock", "fetch_public_url"],
                                                version: "0.2.0"
                                },
                                            null,
                                            2
                                          )
                  }
                        ]
        })
      );

  server.registerTool(
        "world_clock",
    {
            title: "World Clock",
            description:
                      "Return the current date and time for an IANA timezone (for example Asia/Thimphu or America/New_York).",
            inputSchema: {
                      timezone: z
                        .string()
                        .min(1)
                        .describe("IANA timezone name, e.g. Asia/Thimphu")
            }
    },
        async ({ timezone }) => {
                try {
                          const now = new Date();
                          const formatted = new Intl.DateTimeFormat("en-US", {
                                      timeZone: timezone,
                                      weekday: "long",
                                      year: "numeric",
                                      month: "long",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                      timeZoneName: "short"
                          }).format(now);

                  return {
                              content: [
                                {
                                                type: "text",
                                                text: JSON.stringify(
                                                  {
                                                                      timezone,
                                                                      iso_utc: now.toISOString(),
                                                                      local: formatted
                                                  },
                                                                  null,
                                                                  2
                                                                )
                                }
                                          ]
                  };
                } catch {
                          throw new Error(`Invalid timezone: ${timezone}`);
                }
        }
      );

  server.registerTool(
        "fetch_public_url",
    {
            title: "Fetch Public URL",
            description:
                      "Fetch a public https:// URL and return truncated text content. Blocks private/local addresses. Use for public docs or pages only.",
            inputSchema: {
                      url: z.string().url().describe("Public https URL to fetch.")
            }
    },
        async ({ url: rawUrl }) => {
                const url = await assertPublicHttpsUrl(rawUrl);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

          try {
                    const response = await fetch(url, {
                                method: "GET",
                                redirect: "manual",
                                signal: controller.signal,
                                headers: {
                                              "User-Agent": "grok-mcp-bridge/0.2 (+https://grok-mcp-bridge.vercel.app)",
                                              Accept: "text/plain, text/html, application/json, application/xml, */*;q=0.1"
                                }
                    });

                  if (response.status >= 300 && response.status < 400) {
                              throw new Error(`Refusing to follow redirects (status ${response.status}).`);
                  }

                  const contentType = response.headers.get("content-type") || "unknown";
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const truncated = buffer.length > MAX_FETCH_BYTES;
                    const slice = buffer.subarray(0, MAX_FETCH_BYTES);
                    const text = slice.toString("utf8");

                  return {
                              content: [
                                {
                                                type: "text",
                                                text: JSON.stringify(
                                                  {
                                                                      url: url.toString(),
                                                                      status: response.status,
                                                                      content_type: contentType,
                                                                      bytes: buffer.length,
                                                                      truncated,
                                                                      body: text
                                                  },
                                                                  null,
                                                                  2
                                                                )
                                }
                                          ]
                  };
          } finally {
                    clearTimeout(timer);
          }
        }
      );

  return server;
}

const sessions = new Map<string, StreamableHTTPServerTransport>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
        return res.status(204).end();
  }

  if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
        return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
        if (sessionId && sessions.has(sessionId)) {
                const transport = sessions.get(sessionId)!;
                await transport.handleRequest(req, res, req.body);
                return;
        }

      if (req.method !== "POST" || !isInitializeRequest(req.body)) {
              return res.status(400).json({
                        error: "No valid MCP session. Send an MCP initialize request first."
              });
      }

      const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id) => {
                        sessions.set(id, transport);
              }
      });

      transport.onclose = () => {
              const id = transport.sessionId;
              if (id) sessions.delete(id);
      };

      const server = buildServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
  } catch (error) {
        console.error(error);
        if (!res.headersSent) {
                return res.status(500).json({
                          error: error instanceof Error ? error.message : "Internal server error"
                });
        }
  }
}
