# XRPL-Utilities MCP server, hosted variant.
# Build: docker build -t xrpl-utilities-mcp .
# Run:   docker run -p 8080:8080 -e MCP_BYPASS_KEY=... xrpl-utilities-mcp

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
