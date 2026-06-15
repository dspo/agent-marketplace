import http from "node:http";

// In-process fake of the MiMo HTTP server. Implements just enough of the REST
// surface for the plugin client: POST /session, POST /session/:id/message,
// POST /session/:id/abort, GET /session, GET /session/:id, GET /session/:id/diff,
// GET /config, GET /event (SSE).
export async function startFakeMiMoServer(options = {}) {
  const sessions = new Map();
  const prompts = [];
  const eventClients = new Set();
  let sessionCounter = 0;

  const behavior = {
    promptDelayMs: options.promptDelayMs ?? 0,
    promptResponse: options.promptResponse ?? null,
    promptStatus: options.promptStatus ?? 200,
    structured: options.structured,
    finalText: options.finalText ?? "fake final answer",
    busySessions: new Set()
  };

  function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const segments = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/config") {
      return json(res, 200, {});
    }

    if (req.method === "GET" && url.pathname === "/event") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
      eventClients.add(res);
      req.on("close", () => eventClients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/session") {
      const body = await readBody(req);
      sessionCounter += 1;
      const id = `ses_fake${String(sessionCounter).padStart(4, "0")}`;
      const session = {
        id,
        title: body.title ?? "untitled",
        permission: body.permission ?? null,
        directory: req.headers["x-mimocode-directory"] ?? ""
      };
      sessions.set(id, session);
      return json(res, 200, session);
    }

    if (req.method === "GET" && url.pathname === "/session") {
      return json(res, 200, [...sessions.values()]);
    }

    if (segments[0] === "session" && segments.length >= 2) {
      const sessionID = segments[1];
      const session = sessions.get(sessionID);

      if (req.method === "GET" && segments.length === 2) {
        if (!session) {
          return json(res, 404, { error: "not found" });
        }
        return json(res, 200, session);
      }

      if (req.method === "PATCH" && segments.length === 2) {
        if (!session) {
          return json(res, 404, { error: "not found" });
        }
        const body = await readBody(req);
        Object.assign(session, body);
        return json(res, 200, session);
      }

      if (req.method === "POST" && segments[2] === "message") {
        if (!session) {
          return json(res, 404, { error: "not found" });
        }
        if (behavior.busySessions.has(sessionID)) {
          return json(res, 409, { error: "busy" });
        }
        const body = await readBody(req);
        prompts.push({ sessionID, body, directory: req.headers["x-mimocode-directory"] ?? "" });

        if (behavior.promptStatus !== 200) {
          return json(res, behavior.promptStatus, { error: `forced ${behavior.promptStatus}` });
        }

        if (behavior.promptDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, behavior.promptDelayMs));
        }

        if (behavior.promptResponse) {
          return json(res, 200, behavior.promptResponse);
        }

        const structured = body.format?.type === "json_schema" ? behavior.structured : undefined;
        return json(res, 200, {
          info: {
            id: `msg_fake_${prompts.length}`,
            role: "assistant",
            ...(structured !== undefined ? { structured } : {})
          },
          parts: [{ type: "text", text: behavior.finalText }]
        });
      }

      if (req.method === "POST" && segments[2] === "abort") {
        return json(res, 200, true);
      }

      if (req.method === "GET" && segments[2] === "diff") {
        return json(res, 200, []);
      }
    }

    json(res, 404, { error: `unhandled ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    sessions,
    prompts,
    behavior,
    emitEvent(event) {
      for (const client of eventClients) {
        client.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    },
    async close() {
      for (const client of eventClients) {
        client.end();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
