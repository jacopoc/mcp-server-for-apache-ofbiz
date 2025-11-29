### Building and running the server

Start the application by running:
`docker compose -p apache-ofbiz-mcp up --build`.

The MCP server will be available at http://localhost:3000/mcp.

### Deploying your application to the cloud

First, build the image: `docker build -t apache-ofbiz-mcp-server .`.
If your cloud uses a different CPU architecture than your development
machine (e.g., you are on a Mac M1 and your cloud provider is amd64),
you'll want to build the image for that platform, e.g.:
`docker build --platform=linux/amd64 -t apache-ofbiz-mcp-server .`.

Then, push it to your registry, e.g. `docker push myregistry.com/apache-ofbiz-mcp-server`.

### References

- [Docker's Node.js guide](https://docs.docker.com/language/nodejs/)
- [Docker's Get Started Sharing guide](https://docs.docker.com/go/get-started-sharing/)
