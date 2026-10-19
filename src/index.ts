#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigurationError, createServer, loadConfig } from "./server.js";

async function main() {
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error("xAI Search MCP Server running on stdio");
}

main().catch((error: unknown) => {
  // Unexpected exceptions may include credentials or provider diagnostics.
  console.error(error instanceof ConfigurationError ? error.message : "Unable to start xAI Search MCP Server.");
  process.exitCode = 1;
});
