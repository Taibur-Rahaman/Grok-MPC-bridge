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
