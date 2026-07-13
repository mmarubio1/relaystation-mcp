# Relaystation MCP connector — zero-dependency stdio server.
# Introspection (initialize, tools/list) runs with no build step, no network,
# and no environment variables. Tool calls need RELAYSTATION_API_KEY at runtime.
FROM node:22-slim

WORKDIR /app

# No runtime dependencies — copying the source is the whole build.
COPY package.json ./
COPY src ./src

USER node

# stdio transport: the server talks JSON-RPC over stdin/stdout.
ENTRYPOINT ["node", "src/index.js"]
