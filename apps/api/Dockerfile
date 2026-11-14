# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN --mount=type=secret,id=proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --workspace=@tuinwerk/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build --workspace=@tuinwerk/api
RUN npm prune --omit=dev --workspace=@tuinwerk/api --include-workspace-root
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001 UPLOAD_DIR=/data/uploads MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/migrations ./migrations
RUN mkdir -p /data/uploads /data/exports && chown -R node:node /data
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
