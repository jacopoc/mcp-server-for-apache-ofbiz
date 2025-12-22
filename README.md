# MCP Server for Apache OFBiz®

This project provides a prototype implementation of a Model Context Protocol (MCP) server for Apache OFBiz® that:

- receives requests from an MCP client (usually hosted in a generative AI application such as Claude Desktop) and forwards those requests to a remote backend via RESTful API endpoints,
- exposes a template tool that invokes the findProductById OFBiz endpoint.

This project can be used as a platform to implement your own tools and enable generative AI applications to interact with any backend system that exposes REST API endpoints, such as [**Apache OFBiz**](https://ofbiz.apache.org) or [**Moqui**](https://www.moqui.org).

The server implements an MCP server with Streamable HTTP transport.

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
5. [Test the Remote MCP Server](#test-the-mcp-server)
6. [Inspect the MCP servers](#inspect-the-mcp-servers)
7. [Containerization with Docker](#containerization-with-docker)

---

## Features

The project includes an MCP server (`src/server.ts`) that communicates with the MCP client via MCP Streamable HTTP transport.

The server dynamically discovers MCP tools contained in the `tools` directory, whose path is specified as a command-line argument when the server is lauched.

Each tool is defined and implemented in its own file. For example, the sample tool `tools/findProductById.ts` invokes an endpoint in Apache OFBiz to retrieve product information for a given product ID. This works with an out-of-the-box (OOTB) OFBiz instance with the `rest-api` plugin installed.

New tools can be published by simply including their definition files in the `tools` folder.

The server:

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

- **`SERVER_PORT`** — the port on which the MCP server listens for client connections (required only for the remote server)
- **`TLS_CERT_PATH`** — path to the file containing the certificate for TLS
- **`TLS_KEY_PATH`** — path to the file containing the private key for TLS
- **`TLS_KEY_PASSPHRASE`** — (optional) passphrase for the **`TLS_KEY_PATH`** file
- **`MCP_SERVER_CORS_ORIGINS`** — CORS origin allowed
- **`MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS`** - list of allowed values for request header `Host` for DNS rebinding protection
- **`MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_ORIGINS`** - list of allowed values for request header `Origin` for DNS rebinding protection
- **`RATE_LIMIT_WINDOW_MS`** — time window in ms for the requests rate limiting feature
- **`RATE_LIMIT_MAX_REQUESTS`** — max number of requests allowed in the time window
- **`MCP_SERVER_BASE_URL`** — the base URL of the MCP server used to get OAuth metadata (Protected Resource Server in OAuth)
- **`AUTHZ_SERVER_BASE_URL`** — the base URL of the Authorization (Authz) server (OAuth)
- **`SCOPES_SUPPORTED`** — the scopes that the MCP client can request
- **`BACKEND_API_BASE`** — the base URL for backend REST API calls
- **`BACKEND_USER_AGENT`** — the user agent set in the header of downstream API calls
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

If token exchange is not enabled, the access token for the OFBiz API can be set in **`BACKEND_AUTH_TOKEN`**.

---

## Project Structure

```text
mcp-server-for-apache-ofbiz/
├── config/
│   └── config.json               # Server configuration file
├── src/
│   ├── server.ts                 # MCP server (Streamable HTTP transport)
│   ├── lib/                      # Internal modules of the MCP server:
│   |   ├── /auth/*               #   Authorization modules
│   |   ├── /config/*             #   Configuration modules
│   |   ├── /mcp/*                #   MCP specific modules
│   |   ├── app.ts                #   Module for the Express app setup
│   |   └── server-factory.ts     #   Module for the HTTP server setup
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

## Test the MCP Server

With the configuration file provided (`./config/config.json`) the MCP server operates over a plain HTTP connection at `http://localhost:3000/mcp`, with authorization and token exchange disabled, and invokes the APIs of one of the Apache OFBiz demo instances.

The access token required for the OFBiz APIs can be generated and set in **`BACKEND_AUTH_TOKEN`** by running the utility script

`update_token.sh <user> <password>`

with, e.g., `admin` and `ofbiz`, as user and password, respectively.
This script retrieves a JWT for an OOTB OFBiz instance from `https://demo-stable.ofbiz.apache.org/rest/auth/token`, as specified in **`BACKEND_API_AUTH`**.

Start the server specifying the paths to the configuration and tools folders:

```sh
node ./build/server.js ./config ./build/tools
```

You can test the MCP server with the free version of **Claude Desktop**.

Edit or create the Claude Desktop configuration file:

```sh
~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add your MCP server configuration:

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

After updating the configuration file, launch Claude Desktop and try the following sample prompts:

- _"Can you provide some information about the product WG-1111?"_
- _"Create a SEO friendly description for the product with ID GZ-1000"_
- _"Can you provide some information about a product?"_  
  (Claude will ask for a product ID before invoking the tool.)
- _"Can you compare two products?"_  
  (Claude will ask for two product IDs, invoke the tool twice, and then compare the results.)

## Inspect the MCP server

You can use Anthropic’s **Inspector** to easily test interactions with the MCP server.

Run (and install) the Inspector with:

```sh
npx @modelcontextprotocol/inspector
```

This will open a browser window ready to test your MCP servers.

## Containerization with Docker

The following instructions describe how to containerize the MCP server using Docker and the Dockerfile provided.

First, build a Docker image named, e.g., `mcp4ofbiz-image`:

```sh
docker build -t mcp4ofbiz-image .
```

If your target environment uses a different CPU architecture than your development machine (for example, if you're working on an Apple M1 but deploying to an amd64 platform), make sure to build the image for the correct target architecture:

```sh
docker build --platform=linux/amd64 -t mcp4ofbiz-image .
```

After building the image, create a container, e.g., named `mcp4ofbiz-container`

```sh
docker create --name mcp4ofbiz-container -p 3000:3000 -v ${PWD}/config:/usr/src/app/config -v ${PWD}/build/tools:/usr/src/app/build/tools mcp4ofbiz-image ./config ./build/tools
```

and run it

```sh
docker start mcp4ofbiz-container
```

The MCP server will be available at http://localhost:3000/mcp.

If you wish, you can push the image to your registry by running

```sh
docker push myregistry.com/mcp4ofbiz-image
```
