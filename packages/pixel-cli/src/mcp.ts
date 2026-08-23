#!/usr/bin/env node
import { createEditablePixelMcpServer } from "@editable-pixel/mcp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

serveStdio(() => createEditablePixelMcpServer(), {
  onerror: (error) => console.error(`Editable Pixel MCP error: ${error.message}`)
});
