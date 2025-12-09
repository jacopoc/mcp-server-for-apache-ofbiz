import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { TOOLS_FOLDER_PATH } from './server-remote.js';
import { loadTools } from './toolLoader.js';

// Create server instance
const server = new McpServer({
  name: 'Apache OFBiz MCP Server (stdio)',
  version: '0.1.0'
});

// Load and register tools from external files
async function registerTools() {
  try {
    const tools = await loadTools(TOOLS_FOLDER_PATH);

    for (const tool of tools) {
      server.registerTool(tool.name, tool.metadata, tool.handler);
      console.error(`Registered tool: ${tool.name}`);
    }
  } catch (error) {
    console.error('Error loading tools:', error);
    throw error;
  }
}

// Start the server
async function main() {
  await registerTools();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Apache OFBiz MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
