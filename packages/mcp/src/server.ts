import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthService } from "./auth/auth-service.js";
import { NuraViewClient } from "./nuraview/client.js";
import { registerTools } from "./tools/register.js";
import { normalizeBaseUrl } from "./utils/normalize-base-url.js";

const require = createRequire(import.meta.url);
const { version: packageVersion } = require("../package.json") as {
  version: string;
};

export function createMcpServer(): McpServer {
  const baseUrl = normalizeBaseUrl(
    process.env.NURAVIEW_API_URL || "http://localhost:1337",
  );
  const clientId = process.env.NURAVIEW_MCP_CLIENT_ID || "nuraview-mcp";
  const apiKey = process.env.NURAVIEW_API_KEY || undefined;
  const auth = new AuthService({ baseUrl, clientId, apiKey });
  const client = new NuraViewClient({ baseUrl, auth });
  const server = new McpServer({
    name: "nuraview-mcp",
    version: packageVersion,
  });
  registerTools(server, { client });
  return server;
}
