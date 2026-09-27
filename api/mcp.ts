import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const XAI_URL = "https://api.x.ai/v1/responses";
const DEFAULT_MODEL = "grok-4.7";

function requireApiKey() {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured.");
  return key;
}

function buildServer() {
  const server = new McpServer({
    name: "grok-mcp-bridge",
    version: "0.1.0"
  });

  server.registerTool(
    "ask_grok",
    {
      title: "Ask Grok",
      description:
        "Send a prompt to xAI Grok and return its response. Use this when you need Grok to research, reason, or produce a second AI opinion.",
      inputSchema: {
        prompt: z.string().min(1).describe("The instruction or question to send to Grok."),
        model: z.string().optional().describe("Optional xAI model name. Defaults to grok-4.7.")
      }
    },
    async ({ prompt, model }) => {
      const apiKey = requireApiKey();

      const response = await fetch(XAI_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model || DEFAULT_MODEL,
          input: prompt
        })
      });

      const body = await response.text();

      if (!response.ok) {
        throw new Error(`xAI API error (${response.status}): ${body.slice(0, 2000)}`);
      }

      const data = JSON.parse(body);
      const outputText =
        data.output_text ??
        data.output
          ?.flatMap((item: any) => item.content ?? [])
          ?.map((item: any) => item.text)
          ?.filter(Boolean)
          ?.join("\n") ??
        JSON.stringify(data);

      return {
        content: [{ type: "text", text: String(outputText) }]
      };
    }
  );

  server.registerTool(
    "grok_status",
    {
      title: "Grok Bridge Status",
      description: "Check whether the bridge has an xAI API key configured.",
      inputSchema: {}
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            bridge: "ok",
            xai_api_key_configured: Boolean(process.env.XAI_API_KEY),
            default_model: DEFAULT_MODEL
          }, null, 2)
        }
      ]
    })
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
