# MCP Server for Apache OFBiz®

This project provides a prototype implementation of a Model Context Protocol (MCP) server for Apache OFBiz® that:

- receives requests from an MCP client (usually hosted in a generative AI application such as Claude Desktop) and forwards those requests to a remote backend via RESTful API endpoints,
- exposes a template tool that invokes the findProductById OFBiz endpoint.

This project can be used as a platform to implement your own tools and enable generative AI applications to interact with any backend system that exposes REST API endpoints, such as [**Apache OFBiz**](https://ofbiz.apache.org) or [**Moqui**](https://www.moqui.org).

The server is implemented in two versions, one that runs as a local MCP server (stdio transport) and one that runs as a remote MCP server (Streamable HTTP transport).

The project leverages the **Anthropic TypeScript SDK**, and requires:

- Node.js
- npm

This software is licensed under the Apache License, Version 2.0.

Apache OFBiz® is a trademark of the [Apache Software Foundation](https://www.apache.org)

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

The servers dynamically discover MCP tools contained in the `tools` directory.

Each tool is defined and implemented in its own file. For example, the sample tool `tools/findProductById.ts` invokes an endpoint in Apache OFBiz to retrieve product information for a given product ID. This works with an out-of-the-box (OOTB) OFBiz instance with the `rest-api` plugin installed.

New tools can be published by simply including their definition files in the `tools` folder.

The remote server:

- is compliant with the latest MCP specifications (2025-06-18)
- supports authorization according to the MCP recommendations (OAuth Authorization Code Flow with support for Metadata discovery, Dynamic Client Registration, etc...)
- supports the token exchange OAuth flow in order to obtain a valid token for the backend system
- performs token validation with configurable scopes and audience verification
- supports TLS connections (https)
- provides rate limiting features to protect the MCP server and the backend server from denial of service attacks
- allows CORS restrictions

---

## Configuration

Server configuration is managed via `config/config.json`, which defines:

- **`MCP_SERVER_BASE_URL`** — the base URL of the MCP server (Protected Resource Server in OAuth)
- **`SERVER_PORT`** — the port on which the MCP server listens for client connections (required only for the remote server)
- **`TLS_CERT_PATH`** — path to the file containing the certificate for TLS
- **`TLS_KEY_PATH`** — path to the file containing the private key for TLS
- **`TLS_KEY_PASSPHRASE`** — (optional) passphrase for the **`TLS_KEY_PATH`** file
- **`MCP_SERVER_CORS_ORIGINS`** — CORS origin allowed
- **`RATE_LIMIT_WINDOW_MS`** — time window in ms for the requests rate limiting feature
- **`RATE_LIMIT_MAX_REQUESTS`** — max number of requests allowed in the time window
- **`AUTHZ_SERVER_BASE_URL`** — the base URL of the Authorization (Authz) server (OAuth)
- **`SCOPES_SUPPORTED`** — the scopes that the MCP client can request
- **`BACKEND_API_BASE`** — the base URL for backend REST API calls
- **`MCP_SERVER_CLIENT_ID`** — Client ID required for token exchange, as registered in Authz server
- **`MCP_SERVER_CLIENT_SECRET`** — the secret associated with **`MCP_SERVER_CLIENT_ID`**
- **`BACKEND_API_AUDIENCE`** — the OAuth audience paramenter for the backend system
- **`BACKEND_API_RESOURCE`** — the OAuth resource parameter for the backend system
- **`TOKEN_EXCHANGE_SCOPE`** — the list of scopes requested in the token exchange
- **`BACKEND_API_AUTH`** - the URL to get the OFBiz APIs access token used if token exchange is not enabled
- **`BACKEND_AUTH_TOKEN`** — the token to authorize backend API calls used if token exchange is not enabled

If both **`TLS_CERT_PATH`** and **`TLS_KEY_PATH`** are configured, the MCP server will operate over HTTPS; otherwise, it falls back to HTTP.

If either **`MCP_SERVER_BASE_URL`** or **`AUTHZ_SERVER_BASE_URL`** are not set, authorization is disabled and the MCP server is publicly accessible.

If authorization is enabled, but either **`MCP_SERVER_CLIENT_ID`** or **`MCP_SERVER_CLIENT_SECRET`** are not set, token exchange is disabled.

If token exchange is not enabled, the access token for the OFBiz API can be set **`BACKEND_AUTH_TOKEN`** and can be easily generated and set by running the script:

`update_token.sh <user> <password>`

This script retrieves a JWT for an OOTB OFBiz instance, as specified by **`BACKEND_API_AUTH`** (e.g., `https://demo-stable.ofbiz.apache.org/rest/auth/token`).

---

## Project Structure

```text
mcp-server-for-apache-ofbiz/
├── config/
│   └── config.json               # Server configuration (backend API base, auth token, etc.)
├── src/
│   ├── server-local.ts           # Local MCP server (stdio transport)
│   ├── server-remote.ts          # Remote MCP server (Streamable HTTP transport)
│   ├── toolLoader.ts             # Loader of tool definitions from "tools/"
│   └── tools/
│       └── findProductById.ts    # Example tool calling an Apache OFBiz REST endpoint
├── update_token.sh               # Script to refresh backend auth token
├── package.json
├── tsconfig.json
└── README.md                     # This readme file
└── LICENSE                       # Apache License, Version 2.0
```

## Build the Project

```sh
npm install
npm run build
```

## Test the Local MCP Server

You can test the local MCP server with the free version of **Claude Desktop**.

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
      "args": ["PATH_TO/mcp-server-for-apache-ofbiz/build/server-local.js"]
    }
  }
}
```

After updating the configuration file, launch Claude Desktop and try the following sample prompts:

- _"Can you provide some information about the product WG-1111?"_
- _"Create a SEO friendly description for the product with ID GZ-1000"_
- _"Can you provide some information about a product?"_  
  (Claude will ask for a product ID before invoking the tool.)
- _"Can you compare two products?"_  
  (Claude will ask for two product IDs, invoke the tool twice, and then compare the results.)

## Test the Remote MCP Server

Start the server:

```sh
node build/server-remote.js
```

You can test the local MCP server with the free version of **Claude Desktop**.

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
