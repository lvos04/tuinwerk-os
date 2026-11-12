# syntax=docker/dockerfile:1
FROM node:22-alpine3.22 AS build
WORKDIR /app
COPY . .
ENV API_INTERNAL_URL=http://127.0.0.1:3001 NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --workspace=@tuinwerk/api --workspace=@tuinwerk/web --include-workspace-root && \
    npm run build --workspace=@tuinwerk/api && \
    npm run build --workspace=@tuinwerk/web && \
    npm prune --omit=dev --workspace=@tuinwerk/api --include-workspace-root && \
    mkdir -p /runtime/app/api /runtime/app/web /runtime/opt/tuinwerk && \
    cp -a node_modules /runtime/app/api/node_modules && \
    cp -a apps/api/dist apps/api/migrations /runtime/app/api/ && \
    cp -a apps/web/.next/standalone/. /runtime/app/web/ && \
    mkdir -p /runtime/app/web/apps/web/.next && \
    cp -a apps/web/.next/static /runtime/app/web/apps/web/.next/static && \
    cp -a deploy/custom-app/. /runtime/opt/tuinwerk/ && \
    chmod +x /runtime/opt/tuinwerk/*.sh
FROM node:22-alpine3.22 AS runtime
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    apk add --no-cache postgresql17 postgresql17-client postgresql17-contrib supervisor nginx age bash util-linux coreutils tar python3 && mkdir -p /data /run/nginx
ENV APP_VERSION=0.2.0 PG_MAJOR=17 PG_BIN=/usr/bin NODE_ENV=production PORT=3001 APP_URL=http://localhost:8080 UPLOAD_DIR=/data/uploads EXPORT_DIR=/data/exports MIGRATIONS_DIR=/app/api/migrations DATABASE_URL=postgresql://tuinwerk@127.0.0.1:5432/tuinwerk
COPY --from=build /runtime/ /
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD node /opt/tuinwerk/health.cjs
ENTRYPOINT ["/opt/tuinwerk/entrypoint.sh"]
