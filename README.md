# Grok MCP Bridge

A small Vercel-hosted **custom MCP connector for consumer Grok**.

Grok (at grok.com) is the MCP **client**. This server exposes free utility tools Grok can call in chat. It does **not** call the xAI API and needs **no** `XAI_API_KEY`.

## Tools

- `bridge_status` — health check for the connector
- `world_clock` — current time for an IANA timezone
- `fetch_public_url` — fetch a public `https://` page (blocks private/local addresses)

## Deploy

Already designed for Vercel (`api/mcp.ts` + `vercel.json`). After deploy, the MCP endpoint is:

```text
https://YOUR-DOMAIN.vercel.app/api/mcp
```

Production example:

```text
https://grok-mpc-bridge.vercel.app/api/mcp
```

No environment variables are required for the free connector mode.

## Connect in Grok

1. Open [grok.com/connectors](https://grok.com/connectors).
2. Click **New Connector** → **Custom**.
3. Paste the MCP URL: `https://grok-mpc-bridge.vercel.app/api/mcp`
4. Complete any auth prompts if Grok shows them (none required by this server).
5. In a Grok chat, ask it to use `bridge_status` or `world_clock`.

CLI example (if available on your plan):

```bash
grok mcp add --transport http grok-mcp-bridge https://grok-mpc-bridge.vercel.app/api/mcp
```

## What this is not

This project cannot proxy your consumer Grok chat account into Cursor/ChatGPT without the official xAI API. Consumer Grok billing and API billing are separate. Scraping grok.com or reusing session cookies is unsupported and not implemented.

## Security

- `fetch_public_url` only allows `https://`, rejects credentials in URLs, and blocks localhost / private IP ranges (including DNS that resolves privately).
- Redirects are not followed.
- Response bodies are truncated.

Before exposing write-capable or private-data tools, add authentication, rate limits, and audit logging.
