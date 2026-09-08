#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createEditablePixelMcpServer } from "./index.js";

serveStdio(() => createEditablePixelMcpServer(), {
  onerror: (error) => console.error(`Editable Pixel MCP error: ${error.message}`)
});
