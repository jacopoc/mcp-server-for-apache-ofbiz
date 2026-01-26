# MCP Server for Apache OFBiz®

This project provides an implementation of a Model Context Protocol (MCP) server that runs custom tools to invoke remote services thorugh API endpoints,  based on requests from an MCP client (usually hosted in a generative AI application such as Claude Desktop).

By leveraging the sample configuration and tool files contained in the `examples` folder, the MCP server can be easly configured, e.g., to point to specific backend systems and to use OAuth2.0 authorization flows, and new tools can be developed to address specific use cases.

In short, this project can be used as a platform to implement your own tools and enable generative AI applications to interact with any backend system that exposes API endpoints, such as [**Apache OFBiz®**](https://ofbiz.apache.org) or [**Moqui**](https://www.moqui.org).

This software is licensed under the Apache License, Version 2.0.

Apache OFBiz® is a trademark of the [Apache Software Foundation](https://www.apache.org).

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

The project leverages the **Anthropic TypeScript SDK**, and requires **Node.js**. The MCP server communicates with the MCP client via MCP Streamable HTTP transport.

The server dynamically discovers custom tools contained in a directory, whose path is specified as a command-line argument when the server is lauched.

The tools are defined and implemented in their own files. For example, the sample tool `examples/tools/findProductById.ts` invokes an endpoint in Apache OFBiz to retrieve product information for a given product ID. This works with an out-of-the-box (OOTB) OFBiz instance with the `rest-api` plugin installed.

The server:

- is compliant with the latest MCP specifications (2025-11-25)
- supports authorization according to the MCP recommendations (OAuth Authorization Code Flow with support for Metadata discovery, dynamically registered clients, etc...)
- supports the token exchange OAuth flow in order to obtain a valid token for the backend system
- performs token validation with configurable scopes and audience verification
- supports TLS connections (https) for secure, encrypted communications over public networks
- provides rate limiting features to protect the MCP server and the backend server from denial of service attacks
- allows CORS restriction to enable secure interactions with trusted front-end applications
- supports hosts and origins restrictions for DNS rebinding protection, useful when the server is deployed as a local application

---

## Configuration

Server configuration is managed via the `config.json` file contained in a configuration directory, whose path is specified as a command-line argument when the server is lauched:

- **`SERVER_PORT`** — the port on which the MCP server listens for client connections (required only for the remote server)
- **`TLS_CERT_PATH`** — path to the file containing the certificate for TLS, either absolute or relative to the configuration folder
- **`TLS_KEY_PATH`** — path to the file containing the private key for TLS, either absolute or relative to the configuration folder
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
- **`MCP_SERVER_CLIENT_ID`** — Client ID, as registered in Authz server. It is used by the MCP server to validate the "aud" claim of tokens received by clients. If not set or empty, no "aud" claim validation is performed. This parameter is also required for token exchange
- **`MCP_SERVER_CLIENT_SECRET`** — the secret associated with **`MCP_SERVER_CLIENT_ID`**
- **`BACKEND_API_AUDIENCE`** — the OAuth audience paramenter for the backend system
- **`BACKEND_API_RESOURCE`** — the OAuth resource parameter for the backend system
- **`TOKEN_EXCHANGE_SCOPE`** — the list of scopes requested in the token exchange
- **`BACKEND_API_AUTH`** - the URL to get the OFBiz APIs access token used if token exchange is not enabled
- **`BACKEND_AUTH_TOKEN`** — the token to authorize backend API calls used if token exchange is not enabled

If both **`TLS_CERT_PATH`** and **`TLS_KEY_PATH`** are configured, the MCP server will operate over HTTPS; otherwise, it falls back to HTTP.

If either **`MCP_SERVER_BASE_URL`** or **`AUTHZ_SERVER_BASE_URL`** are not set, authorization is disabled and the MCP server is publicly accessible.

If authorization is enabled, but either **`MCP_SERVER_CLIENT_ID`** or **`MCP_SERVER_CLIENT_SECRET`** are not set, token exchange is disabled.

If token exchange is not enabled, the access token for the back-end APIs can be set in **`BACKEND_AUTH_TOKEN`**.

---

## Project Structure

```text
mcp-server-for-apache-ofbiz/
├── examples/
│   ├── config/                   
│   |   └── config.json           # Sample server configuration file
│   │── tools/
│   │   └── findProductById.ts    # Sample tool calling an Apache OFBiz endpoint
│   ├── update_token.sh           # Script to get a backend auth token for Apache OFBiz APIs
│   ├── package.json              
│   ├── tsconfig.json             
│   └── README.md
├── src/
│   ├── lib/                      # Internal modules of the MCP server:
│   |   ├── /auth/*               # Authorization modules
│   |   ├── /config/*             # Configuration modules
│   |   ├── /mcp/*                # MCP specific modules
│   |   ├── app.ts                # Module for the Express app setup
│   |   └── server-factory.ts     # Module for the HTTP server setup
│   └── server.ts                 # MCP server 
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

With the configuration file provided (`./examples/config/config.json`) the MCP server operates over a plain HTTP connection, on port 3000, with authorization and token exchange disabled, and invokes the APIs of one of the Apache OFBiz demo instances.

The access token required for the OFBiz APIs can be generated and set in **`BACKEND_AUTH_TOKEN`** by running from the `examples` folder the utility script 

`update_token.sh <user> <password>`

with, e.g., `admin` and `ofbiz`, as user and password, respectively.
This script retrieves a JWT for an OOTB OFBiz instance from `https://demo-stable.ofbiz.apache.org/rest/auth/token`, as specified in **`BACKEND_API_AUTH`**.

In order to compile the sample tool, go to the `examples` directory and run

```sh
npm install
npm run build
```

Start the server from the main folder, specifying the paths to the examples configuration and tools folders:

```sh
node ./build/server.js ./examples/config ./examples/build
```
The server is reachable at `http://localhost:3000/mcp`.

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
docker create --name mcp4ofbiz-container -p 3000:3000 -v ${PWD}/examples/config:/usr/src/app/config -v ${PWD}/examples/build:/usr/src/app/build/tools mcp4ofbiz-image ./examples/config ./examples/build
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
