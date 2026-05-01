import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import {
  protectedResourceMetadata,
  requireMcpAuth,
} from "./http/auth.js";
import { createAmazonDriveMcpServer } from "./mcp/server.js";
import { errorMessage } from "./utils.js";

const app = createMcpExpressApp({
  host: config.bindHost,
  allowedHosts: config.allowedHosts,
});
app.set("trust proxy", true);

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    name: config.appName,
    version: config.appVersion,
  });
});

app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);

app.post(config.mcpPath, requireMcpAuth, async (req: Request, res: Response) => {
  const server = createAmazonDriveMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
          details: errorMessage(error),
        },
        id: null,
      });
    }
  } finally {
    await Promise.resolve(transport.close()).catch(() => undefined);
    await Promise.resolve(server.close()).catch(() => undefined);
  }
});

app.get(config.mcpPath, requireMcpAuth, (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use Streamable HTTP POST.",
    },
    id: null,
  });
});

app.delete(config.mcpPath, requireMcpAuth, (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

const server = app.listen(config.port, config.bindHost, () => {
  console.log(
    `${config.appName} listening on ${config.bindHost}:${config.port}${config.mcpPath}`,
  );
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => {
    process.exit(0);
  });
}
