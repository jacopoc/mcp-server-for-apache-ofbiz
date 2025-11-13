# MCP Server for REST APIs

This project provides a prototype implementation of an MCP server that:  

- exposes specific tools,  
- receives requests from an MCP client (usually hosted in a generative AI application such as Claude Desktop),  
- forwards those requests to a remote backend via RESTful API endpoints,
- implements authorization according to the MCP specifications (OAuth Authorization Code Flow with support for Metadata discovery, Dynamic Client Registration etc...).

The server enables generative AI applications to interact with backend systems that expose REST API endpoints, such as **Apache OFBiz** and **Moqui**.  

The server is implemented in two versions, one that runs as a local MCP server (stdio transport) and one that runs as a remote MCP server (Streamable HTTP transport).

The project is implemented in **TypeScript**, uses the **Anthropic TypeScript SDK**, and requires:  

- Node.js  
- npm

---

## Table of Contents
1. [Features](#features)  
2. [Configuration](#configuration)  
3. [Project Structure](#project-structure)  
4. [Build the Project](#build-the-project)  
5. [Test the Local MCP Server](#test-the-local-mcp-server)  
6. [Test the Remote MCP Server](#test-the-remote-mcp-server)
7. [Inspect the MCP servers](#inspect-the-mcp-servers)

---

## Features

The project includes two alternative MCP servers:  

- **Local MCP server** (`src/server-local.ts`) — communicates with the MCP client via stdio transport.  
- **Remote MCP server** (`src/server-remote.ts`) — communicates with the MCP client via MCP Streamable HTTP transport.  

The servers are modular and dynamically discover MCP tools contained in the `tools` directory.  

Each tool is defined and implemented in its own file. For example, the sample tool `tools/findProductById.ts` invokes an endpoint in Apache OFBiz to retrieve product information for a given ID. This works with an out-of-the-box (OOTB) OFBiz instance with the `rest-api` plugin installed.  

---

## Configuration

Server configuration is managed via `config/config.json`, which defines:  

- **`MCP_SERVER_BASE_URL`** — the base URL of the MCP server (Protected Resource Server in OAuth)
- **`AUTHZ_SERVER_BASE_URL`** — the base URL of the Authorization server (OAuth)
- **`BACKEND_API_BASE`** — the base URL for backend REST API calls  
- **`BACKEND_API_AUTH`** - the URL to get the OFBiz APIs access token
- **`BACKEND_AUTH_TOKEN`** — the token used to authorize backend API calls  
- **`SERVER_PORT`** — the port on which the MCP server listens for client connections (required only for the remote server)  

If either **`MCP_SERVER_BASE_URL`** or **`AUTHZ_SERVER_BASE_URL`** are not set, authorization is disabled and the MCP server is publicly accessible.

The authorization token for the OFBiz API can be easily generated and set up by running the script: 

`update_token.sh <user> <password>` 

This script retrieves a JWT for an OOTB OFBiz instance (e.g., `https://demo-stable.ofbiz.apache.org/rest/auth/token`).  

---

## Project Structure

```text
mcp-prototypes/
├── config/
│   └── config.json               # Server configuration (backend API base, auth token, etc.)
├── src/
│   ├── server-local.ts                 # Local MCP server (stdio transport)
│   ├── server-remote.ts          # Remote MCP server (Streamable HTTP transport)
│   ├── toolLoader.ts             # Loader of tool definitions from "tools/"
│   └── tools/               
│       └── findProductById.ts    # Example tool calling an Apache OFBiz REST endpoint
├── update_token.sh               # Script to refresh backend auth token
├── package.json
├── tsconfig.json
└── README.md
```

## Build the Project

```sh
npm install
npm run build
```

## Test the Local MCP Server

You can test the local MCP server with **Claude Desktop**.  

Edit or create the Claude Desktop configuration file:

```sh
~/Library/Application\ Support/Claude/claude_desktop_config.json
```
Add your local MCP server configuration:
```json
{
  "mcpServers": {
    "Apache OFBiz": {
      "command": "node",
      "args": ["PATH_TO/mcp-prototypes/build/server-local.js"]
    }
  }
}
```
After updating the configuration file, launch Claude Desktop and try the following sample prompts:
* *"Can you provide some information about the product WG-1111?"*
* *"Create a SEO friendly description for the product with ID GZ-1000"*
* *"Can you provide some information about a product?"*  
(Claude will ask for a product ID before invoking the tool.)
* *"Can you compare two products?"*  
(Claude will ask for two product IDs, invoke the tool twice, and then compare the results.)

## Test the Remote MCP Server

Start the server:
```sh
node build/server-remote.js
```

You can test the local MCP server with **Claude Desktop**.  

Edit or create the Claude Desktop configuration file:

```sh
~/Library/Application\ Support/Claude/claude_desktop_config.json
```
Add your local MCP server configuration:
```json
{
  "mcpServers": {
    "Apache OFBiz": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp", "--allow-http"]
    }
  }
}
```

## Inspect the MCP servers

You can use Anthropic’s **Inspector** to easily test interactions with the local and remote MCP servers. You can do this also when a remote server is executed in your local host or private network, without requiring valid certificates or deploying the server on a publicly accessible host.

Run (and install) the Inspector with:
```sh
npx @modelcontextprotocol/inspector
```
This will open a browser window ready to test your MCP servers.
