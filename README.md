# Grok MCP Bridge

A small, deployable MCP server that exposes xAI Grok as an MCP tool.

## What it does

The first MVP exposes:

- `ask_grok` — send a prompt to Grok through the xAI API
- `grok_status` — check bridge/API-key configuration

Architecture:

```
MCP client (ChatGPT / Grok / Cursor / other)
                |
                v
        Grok MCP Bridge
                |
                v
          xAI Grok API
```

This project does **not** automate the consumer Grok website or read a private Grok chat account. It uses the official xAI API.

## Deploy

1. Create an xAI API key.
2. Import this repository into Vercel.
3. Add the environment variable:

```
XAI_API_KEY=...
```

4. Deploy.
5. Your MCP endpoint will be:

```
https://YOUR-DOMAIN.vercel.app/api/mcp
```

The server uses Streamable HTTP.

## Connect to Grok

xAI supports custom MCP connectors. Add the deployed MCP URL in Grok's connector settings.

Example CLI:

```
grok mcp add --transport http grok-mcp-bridge https://YOUR-DOMAIN.vercel.app/api/mcp
```

## Security

For the MVP, the xAI key stays server-side as an environment variable.

Before making this a public multi-user SaaS, add per-user authentication, rate limits, usage limits, audit logging, and tenant isolation.

## Important product limitation

An MCP bridge can expose Grok through the official xAI API. It cannot magically read a user's private conversations from the consumer Grok app unless xAI provides an official API/connector for that data.

## Roadmap

- OAuth / one-click onboarding
- Per-user xAI API key vault
- Multi-tenant isolation
- Usage limits
- `ask_grok` streaming
- `grok_search`
- conversation/session support
- admin dashboard
